import { diagnoseDatabase } from "./supabase.ts";

export type DiagnosticStatus = "ok" | "warning" | "error";

export type DiagnosticCheck = {
  id: "password" | "site" | "database" | "search" | "scan-config";
  label: string;
  status: DiagnosticStatus;
  detail: string;
};

type SerpAccountResponse = {
  error?: string;
  account_status?: string;
  plan_name?: string;
  total_searches_left?: number;
  plan_searches_left?: number;
  this_month_usage?: number;
};

function errorMessage(error: unknown, secrets: string[] = [
  process.env.APP_PASSWORD || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  process.env.SERPAPI_API_KEY || "",
]) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[已隐藏]");
  return message.slice(0, 260);
}

export async function diagnoseSerpApiAccount() {
  const key = process.env.SERPAPI_API_KEY || "";
  if (!key) throw new Error("未配置 SERPAPI_API_KEY。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const query = new URLSearchParams({ api_key: key });
    const response = await fetch(`https://serpapi.com/account.json?${query}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await response.json() as SerpAccountResponse;
    if (!response.ok || data.error) throw new Error(data.error || `SerpApi Account API 返回 ${response.status}`);
    const remaining = Number(data.total_searches_left ?? data.plan_searches_left ?? 0);
    return {
      accountStatus: data.account_status || "Unknown",
      planName: data.plan_name || "未标明套餐",
      searchesLeft: Number.isFinite(remaining) ? remaining : 0,
      thisMonthUsage: Number(data.this_month_usage || 0),
    };
  } catch (error) {
    throw new Error(errorMessage(error, [key]));
  } finally {
    clearTimeout(timer);
  }
}

function siteCheck(): DiagnosticCheck {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || "";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") throw new Error("必须使用 HTTPS");
    return { id: "site", label: "公开部署地址", status: "ok", detail: url.origin };
  } catch (error) {
    return { id: "site", label: "公开部署地址", status: "error", detail: configured ? errorMessage(error) : "未配置 NEXT_PUBLIC_SITE_URL。" };
  }
}

function scanConfigCheck(): DiagnosticCheck {
  const textLimit = Number(process.env.SCAN_MAX_TEXT_SEARCHES || 18);
  const imageEngines = (process.env.SCAN_IMAGE_ENGINES || "google_lens_exact,google_lens,bing_reverse_image").split(",").map((value) => value.trim()).filter(Boolean);
  const validEngines = imageEngines.filter((value) => value === "google_lens_exact" || value === "google_lens" || value === "bing_reverse_image");
  const hasInvalidEngine = validEngines.length !== imageEngines.length;
  if (!Number.isFinite(textLimit) || textLimit <= 0 || validEngines.length === 0) {
    return { id: "scan-config", label: "扫描配置", status: "error", detail: "文字查询预算或图片引擎配置无效。" };
  }
  const effectiveEngines = new Set(validEngines);
  if (effectiveEngines.has("google_lens")) effectiveEngines.add("google_lens_exact");
  const effectiveTextLimit = Math.max(4, Math.min(36, Math.round(textLimit)));
  return {
    id: "scan-config",
    label: "扫描配置",
    status: effectiveEngines.size < 3 || hasInvalidEngine ? "warning" : "ok",
    detail: `文字查询上限 ${effectiveTextLimit} 次；图片引擎 ${[...effectiveEngines].join(" + ")}。`,
  };
}

export async function buildDiagnosticReport() {
  const checks: DiagnosticCheck[] = [
    { id: "password", label: "访问保护", status: "ok", detail: "密码会话有效，诊断结果仅登录后可见。" },
    siteCheck(),
    scanConfigCheck(),
  ];
  const [databaseResult, searchResult] = await Promise.allSettled([
    diagnoseDatabase(),
    diagnoseSerpApiAccount(),
  ]);
  if (databaseResult.status === "fulfilled") {
    checks.push({
      id: "database",
      label: "Supabase 与迁移",
      status: "ok",
      detail: `连接正常，历史字段已就绪；现有 ${databaseResult.value.scanCount} 条笔记、${databaseResult.value.matchCount} 条线索。`,
    });
  } else {
    checks.push({ id: "database", label: "Supabase 与迁移", status: "error", detail: errorMessage(databaseResult.reason) });
  }
  if (searchResult.status === "fulfilled") {
    const account = searchResult.value;
    const status: DiagnosticStatus = account.accountStatus.toLowerCase() !== "active" || account.searchesLeft <= 0
      ? "error"
      : account.searchesLeft < 30 ? "warning" : "ok";
    checks.push({
      id: "search",
      label: "SerpApi 检索服务",
      status,
      detail: `${account.accountStatus} · ${account.planName} · 剩余 ${account.searchesLeft} 次，本月已用 ${account.thisMonthUsage} 次。`,
    });
  } else {
    checks.push({ id: "search", label: "SerpApi 检索服务", status: "error", detail: errorMessage(searchResult.reason) });
  }
  return {
    ready: checks.every((check) => check.status !== "error"),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

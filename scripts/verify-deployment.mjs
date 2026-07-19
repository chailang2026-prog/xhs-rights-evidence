import { pathToFileURL } from "node:url";

const requiredPlatforms = ["dianping", "ctrip", "qunar", "fliggy", "amap", "web"];

function deploymentRoot(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VERIFY_BASE_URL 不是有效网址。");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("正式验收网址必须使用 HTTPS。");
  }
  if (url.username || url.password) throw new Error("验收网址不能包含用户名或密码。");
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function safeMessage(error, secrets) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[已隐藏]");
  return message.slice(0, 800);
}

async function jsonCall(fetchImpl, root, path, options = {}, timeoutMs = 30000) {
  const response = await fetchImpl(new URL(path.replace(/^\//, ""), root), {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${path} 返回 HTTP ${response.status}`);
  return { response, data };
}

export async function verifyDeployment({ baseUrl, noteInput, password, fetchImpl = globalThis.fetch }) {
  const root = deploymentRoot(baseUrl || "");
  if (!noteInput?.trim()) throw new Error("未设置 VERIFY_NOTE_INPUT（小红书链接或分享文字）。");
  if (!password || password.length < 8) throw new Error("未提供至少 8 位的验收密码。");

  const login = await jsonCall(fetchImpl, root, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const sessionCookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
  if (!sessionCookie.includes("=")) throw new Error("登录成功但没有收到会话 Cookie。");
  const authenticated = { cookie: sessionCookie };

  const diagnostics = await jsonCall(fetchImpl, root, "/api/diagnostics", { headers: authenticated });
  if (!diagnostics.data.ready) {
    const failures = (diagnostics.data.checks || [])
      .filter((check) => check.status === "error")
      .map((check) => `${check.label}：${check.detail}`)
      .join("；");
    throw new Error(`部署检查未通过：${failures || "存在未说明的错误"}`);
  }

  const scanResult = await jsonCall(fetchImpl, root, "/api/scans", {
    method: "POST",
    headers: { ...authenticated, "content-type": "application/json" },
    body: JSON.stringify({ noteUrl: noteInput, platforms: requiredPlatforms }),
  }, 210000);
  const scan = scanResult.data.scan;
  if (!scan || typeof scan !== "object") throw new Error("扫描接口没有返回扫描记录。");
  if (typeof scan.sourceText !== "string" || [...scan.sourceText].length < 8) throw new Error("没有从原笔记提取到足够的正文。");
  if (!Array.isArray(scan.sourceImages) || scan.sourceImages.length === 0) throw new Error("没有从原笔记提取到图片，无法验收图片匹配链路。");
  if (scan.status !== "已完成") throw new Error(`扫描状态为「${scan.status || "未知"}」：${scan.errorMessage || "请检查部署日志"}`);
  if (!requiredPlatforms.every((platform) => scan.selectedPlatforms?.includes(platform))) throw new Error("扫描记录没有覆盖全部目标平台。");
  if (!Array.isArray(scan.matches)) throw new Error("扫描记录缺少候选链接数组。");
  for (const match of scan.matches) {
    const target = new URL(match.targetUrl);
    if (!/^https?:$/.test(target.protocol)) throw new Error("候选结果包含不安全协议。");
    if (!match.platform || !Array.isArray(match.evidence)) throw new Error("候选结果缺少平台或证据说明。");
  }

  return {
    ok: true,
    deployment: root.origin,
    diagnostics: diagnostics.data.checks.map((check) => ({ label: check.label, status: check.status })),
    scan: {
      id: scan.id,
      status: scan.status,
      extractedTextCharacters: [...scan.sourceText].length,
      extractedImages: scan.sourceImages.length,
      currentMatches: scan.matches.filter((match) => match.isCurrent !== false).length,
      collectedPlatforms: [...new Set(scan.matches.map((match) => match.platformName))],
    },
  };
}

async function main() {
  const password = process.env.VERIFY_APP_PASSWORD || process.env.APP_PASSWORD || "";
  const noteInput = process.env.VERIFY_NOTE_INPUT || "";
  try {
    const result = await verifyDeployment({
      baseUrl: process.env.VERIFY_BASE_URL || "",
      noteInput,
      password,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: safeMessage(error, [password, noteInput]) }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

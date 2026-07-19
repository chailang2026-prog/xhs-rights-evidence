import {
  targetPlatforms,
  type CandidateMatch,
  type PlatformId,
  type SourceNote,
} from "./types.ts";
import { extractSearchKeywords, extractSearchPhrases, textSimilarity } from "./matching.ts";
import { createSourceImageProxyUrl } from "./source-images.ts";

type SearchResult = {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  thumbnail?: string;
  source?: string;
  original?: string;
  image?: string;
  exact_matches?: boolean;
};

type SerpResponse = {
  error?: string;
  organic_results?: SearchResult[];
  visual_matches?: SearchResult[];
  exact_matches?: SearchResult[];
  pages_with_this_image?: SearchResult[];
};

type RawCandidate = {
  targetUrl: string;
  platform: PlatformId;
  platformName: string;
  title: string;
  snippet: string;
  thumbnailUrl: string | null;
  textScore: number;
  imageScore: number;
  evidence: string[];
};

type CandidateBatch = {
  candidates: RawCandidate[];
  warnings: string[];
  attemptedQueries: number;
  successfulQueries: number;
};

type TextQuery = {
  platform: (typeof targetPlatforms)[number];
  phrase: string;
  engine: "baidu" | "google";
  mode: "exact" | "keywords";
};

type ImageSearchEngine = "google_lens_exact" | "google_lens" | "bing_reverse_image";

type ImageQuery = {
  imageUrl: string;
  imageIndex: number;
  engine: ImageSearchEngine;
};

function apiKey() {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) throw new Error("尚未配置 SERPAPI_API_KEY，无法执行全网检索。");
  return key;
}

async function serpApi(parameters: Record<string, string>) {
  const query = new URLSearchParams({ ...parameters, api_key: apiKey(), output: "json" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`https://serpapi.com/search.json?${query}`, { signal: controller.signal });
    const data = (await response.json()) as SerpResponse;
    if (!response.ok || data.error) throw new Error(data.error || `检索服务返回 ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function platformForUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (["xiaohongshu.com", "xhslink.com", "xhs.cn", "rednote.com", "google.com", "baidu.com", "serpapi.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
    return targetPlatforms.find((platform) => platform.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)))
      || targetPlatforms.find((platform) => platform.id === "web")
      || null;
  } catch {
    return null;
  }
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|ref|share)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function textSearchLimit() {
  const configured = Number(process.env.SCAN_MAX_TEXT_SEARCHES || 18);
  return Number.isFinite(configured) ? Math.max(4, Math.min(36, Math.round(configured))) : 18;
}

function imageSearchEngines(): ImageSearchEngine[] {
  const allowed = new Set<ImageSearchEngine>(["google_lens_exact", "google_lens", "bing_reverse_image"]);
  const configured = (process.env.SCAN_IMAGE_ENGINES || "google_lens_exact,google_lens,bing_reverse_image")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ImageSearchEngine => allowed.has(value as ImageSearchEngine));
  const enabled = new Set(configured);
  // Keep deployments created with the previous `google_lens` value thorough:
  // visual Lens searches automatically include the dedicated exact-match tab.
  if (enabled.has("google_lens")) enabled.add("google_lens_exact");
  return enabled.size ? [...enabled] : ["google_lens_exact", "google_lens", "bing_reverse_image"];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function textCandidates(note: SourceNote, selected: PlatformId[]) {
  const phrases = extractSearchPhrases(note);
  if (!phrases.length) return { candidates: [], warnings: [], attemptedQueries: 0, successfulQueries: 0 } satisfies CandidateBatch;
  const platforms = targetPlatforms.filter((platform) => selected.includes(platform.id));
  const primaryExact = (["baidu", "google"] as const).flatMap((engine) => platforms
    .map((platform) => ({ platform, phrase: phrases[0], engine, mode: "exact" as const })));
  const keywords = extractSearchKeywords(note).join(" ");
  const adapted = keywords ? platforms.map((platform) => ({ platform, phrase: keywords, engine: "baidu" as const, mode: "keywords" as const })) : [];
  const secondaryExact = phrases.slice(1, 3).flatMap((phrase) => (["baidu", "google"] as const)
    .flatMap((engine) => platforms.map((platform) => ({ platform, phrase, engine, mode: "exact" as const }))));
  const queries: TextQuery[] = [...primaryExact, ...adapted, ...secondaryExact].slice(0, textSearchLimit());
  const batches = await mapLimit(queries, 3, async ({ platform, phrase, engine, mode }) => {
    const exactPhrase = phrase.replace(/"/g, "");
    try {
      const domainClause = platform.domains.map((domain) => `site:${domain}`).join(" OR ");
      const contentClause = mode === "exact" ? `\"${exactPhrase}\"` : exactPhrase;
      const query = domainClause ? `(${domainClause}) ${contentClause}` : contentClause;
      const data = await serpApi(engine === "baidu"
        ? { engine, q: query, rn: "20" }
        : { engine, q: query, num: "20", hl: "zh-cn", gl: "cn", safe: "active", filter: "0" });
      const candidates = (data.organic_results || [])
        .map((result) => {
          const targetUrl = result.link ? canonicalUrl(result.link) : null;
          return { result, targetUrl, resolvedPlatform: targetUrl ? platformForUrl(targetUrl) : null };
        })
        .filter((item) => item.targetUrl && item.resolvedPlatform && selected.includes(item.resolvedPlatform.id) && (platform.id === "web" || item.resolvedPlatform.id === platform.id))
        .map(({ result, targetUrl, resolvedPlatform }) => {
          const candidateText = `${result.title || ""} ${result.snippet || ""}`;
          const measuredScore = Math.max(...phrases.map((item) => textSimilarity(item, candidateText)), textSimilarity(note.title, candidateText));
          // Search engines sometimes omit the matched sentence from their snippet. A result
          // returned for the quoted source phrase remains a useful lead, but at low strength.
          const score = mode === "exact" ? Math.max(measuredScore, 0.36) : measuredScore;
          const rank = Number.isFinite(result.position) ? `第 ${result.position} 位` : "公开结果";
          const engineName = engine === "baidu" ? "百度" : "Google";
          const queryKind = mode === "exact" ? "精确原文" : "改写特征词";
          return {
            targetUrl: targetUrl as string,
            platform: resolvedPlatform!.id,
            platformName: resolvedPlatform!.name,
            title: result.title || `${resolvedPlatform!.name}上的疑似相似内容`,
            snippet: result.snippet || "搜索结果未提供摘要，请打开原链接复核。",
            thumbnailUrl: result.thumbnail || null,
            textScore: score,
            imageScore: 0,
            evidence: [`${engineName}文字命中（${queryKind} · ${rank}）：${exactPhrase.slice(0, 28)}${exactPhrase.length > 28 ? "…" : ""}`],
          } satisfies RawCandidate;
        });
      return { candidates, warnings: [], successful: true };
    } catch (error) {
      const engineName = engine === "baidu" ? "百度" : "Google";
      return { candidates: [] as RawCandidate[], warnings: [`${platform.name}${engineName}文字检索失败：${errorMessage(error)}`], successful: false };
    }
  });
  return {
    candidates: batches.flatMap((batch) => batch.candidates),
    warnings: [...new Set(batches.flatMap((batch) => batch.warnings))],
    attemptedQueries: batches.length,
    successfulQueries: batches.filter((batch) => batch.successful).length,
  } satisfies CandidateBatch;
}

async function imageCandidates(note: SourceNote, selected: PlatformId[], publicOrigin?: string) {
  const images = note.imageUrls.slice(0, 4);
  if (!images.length) return { candidates: [], warnings: [], attemptedQueries: 0, successfulQueries: 0 } satisfies CandidateBatch;
  const queries: ImageQuery[] = images.flatMap((imageUrl, imageIndex) => imageSearchEngines()
    .map((engine) => ({ imageUrl, imageIndex, engine })));
  const batches = await mapLimit(queries, 3, async ({ imageUrl, imageIndex, engine }) => {
    try {
      const proxyUrl = createSourceImageProxyUrl(imageUrl, { origin: publicOrigin });
      const data = await serpApi(engine === "bing_reverse_image"
        ? { engine, image_url: proxyUrl, mkt: "zh-CN", count: "50" }
        : { engine: "google_lens", url: proxyUrl, type: engine === "google_lens_exact" ? "exact_matches" : "visual_matches", hl: "zh-CN", country: "cn", safe: "active" });
      const rawResults = engine === "google_lens_exact"
        ? (data.exact_matches || [])
        : engine === "google_lens" ? (data.visual_matches || []) : (data.pages_with_this_image || []);
      const candidates = rawResults.slice(0, 40).map((result, resultIndex) => {
        const rawTargetUrl = engine === "bing_reverse_image" ? result.source : result.link;
        const targetUrl = rawTargetUrl ? canonicalUrl(rawTargetUrl) : null;
        const position = Number.isFinite(result.position) ? Number(result.position) : resultIndex + 1;
        return { result, targetUrl, position, platform: targetUrl ? platformForUrl(targetUrl) : null };
      }).filter((item) => item.targetUrl && item.platform && selected.includes(item.platform.id)).map(({ result, targetUrl, position, platform }) => {
        const googleExact = engine === "google_lens_exact" || (engine === "google_lens" && result.exact_matches === true);
        const imageScore = engine === "bing_reverse_image"
          ? 0.96
          : googleExact ? 0.98 : position <= 3 ? 0.88 : position <= 10 ? 0.82 : position <= 20 ? 0.77 : 0.73;
        const evidence = engine === "bing_reverse_image"
          ? `Bing 同图页面命中：原笔记第 ${imageIndex + 1} 张图`
          : googleExact
            ? `Google Lens 精确图片命中：原笔记第 ${imageIndex + 1} 张图`
            : `Google Lens 视觉匹配（第 ${position} 位）：原笔记第 ${imageIndex + 1} 张图`;
        return {
          targetUrl: targetUrl as string,
          platform: platform!.id,
          platformName: platform!.name,
          title: result.title || `${platform!.name}上的疑似盗图内容`,
          snippet: engine === "bing_reverse_image"
            ? `Bing 在该公开网页中发现了原笔记第 ${imageIndex + 1} 张图片的同图页面。`
            : googleExact
              ? `Google Lens 将该公开网页标记为原笔记第 ${imageIndex + 1} 张图片的精确匹配。`
              : `Google Lens 在公开网页中发现了与原笔记第 ${imageIndex + 1} 张图片视觉相似的内容，排序第 ${position} 位。`,
          thumbnailUrl: result.thumbnail || result.original || result.image || null,
          textScore: 0,
          imageScore,
          evidence: [evidence],
        } satisfies RawCandidate;
      });
      return { candidates, warnings: [], successful: true };
    } catch (error) {
      const engineName = engine === "google_lens_exact" ? "Google Lens 精确同图" : engine === "google_lens" ? "Google Lens 视觉相似" : "Bing";
      return { candidates: [] as RawCandidate[], warnings: [`第 ${imageIndex + 1} 张图片的 ${engineName} 检索失败：${errorMessage(error)}`], successful: false };
    }
  });
  return {
    candidates: batches.flatMap((batch) => batch.candidates),
    warnings: [...new Set(batches.flatMap((batch) => batch.warnings))],
    attemptedQueries: batches.length,
    successfulQueries: batches.filter((batch) => batch.successful).length,
  } satisfies CandidateBatch;
}

function rounded(value: number) {
  return Math.round(Math.max(0, Math.min(0.99, value)) * 100) / 100;
}

export async function scanPublicWeb(note: SourceNote, selectedPlatforms: PlatformId[], publicOrigin?: string) {
  const settled = await Promise.allSettled([
    textCandidates(note, selectedPlatforms),
    imageCandidates(note, selectedPlatforms, publicOrigin),
  ]);
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  const completed = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const raw = completed.flatMap((batch) => batch.candidates);
  const warnings = [...new Set([
    ...completed.flatMap((batch) => batch.warnings),
    ...failures.map((failure) => errorMessage(failure.reason)),
  ])];
  const attemptedQueries = completed.reduce((total, batch) => total + batch.attemptedQueries, 0);
  const successfulQueries = completed.reduce((total, batch) => total + batch.successfulQueries, 0);
  if (failures.length === settled.length || (attemptedQueries > 0 && successfulQueries === 0)) {
    throw new Error(warnings[0] || "所有检索请求均失败，请检查检索服务配置。");
  }

  const merged = new Map<string, RawCandidate>();
  for (const candidate of raw) {
    const current = merged.get(candidate.targetUrl);
    if (!current) {
      merged.set(candidate.targetUrl, candidate);
      continue;
    }
    current.textScore = Math.max(current.textScore, candidate.textScore);
    current.imageScore = Math.max(current.imageScore, candidate.imageScore);
    current.thumbnailUrl ||= candidate.thumbnailUrl;
    current.evidence = [...new Set([...current.evidence, ...candidate.evidence])];
    if (candidate.snippet.length > current.snippet.length) current.snippet = candidate.snippet;
  }

  const matches: CandidateMatch[] = [...merged.values()]
    .map((candidate) => {
      const textEvidenceCount = candidate.evidence.filter((item) => item.includes("文字命中")).length;
      const imageEvidenceCount = candidate.evidence.filter((item) => item.startsWith("Google Lens") || item.startsWith("Bing ")).length;
      const textScore = Math.min(0.98, candidate.textScore + Math.min(0.06, Math.max(0, textEvidenceCount - 1) * 0.02));
      const imageScore = Math.min(0.98, candidate.imageScore + Math.min(0.08, Math.max(0, imageEvidenceCount - 1) * 0.03));
      const both = textScore >= 0.38 && imageScore >= 0.7;
      const overall = both
        ? textScore * 0.45 + imageScore * 0.55 + 0.08
        : Math.max(textScore, imageScore);
      return {
        targetUrl: candidate.targetUrl,
        platform: candidate.platform,
        platformName: candidate.platformName,
        title: candidate.title,
        snippet: candidate.snippet,
        thumbnailUrl: candidate.thumbnailUrl,
        textScore: rounded(textScore),
        imageScore: rounded(imageScore),
        overallScore: rounded(overall),
        matchType: both ? "图文相似" : imageScore >= textScore ? "图片相似" : "文字相似",
        evidence: candidate.evidence,
      } satisfies CandidateMatch;
    })
    .filter((match) => match.textScore >= 0.32 || match.imageScore >= 0.72)
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 80);

  return { matches, partial: warnings.length > 0, warnings };
}

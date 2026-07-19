import {
  targetPlatforms,
  type CandidateMatch,
  type PlatformId,
  type SourceNote,
} from "./types";
import { extractSearchPhrases, textSimilarity } from "./matching";

type SearchResult = {
  title?: string;
  link?: string;
  snippet?: string;
  thumbnail?: string;
  source?: string;
};

type SerpResponse = {
  error?: string;
  organic_results?: SearchResult[];
  visual_matches?: Array<SearchResult & { image?: string }>;
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
    const host = new URL(value).hostname.toLowerCase();
    if (["xiaohongshu.com", "xhslink.com", "google.com", "baidu.com", "serpapi.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
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
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|ref|share)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
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

async function textCandidates(note: SourceNote, selected: PlatformId[]) {
  const phrases = extractSearchPhrases(note);
  if (!phrases.length) return [] as RawCandidate[];
  const platforms = targetPlatforms.filter((platform) => selected.includes(platform.id));
  const batches = await mapLimit(platforms, 3, async (platform) => {
    const domainClause = platform.domains.map((domain) => `site:${domain}`).join(" OR ");
    const exactPhrase = phrases[0].replace(/"/g, "");
    const data = await serpApi({ engine: "baidu", q: domainClause ? `(${domainClause}) \"${exactPhrase}\"` : `\"${exactPhrase}\"`, rn: "20" });
    return (data.organic_results || [])
      .map((result) => ({ result, resolvedPlatform: result.link ? platformForUrl(result.link) : null }))
      .filter((item) => item.result.link && item.resolvedPlatform && selected.includes(item.resolvedPlatform.id) && (platform.id === "web" || item.resolvedPlatform.id === platform.id))
      .map(({ result, resolvedPlatform }) => {
        const candidateText = `${result.title || ""} ${result.snippet || ""}`;
        const score = Math.max(...phrases.map((phrase) => textSimilarity(phrase, candidateText)), textSimilarity(note.title, candidateText));
        return {
          targetUrl: canonicalUrl(result.link as string),
          platform: resolvedPlatform!.id,
          platformName: resolvedPlatform!.name,
          title: result.title || `${resolvedPlatform!.name}上的疑似相似内容`,
          snippet: result.snippet || "搜索结果未提供摘要，请打开原链接复核。",
          thumbnailUrl: result.thumbnail || null,
          textScore: score,
          imageScore: 0,
          evidence: [`文字命中：${exactPhrase.slice(0, 28)}${exactPhrase.length > 28 ? "…" : ""}`],
        } satisfies RawCandidate;
      });
  });
  return batches.flat();
}

async function imageCandidates(note: SourceNote, selected: PlatformId[]) {
  const images = note.imageUrls.slice(0, 4);
  if (!images.length) return [] as RawCandidate[];
  const batches = await mapLimit(images, 2, async (imageUrl, imageIndex) => {
    const data = await serpApi({
      engine: "google_lens",
      url: imageUrl,
      type: "visual_matches",
      hl: "zh-CN",
      country: "cn",
      safe: "active",
    });
    return (data.visual_matches || [])
      .map((result) => ({ result, platform: result.link ? platformForUrl(result.link) : null }))
      .filter((item) => item.result.link && item.platform && selected.includes(item.platform.id))
      .map(({ result, platform }) => ({
        targetUrl: canonicalUrl(result.link as string),
        platform: platform!.id,
        platformName: platform!.name,
        title: result.title || `${platform!.name}上的疑似盗图内容`,
        snippet: `Google Lens 在公开网页中发现了与原笔记第 ${imageIndex + 1} 张图片相似的内容。`,
        thumbnailUrl: result.thumbnail || result.image || null,
        textScore: 0,
        imageScore: 0.84,
        evidence: [`图片视觉匹配：原笔记第 ${imageIndex + 1} 张图`],
      } satisfies RawCandidate));
  });
  return batches.flat();
}

function rounded(value: number) {
  return Math.round(Math.max(0, Math.min(0.99, value)) * 100) / 100;
}

export async function scanPublicWeb(note: SourceNote, selectedPlatforms: PlatformId[]) {
  const settled = await Promise.allSettled([
    textCandidates(note, selectedPlatforms),
    imageCandidates(note, selectedPlatforms),
  ]);
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  const raw = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (failures.length === settled.length) throw failures[0].reason;

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
      const both = candidate.textScore >= 0.38 && candidate.imageScore >= 0.7;
      const overall = both
        ? candidate.textScore * 0.45 + candidate.imageScore * 0.55 + 0.08
        : Math.max(candidate.textScore, candidate.imageScore);
      return {
        targetUrl: candidate.targetUrl,
        platform: candidate.platform,
        platformName: candidate.platformName,
        title: candidate.title,
        snippet: candidate.snippet,
        thumbnailUrl: candidate.thumbnailUrl,
        textScore: rounded(candidate.textScore),
        imageScore: rounded(candidate.imageScore),
        overallScore: rounded(overall),
        matchType: both ? "图文相似" : candidate.imageScore >= candidate.textScore ? "图片相似" : "文字相似",
        evidence: candidate.evidence,
      } satisfies CandidateMatch;
    })
    .filter((match) => match.textScore >= 0.32 || match.imageScore >= 0.72)
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 80);

  return { matches, partial: failures.length > 0, warnings: failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)) };
}

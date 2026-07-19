import type { SourceNote } from "./types";

const sourceHosts = ["xiaohongshu.com", "xhslink.com", "xhs.cn", "rednote.com"];

function allowedSourceHost(hostname: string) {
  const host = hostname.toLowerCase();
  return sourceHosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
      if (entity[0] === "#") {
        const hex = entity[1]?.toLowerCase() === "x";
        return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      return named[entity.toLowerCase()] || `&${entity};`;
    })
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .trim();
}

function attributes(tag: string) {
  const values = new Map<string, string>();
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    values.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? ""));
  }
  return values;
}

function readMeta(html: string, keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const found: string[] = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const name = (attrs.get("property") || attrs.get("name") || "").toLowerCase();
    const content = attrs.get("content");
    if (content && wanted.has(name)) found.push(content);
  }
  return found;
}

function parseJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return decodeEntities(value);
  }
}

function collectJsonLd(html: string) {
  const items: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) items.push(...parsed);
      else if (parsed && typeof parsed === "object") items.push(parsed);
    } catch {
      // Some public pages contain malformed optional JSON-LD. Meta tags remain the fallback.
    }
  }
  return items;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? decodeEntities(value) : "";
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
}

export async function extractSourceNote(inputUrl: string): Promise<SourceNote> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error("请粘贴有效的小红书笔记链接。");
  }
  if (!allowedSourceHost(parsed.hostname)) throw new Error("目前只支持小红书、xhslink 或 RedNote 的公开笔记链接。");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9",
      },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`小红书页面读取失败（${response.status}），请确认链接可以公开访问。`);
  const finalUrl = new URL(response.url);
  if (!allowedSourceHost(finalUrl.hostname)) throw new Error("短链接跳转到了非小红书页面，已停止处理。");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 6_000_000) throw new Error("笔记页面内容过大，无法安全读取。");
  const html = await response.text();

  const jsonLd = collectJsonLd(html);
  const noteStateIndex = html.indexOf('"noteDetailMap"');
  const noteState = noteStateIndex >= 0 ? html.slice(noteStateIndex, noteStateIndex + 1_500_000) : "";
  const titleCandidates = [
    ...readMeta(html, ["og:title", "twitter:title"]),
    ...jsonLd.map((item) => stringValue(item.headline || item.name)),
  ];
  const descriptionCandidates = [
    ...readMeta(html, ["og:description", "description", "twitter:description"]),
    ...jsonLd.map((item) => stringValue(item.description || item.articleBody)),
  ];
  const authorCandidates = jsonLd.map((item) => {
    const author = item.author;
    return typeof author === "object" && author ? stringValue((author as Record<string, unknown>).name) : stringValue(author);
  });

  const stateTitle = noteState.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
  const stateDescription = noteState.match(/"desc"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
  if (stateTitle) titleCandidates.push(parseJsonString(stateTitle));
  if (stateDescription) descriptionCandidates.push(parseJsonString(stateDescription));

  const imageCandidates = [...readMeta(html, ["og:image", "twitter:image"] )];
  for (const item of jsonLd) {
    const image = item.image;
    if (typeof image === "string") imageCandidates.push(image);
    if (Array.isArray(image)) imageCandidates.push(...image.filter((value): value is string => typeof value === "string"));
  }
  for (const match of noteState.matchAll(/"(?:urlDefault|url|imageUrl)"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    const value = parseJsonString(match[1]);
    if (/^https?:\/\//i.test(value) && /xhscdn|xiaohongshu|sns-webpic/i.test(value)) imageCandidates.push(value);
  }

  const title = cleanText(titleCandidates.find((value) => cleanText(value).length >= 4) || "小红书笔记").slice(0, 180);
  const text = cleanText(descriptionCandidates.find((value) => cleanText(value).length >= 12) || title).slice(0, 12000);
  const imageUrls = [...new Set(imageCandidates.map(decodeEntities).filter((value) => /^https?:\/\//i.test(value)))].slice(0, 9);
  if (!noteState && jsonLd.length === 0 && readMeta(html, ["og:title", "og:description", "og:image"]).length === 0) {
    throw new Error("这条笔记当前没有返回公开图文内容，可能已删除、仅登录可见或链接已失效。");
  }
  if (text.length < 8 && imageUrls.length === 0) {
    throw new Error("没有从这条笔记中读取到可比对的文字或图片。请确认它是公开图文笔记。");
  }

  return {
    url: finalUrl.toString(),
    title,
    text,
    imageUrls,
    author: authorCandidates.find((value) => value.trim())?.trim().slice(0, 100) || null,
  };
}

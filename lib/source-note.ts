import type { SourceNote } from "./types";
import { normalizeSourceImageUrl } from "./source-images.ts";

const sourceHosts = ["xiaohongshu.com", "xhslink.com", "xhslink.cn", "xhs.cn", "rednote.com"];

function allowedSourceHost(hostname: string) {
  const host = hostname.toLowerCase();
  return sourceHosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function sourceUrlFromInput(input: string) {
  const trimmed = input.trim();
  const urlTokens = trimmed.match(/https?:\/\/[^\s<>"'，。！？；、]+/gi) || [];
  const candidates = [trimmed, ...urlTokens];
  let sawUrl = false;
  for (const rawCandidate of candidates) {
    let candidate = rawCandidate.replace(/[，。！？；、）】》,;!?)\]}]+$/u, "");
    if (!/^https?:\/\//i.test(candidate) && /^[\w.-]+\//.test(candidate)) candidate = `https://${candidate}`;
    try {
      const parsed = new URL(candidate);
      sawUrl = true;
      if (!allowedSourceHost(parsed.hostname)) continue;
      if (parsed.username || parsed.password) throw new Error("小红书链接不能包含用户名或密码。");
      if (parsed.protocol === "http:") parsed.protocol = "https:";
      if (parsed.protocol !== "https:") throw new Error("小红书笔记链接必须使用 HTTPS。");
      return parsed;
    } catch (error) {
      if (error instanceof Error && /用户名|必须使用 HTTPS/.test(error.message)) throw error;
    }
  }
  if (sawUrl) throw new Error("目前只支持小红书、xhslink 或 RedNote 的公开笔记链接。");
  throw new Error("请粘贴小红书笔记链接，或包含该链接的分享文字。");
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

function cleanBodyText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(cleanText)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function extractObjectAfter(html: string, marker: string, fromIndex: number) {
  const markerIndex = html.indexOf(marker, fromIndex);
  if (markerIndex < 0) return null;
  const start = html.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      try {
        return recordValue(JSON.parse(html.slice(start, index + 1)));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function noteIdFromUrl(url: URL) {
  return url.pathname.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/i)?.[1] || null;
}

function unavailablePageCopy(value: string) {
  return /页面不见了|笔记(?:已删除|不存在)|内容(?:已删除|不存在|无法展示)|仅作者可见|登录后查看/i.test(cleanText(value));
}

function meaningfulTitleCopy(value: string) {
  const title = cleanText(value);
  return title.length >= 4
    && !unavailablePageCopy(title)
    && !/^(?:小红书|小红书\s*[-–—]\s*(?:你的生活指南|发现真实.*))$/i.test(title);
}

function currentNoteData(html: string, finalUrl: URL) {
  const rootIndex = html.indexOf('"noteData":{"routeQuery"');
  if (rootIndex < 0) return null;
  const note = extractObjectAfter(html, '"data":{"noteData":', rootIndex);
  const expectedNoteId = noteIdFromUrl(finalUrl);
  if (!note || (expectedNoteId && stringValue(note.noteId) !== expectedNoteId)) return null;
  return note;
}

function noteImageUrls(note: Record<string, unknown> | null) {
  if (!note || !Array.isArray(note.imageList)) return [];
  const urls: string[] = [];
  for (const value of note.imageList) {
    const image = recordValue(value);
    if (!image) continue;
    const variants: string[] = [];
    for (const key of ["url", "urlDefault", "urlPre"]) {
      if (typeof image[key] === "string") variants.push(image[key] as string);
    }
    if (Array.isArray(image.infoList)) {
      for (const infoValue of image.infoList) {
        const info = recordValue(infoValue);
        if (typeof info?.url === "string") variants.push(info.url);
      }
    }
    const usable = variants.find((candidate) => normalizeSourceImageUrl(candidate));
    if (usable) urls.push(usable);
  }
  return urls;
}

function noteAuthor(note: Record<string, unknown> | null) {
  const user = recordValue(note?.user);
  const value = stringValue(user?.nickName || user?.nickname || user?.name);
  return value && value.toLowerCase() !== "undefined" ? value : "";
}

async function fetchNotePage(initialUrl: URL, signal: AbortSignal) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetch(currentUrl.toString(), {
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("小红书短链接返回了无效跳转。");
      const nextUrl = new URL(location, currentUrl);
      if (!allowedSourceHost(nextUrl.hostname)) {
        throw new Error("小红书链接跳转到了不受信任的地址，已停止处理。");
      }
      if (nextUrl.protocol === "http:") nextUrl.protocol = "https:";
      if (nextUrl.protocol !== "https:") throw new Error("小红书链接使用了不受支持的跳转协议，已停止处理。");
      currentUrl = nextUrl;
      continue;
    }
    const reportedUrl = response.url ? new URL(response.url) : currentUrl;
    if (reportedUrl.protocol !== "https:" || !allowedSourceHost(reportedUrl.hostname)) {
      throw new Error("小红书链接返回了不受信任的地址，已停止处理。");
    }
    return { response, finalUrl: reportedUrl };
  }
  throw new Error("小红书链接跳转次数过多，已停止处理。");
}

export async function extractSourceNote(inputUrl: string): Promise<SourceNote> {
  const parsed = sourceUrlFromInput(inputUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  let finalUrl: URL;
  try {
    ({ response, finalUrl } = await fetchNotePage(parsed, controller.signal));
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`小红书页面读取失败（${response.status}），请确认链接可以公开访问。`);
  if (allowedSourceHost(finalUrl.hostname) && !noteIdFromUrl(finalUrl)) {
    throw new Error("这个链接没有指向具体的小红书笔记，可能是短链已过期或复制不完整。");
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 6_000_000) throw new Error("笔记页面内容过大，无法安全读取。");
  const html = await response.text();
  if (html.length > 6_000_000) throw new Error("笔记页面内容过大，无法安全读取。");

  const jsonLd = collectJsonLd(html);
  const currentNote = currentNoteData(html, finalUrl);
  const noteStateIndex = html.indexOf('"noteDetailMap"');
  const rawNoteState = noteStateIndex >= 0 ? html.slice(noteStateIndex, noteStateIndex + 1_500_000) : "";
  const expectedNoteId = noteIdFromUrl(finalUrl);
  const noteState = rawNoteState && (!expectedNoteId || rawNoteState.includes(expectedNoteId)) ? rawNoteState : "";
  const titleCandidates = [
    stringValue(currentNote?.title),
    ...readMeta(html, ["og:title", "twitter:title"]),
    ...jsonLd.map((item) => stringValue(item.headline || item.name)),
  ];
  const descriptionCandidates = [
    stringValue(currentNote?.desc || currentNote?.description),
    ...readMeta(html, ["og:description", "description", "twitter:description"]),
    ...jsonLd.map((item) => stringValue(item.description || item.articleBody)),
  ];
  const authorCandidates = [noteAuthor(currentNote), ...jsonLd.map((item) => {
    const author = item.author;
    return typeof author === "object" && author ? stringValue((author as Record<string, unknown>).name) : stringValue(author);
  })];

  const stateTitle = noteState.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
  const stateDescription = noteState.match(/"desc"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];
  if (stateTitle) titleCandidates.push(parseJsonString(stateTitle));
  if (stateDescription) descriptionCandidates.push(parseJsonString(stateDescription));

  const imageCandidates = [...noteImageUrls(currentNote), ...readMeta(html, ["og:image", "twitter:image"] )];
  for (const item of jsonLd) {
    const image = item.image;
    if (typeof image === "string") imageCandidates.push(image);
    if (Array.isArray(image)) imageCandidates.push(...image.filter((value): value is string => typeof value === "string"));
  }
  for (const match of noteState.matchAll(/"(?:urlDefault|url|imageUrl)"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    const value = parseJsonString(match[1]);
    if (/^https?:\/\//i.test(value) && /xhscdn|xiaohongshu|sns-webpic/i.test(value)) imageCandidates.push(value);
  }

  if (!currentNote && !noteState && titleCandidates.some(unavailablePageCopy)) {
    throw new Error("这条笔记已删除、不可见或链接已经失效。");
  }
  const selectedTitle = titleCandidates.find(meaningfulTitleCopy) || "";
  const selectedDescription = descriptionCandidates.find((value) => cleanBodyText(value).length >= 12) || "";
  const title = cleanText(selectedTitle || "小红书笔记").slice(0, 180);
  const text = cleanBodyText(selectedDescription || title).slice(0, 12000);
  const imageUrls = [...new Set(imageCandidates.map(decodeEntities).map(normalizeSourceImageUrl).filter((value): value is string => Boolean(value)))].slice(0, 9);
  if (!currentNote && !noteState && !selectedTitle && !selectedDescription && imageUrls.length === 0) {
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
    author: authorCandidates.find((value) => value.trim() && value.trim().toLowerCase() !== "undefined")?.trim().slice(0, 100) || null,
  };
}

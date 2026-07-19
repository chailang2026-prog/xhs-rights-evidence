import { createHmac, timingSafeEqual } from "node:crypto";

const allowedImageDomains = ["xhscdn.com", "xiaohongshu.com", "rednote.com"];
const proxyLifetimeSeconds = 60 * 30;

function signingSecret() {
  return process.env.APP_PASSWORD || "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signature(sourceUrl: string, expiresAt: string) {
  return createHmac("sha256", signingSecret()).update(`${expiresAt}\n${sourceUrl}`).digest("base64url");
}

export function isAllowedSourceImageUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && allowedImageDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function createSourceImageProxyUrl(sourceUrl: string, options: { origin?: string; now?: number } = {}) {
  if (!isAllowedSourceImageUrl(sourceUrl)) throw new Error("原笔记包含无法安全代理的图片地址。");
  const siteUrl = options.origin || process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error("尚未配置 NEXT_PUBLIC_SITE_URL，无法执行图片匹配。");
  if (signingSecret().length < 8) throw new Error("尚未配置有效的 APP_PASSWORD，无法签名图片匹配请求。");
  const expiresAt = String(Math.floor((options.now ?? Date.now()) / 1000) + proxyLifetimeSeconds);
  const proxyUrl = new URL("/api/source-image", siteUrl);
  proxyUrl.searchParams.set("url", sourceUrl);
  proxyUrl.searchParams.set("expires", expiresAt);
  proxyUrl.searchParams.set("signature", signature(sourceUrl, expiresAt));
  return proxyUrl.toString();
}

export function verifySourceImageProxyUrl(requestUrl: string, now = Date.now()) {
  if (signingSecret().length < 8) return null;
  const url = new URL(requestUrl);
  const sourceUrl = url.searchParams.get("url") || "";
  const expiresAt = url.searchParams.get("expires") || "";
  const suppliedSignature = url.searchParams.get("signature") || "";
  if (!sourceUrl || !expiresAt || !suppliedSignature || !/^\d+$/.test(expiresAt)) return null;
  if (Number(expiresAt) < Math.floor(now / 1000)) return null;
  if (!isAllowedSourceImageUrl(sourceUrl)) return null;
  return safeEqual(suppliedSignature, signature(sourceUrl, expiresAt)) ? sourceUrl : null;
}

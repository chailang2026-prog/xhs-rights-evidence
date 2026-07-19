import { verifySourceImageProxyUrl } from "../../../lib/source-images.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export async function GET(request: Request) {
  const sourceUrl = verifySourceImageProxyUrl(request.url);
  if (!sourceUrl) return Response.json({ error: "图片地址签名无效或已过期。" }, { status: 403 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; OriginalRightsRadar/1.0)",
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
        referer: "https://www.xiaohongshu.com/",
      },
    });
    if (!response.ok) return Response.json({ error: `原图片读取失败（${response.status}）。` }, { status: 502 });
    const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!allowedContentTypes.has(contentType)) return Response.json({ error: "原地址没有返回受支持的图片格式。" }, { status: 415 });
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 12_000_000) return Response.json({ error: "原图片超过 12MB 限制。" }, { status: 413 });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 12_000_000) return Response.json({ error: "原图片超过 12MB 限制。" }, { status: 413 });
    return new Response(bytes, {
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
        "cache-control": "public, max-age=900, immutable",
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "原图片读取超时或暂时不可用。" }, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}

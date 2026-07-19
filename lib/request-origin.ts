export function publicRequestOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall back to trusted proxy headers or the request URL below.
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const fallbackProtocol = new URL(request.url).protocol.replace(":", "");
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : fallbackProtocol;
  if (host && !/[\s/\\]/.test(host)) {
    try {
      return new URL(`${protocol}://${host}`).origin;
    } catch {
      // Fall through to the request URL.
    }
  }
  return new URL(request.url).origin;
}

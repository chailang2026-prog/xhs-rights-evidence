import { createHmac, timingSafeEqual } from "node:crypto";

export const sessionCookieName = "rights_radar_session";
const sessionSeconds = 60 * 60 * 24 * 14;

function configuredPassword() {
  return process.env.APP_PASSWORD || "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signature(value: string) {
  return createHmac("sha256", configuredPassword()).update(value).digest("base64url");
}

export function isAuthConfigured() {
  return configuredPassword().length >= 8;
}

export function verifyPassword(password: string) {
  return isAuthConfigured() && safeEqual(password, configuredPassword());
}

export function createSessionToken() {
  const expiresAt = String(Math.floor(Date.now() / 1000) + sessionSeconds);
  return `${expiresAt}.${signature(expiresAt)}`;
}

export function isSessionValid(request: Request) {
  if (!isAuthConfigured()) return false;
  const cookie = request.headers.get("cookie") || "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`))
    ?.slice(sessionCookieName.length + 1);
  if (!token) return false;
  const [expiresAt, suppliedSignature] = token.split(".");
  if (!expiresAt || !suppliedSignature || Number(expiresAt) < Date.now() / 1000) return false;
  return safeEqual(suppliedSignature, signature(expiresAt));
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${sessionSeconds}`;
}

export function expiredSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;
}

export function unauthorized() {
  return Response.json({ error: "请先登录。" }, { status: 401 });
}

import { createSessionToken, isAuthConfigured, sessionCookie, verifyPassword } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return Response.json({ error: "部署环境尚未配置 APP_PASSWORD（至少 8 位）。" }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!verifyPassword(body.password || "")) {
    return Response.json({ error: "密码不正确。" }, { status: 401 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(createSessionToken()) },
  });
}


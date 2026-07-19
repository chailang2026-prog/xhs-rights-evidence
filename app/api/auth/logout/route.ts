import { expiredSessionCookie } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": expiredSessionCookie() },
  });
}


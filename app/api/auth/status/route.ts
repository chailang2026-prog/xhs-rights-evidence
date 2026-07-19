import { isAuthConfigured, isSessionValid } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return Response.json({ configured: isAuthConfigured(), authenticated: isSessionValid(request) });
}


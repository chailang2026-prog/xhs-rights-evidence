import { isSessionValid, unauthorized } from "../../../lib/auth";
import { buildDiagnosticReport } from "../../../lib/diagnostics.ts";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  if (!isSessionValid(request)) return unauthorized();
  try {
    return Response.json(await buildDiagnosticReport(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "部署诊断暂时无法完成。" }, { status: 500 });
  }
}

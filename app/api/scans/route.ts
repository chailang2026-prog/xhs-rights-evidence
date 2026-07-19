import { isSessionValid, unauthorized } from "../../../lib/auth";
import { scanPublicWeb } from "../../../lib/scanner";
import { extractSourceNote } from "../../../lib/source-note";
import { createScan, finishScan, getScan, listScans, replaceMatches } from "../../../lib/supabase";
import { platformIds, type PlatformId } from "../../../lib/types";
import { publicRequestOrigin } from "../../../lib/request-origin.ts";

export const runtime = "nodejs";
export const maxDuration = 120;

function validPlatforms(value: unknown): PlatformId[] {
  if (!Array.isArray(value)) return [...platformIds];
  const selected = value.filter((item): item is PlatformId => platformIds.includes(item as PlatformId));
  return selected.length ? [...new Set(selected)] : [...platformIds];
}

export async function GET(request: Request) {
  if (!isSessionValid(request)) return unauthorized();
  try {
    return Response.json({ scans: await listScans() });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error instanceof Error ? error.message : "读取扫描记录失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSessionValid(request)) return unauthorized();
  let scanId: string | null = null;
  try {
    const body = (await request.json()) as { noteUrl?: string; platforms?: unknown };
    if (!body.noteUrl) return Response.json({ error: "请粘贴小红书笔记链接。" }, { status: 400 });
    const selectedPlatforms = validPlatforms(body.platforms);
    const source = await extractSourceNote(body.noteUrl);
    const scan = await createScan(source, selectedPlatforms);
    scanId = scan.id;
    const result = await scanPublicWeb(source, selectedPlatforms, publicRequestOrigin(request));
    await replaceMatches(scan.id, result.matches, { markMissingInactive: !result.partial });
    await finishScan(scan.id, result.partial ? "部分完成" : "已完成", result.warnings.join("；") || null);
    return Response.json({ scan: await getScan(scan.id) }, { status: 201 });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "扫描失败，请稍后重试。";
    if (scanId) await finishScan(scanId, "扫描失败", message).catch(console.error);
    const status = /链接|小红书|读取|公开|图文笔记/.test(message) ? 422 : /配置/.test(message) ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}

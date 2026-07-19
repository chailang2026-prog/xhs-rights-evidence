import { isSessionValid, unauthorized } from "../../../../lib/auth";
import { scanPublicWeb } from "../../../../lib/scanner";
import { extractSourceNote } from "../../../../lib/source-note";
import { deleteScan, finishScan, getScan, markScanRunning, refreshScanSource, replaceMatches } from "../../../../lib/supabase";
import { publicRequestOrigin } from "../../../../lib/request-origin.ts";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSessionValid(request)) return unauthorized();
  const { id } = await context.params;
  try {
    const scan = await getScan(id);
    await markScanRunning(id);
    let source = {
      url: scan.sourceUrl,
      title: scan.sourceTitle,
      text: scan.sourceText,
      imageUrls: scan.sourceImages,
      author: scan.sourceAuthor,
    };
    let refreshWarning = "";
    try {
      const refreshedSource = await extractSourceNote(scan.sourceUrl);
      source = refreshedSource;
      try {
        await refreshScanSource(id, refreshedSource);
      } catch (error) {
        refreshWarning = `已读取最新原笔记，但未能更新已保存的图文：${error instanceof Error ? error.message : String(error)}`;
      }
    } catch (error) {
      refreshWarning = `原笔记刷新失败，已使用上次保存的图文：${error instanceof Error ? error.message : String(error)}`;
    }
    const result = await scanPublicWeb(source, scan.selectedPlatforms, publicRequestOrigin(request));
    const warnings = [...new Set([refreshWarning, ...result.warnings].filter(Boolean))];
    await replaceMatches(id, result.matches);
    await finishScan(id, result.partial || Boolean(refreshWarning) ? "部分完成" : "已完成", warnings.join("；") || null);
    return Response.json({ scan: await getScan(id) });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "重新扫描失败。";
    await finishScan(id, "扫描失败", message).catch(console.error);
    return Response.json({ error: message }, { status: /配置/.test(message) ? 503 : 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSessionValid(request)) return unauthorized();
  try {
    const { id } = await context.params;
    return (await deleteScan(id))
      ? Response.json({ ok: true })
      : Response.json({ error: "没有找到这条扫描记录。" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "删除扫描记录失败。" }, { status: 500 });
  }
}

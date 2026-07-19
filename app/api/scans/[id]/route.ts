import { isSessionValid, unauthorized } from "../../../../lib/auth";
import { scanPublicWeb } from "../../../../lib/scanner";
import { deleteScan, finishScan, getScan, markScanRunning, replaceMatches } from "../../../../lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSessionValid(request)) return unauthorized();
  const { id } = await context.params;
  try {
    const scan = await getScan(id);
    await markScanRunning(id);
    const result = await scanPublicWeb({
      url: scan.sourceUrl,
      title: scan.sourceTitle,
      text: scan.sourceText,
      imageUrls: scan.sourceImages,
      author: scan.sourceAuthor,
    }, scan.selectedPlatforms);
    await replaceMatches(id, result.matches);
    await finishScan(id, result.partial ? "部分完成" : "已完成", result.warnings.join("；") || null);
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

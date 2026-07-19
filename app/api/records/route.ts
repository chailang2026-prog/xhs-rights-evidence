import { createRecord, listRecords } from "../../../db/records";

export const runtime = "edge";

function isWebUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    return Response.json({ records: await listRecords() });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "暂时无法读取记录，请稍后再试。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!isWebUrl(body.infringementUrl)) {
      return Response.json({ error: "请填写有效的侵权内容链接。" }, { status: 400 });
    }
    if (body.sourceUrl && !isWebUrl(body.sourceUrl)) {
      return Response.json({ error: "原笔记链接格式不正确。" }, { status: 400 });
    }
    const record = await createRecord({
      infringementUrl: String(body.infringementUrl),
      platform: String(body.platform || "其他平台").slice(0, 40),
      infringementType: String(body.infringementType || "其他").slice(0, 40),
      sourceUrl: body.sourceUrl ? String(body.sourceUrl) : null,
      title: body.title ? String(body.title).trim().slice(0, 120) : null,
      discoveredAt: String(body.discoveredAt || new Date().toISOString().slice(0, 10)),
      notes: body.notes ? String(body.notes).trim().slice(0, 1000) : null,
    });
    return Response.json({ record }, { status: 201 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "保存失败，请稍后再试。" }, { status: 500 });
  }
}

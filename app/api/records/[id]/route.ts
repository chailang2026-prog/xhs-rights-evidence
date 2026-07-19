import {
  deleteRecord,
  recordStatuses,
  updateRecordStatus,
  type RecordStatus,
} from "../../../../db/records";

export const runtime = "edge";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { status?: string };
    if (!recordStatuses.includes(body.status as RecordStatus)) {
      return Response.json({ error: "无效的处理状态。" }, { status: 400 });
    }
    const found = await updateRecordStatus(id, body.status as RecordStatus);
    return found
      ? Response.json({ ok: true })
      : Response.json({ error: "没有找到这条记录。" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "更新失败，请稍后再试。" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const found = await deleteRecord(id);
    return found
      ? Response.json({ ok: true })
      : Response.json({ error: "没有找到这条记录。" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "删除失败，请稍后再试。" }, { status: 500 });
  }
}

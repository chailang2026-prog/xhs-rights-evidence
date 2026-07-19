import { isSessionValid, unauthorized } from "../../../../lib/auth";
import { updateMatchReview } from "../../../../lib/supabase";
import { reviewStatuses, type ReviewStatus } from "../../../../lib/types";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSessionValid(request)) return unauthorized();
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { reviewStatus?: string };
    if (!reviewStatuses.includes(body.reviewStatus as ReviewStatus)) {
      return Response.json({ error: "无效的复核状态。" }, { status: 400 });
    }
    return (await updateMatchReview(id, body.reviewStatus as ReviewStatus))
      ? Response.json({ ok: true })
      : Response.json({ error: "没有找到这条线索。" }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "更新复核状态失败。" }, { status: 500 });
  }
}


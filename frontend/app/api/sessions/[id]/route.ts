import { apiError, ok } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { getDownloadManager } from "@/lib/downloads";
import { deleteSession, getSession } from "@/lib/sessions";
import type { SessionDetail } from "@/lib/types";
import { isValidSessionId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidSessionId(id)) return apiError(400, "invalid_session");
  const session = await getSession(id);
  if (!session) return apiError(404, "not_found");
  const cfg = getConfig();
  // 判定は応答のときと同じ（chat の done イベント）
  const contextWarn = (session.lastContextTokens ?? 0) >= cfg.numCtx * cfg.contextWarnRatio;
  const body: SessionDetail = { ...session, contextWarn };
  return ok(body);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidSessionId(id)) return apiError(400, "invalid_session");
  if (getDownloadManager().isBusy()) return apiError(409, "busy");
  await deleteSession(id);
  return new Response(null, { status: 204 });
}

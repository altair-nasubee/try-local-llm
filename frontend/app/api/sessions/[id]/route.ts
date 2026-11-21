import { apiError, ok } from "@/lib/api";
import { getDownloadManager } from "@/lib/downloads";
import { deleteSession, getSession } from "@/lib/sessions";
import { isValidSessionId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidSessionId(id)) return apiError(400, "invalid_session");
  const session = await getSession(id);
  return session ? ok(session) : apiError(404, "not_found");
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidSessionId(id)) return apiError(400, "invalid_session");
  if (getDownloadManager().isBusy()) return apiError(409, "busy");
  await deleteSession(id);
  return new Response(null, { status: 204 });
}

import { apiError } from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import { getConfig } from "@/lib/config";
import { getDownloadManager } from "@/lib/downloads";
import { deleteModel, OllamaHttpError } from "@/lib/ollama";
import { isValidModelName } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// モデル削除。URL の name は encodeURIComponent したもの（gemma4:e4b → gemma4%3Ae4b）。
// Next.js は params をデコード済みで渡すため、ここではデコードしない（二重デコードを防ぐ）
export async function DELETE(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!isValidModelName(name)) return apiError(400, "invalid_model");
  if (name === getConfig().defaultModel) return apiError(400, "default_model");
  if (getDownloadManager().isBusy()) return apiError(409, "busy");

  const catalog = await getCatalog();
  if (!catalog.ollamaUp) return apiError(503, "ollama_down");
  if (!catalog.models.some((m) => m.name === name && m.installed)) return apiError(404, "not_installed");

  try {
    await deleteModel(name);
  } catch (e) {
    if (e instanceof OllamaHttpError) {
      return e.status === 404 ? apiError(404, "not_installed") : apiError(500, "failed", e.message);
    }
    return apiError(503, "ollama_down");
  }
  return new Response(null, { status: 204 });
}

import { apiError, ok, readJson } from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import { getDownloadManager } from "@/lib/downloads";
import { isValidModelName } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 今のダウンロード状態（画面はこれをポーリングする。リロード後の進捗ダイアログの再表示にも使う）
export async function GET() {
  return ok(getDownloadManager().state());
}

// ダウンロード開始：{ model }
export async function POST(req: Request) {
  const body = (await readJson(req)) as { model?: unknown } | undefined;
  const model = body?.model;
  if (typeof model !== "string" || !isValidModelName(model)) return apiError(400, "invalid_model");

  const catalog = await getCatalog();
  // Ollama が止まっている間は、モデルの有無が分からないので受け付けない
  if (!catalog.ollamaUp) return apiError(503, "ollama_down");
  const entry = catalog.models.find((m) => m.name === model);
  if (!entry) return apiError(400, "unknown_model");

  const result = await getDownloadManager().start(model, entry.sizeBytes);
  if (result.ok) return ok(getDownloadManager().state(), 202);
  return apiError(result.code === "busy" ? 409 : 507, result.code, result.message);
}

// 中止。エラー・完了の表示を閉じるときにも使う
export async function DELETE() {
  getDownloadManager().cancel();
  return ok(getDownloadManager().state());
}

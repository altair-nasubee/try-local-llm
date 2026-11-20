import { getCatalog } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// モデル一覧。Ollama 停止中も 200 で ollamaUp:false を返す（画面は再起動中の表示にする）
export async function GET() {
  return Response.json(await getCatalog(), { headers: { "cache-control": "no-store" } });
}

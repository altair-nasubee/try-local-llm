import { getCatalog } from "@/lib/catalog";
import { getConfig } from "@/lib/config";
import { refreshDiscovery } from "@/lib/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// モデル一覧。Ollama 停止中も 200 で ollamaUp:false を返す（画面は再起動中の表示にする）
export async function GET() {
  const cfg = getConfig();
  // 自動検索は最大 30 秒かかるため待たない。キャッシュが新しければ何もしない
  if (cfg.discoveryEnabled) void refreshDiscovery(cfg);
  return Response.json(await getCatalog(), { headers: { "cache-control": "no-store" } });
}

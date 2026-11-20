// サーバー起動時に 1 回だけ呼ばれる。
// Next.js は register() が終わるまでリクエストを受け付けないため、時間のかかる処理は待たない
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // サーバー専用モジュールは関数内で読み込む（Edge 用のビルドに fs を混ぜないため）
  const { getConfig } = await import("@/lib/config");
  const cfg = getConfig();
  if (cfg.discoveryEnabled) {
    const { refreshDiscovery } = await import("@/lib/discovery");
    void refreshDiscovery(cfg);
  }
}

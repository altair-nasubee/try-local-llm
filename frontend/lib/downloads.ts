// ダウンロード管理。サーバー側で 1 つだけ動かし、ブラウザはポーリングで状態を受け取る。
// ブラウザを閉じても続き、開き直すと同じ状態が見える（globalThis に保持）
import { getConfig } from "@/lib/config";
import { freeBytes as realFreeBytes } from "@/lib/disk";
import { t } from "@/lib/i18n";
import { pull as realPull, type PullEvent } from "@/lib/ollama";
import type { DownloadState, ModelsResponse } from "@/lib/types";

export type { PullEvent };

export type StartResult = { ok: true } | { ok: false; code: "busy" | "disk"; message: string };

export type DownloadManager = {
  state(): DownloadState;
  start(model: string, expectedBytes: number | null): Promise<StartResult>;
  cancel(): void;
  isBusy(): boolean;
  // 始められなかったことをエラーとして残す（起動時の自動ダウンロード用。画面のダイアログに出る）
  fail(model: string, message: string): void;
};

type Deps = {
  pull: (name: string, signal: AbortSignal) => AsyncIterable<PullEvent>;
  freeBytes: (path: string) => Promise<number>;
  dataDir: string;
};

// 展開や一時ファイルの分の余裕
const DISK_MARGIN = 1.1;
const gb = (bytes: number) => (Math.ceil((bytes / 1e9) * 10) / 10).toFixed(1);

export function createDownloadManager(deps: Deps): DownloadManager {
  let current: DownloadState = { status: "idle" };
  let checking = false; // 空き容量の確認中（この間も busy）
  let controller: AbortController | null = null;

  const isBusy = () => checking || current.status === "running";

  async function run(model: string, ctrl: AbortController, expectedBytes: number | null) {
    // レイヤーごとの進捗を合計する。Ollama はレイヤーを 1 つずつ知らせるため、まだ見えていないレイヤーがある間は
    // 合計が小さく出て進捗が戻って見える。分かっている大きさ（models.yaml・検索結果）を下限にする
    const layers = new Map<string, { completed: number; total: number }>();
    let succeeded = false;
    const stillMine = () => controller === ctrl && !ctrl.signal.aborted;
    try {
      for await (const ev of deps.pull(model, ctrl.signal)) {
        if (!stillMine()) return;
        if (ev.error) {
          current = { status: "error", model, message: ev.error };
          return;
        }
        if (typeof ev.total === "number" && ev.total > 0) {
          layers.set(ev.digest ?? ev.status, { completed: ev.completed ?? 0, total: ev.total });
          let completed = 0;
          let total = 0;
          for (const l of layers.values()) {
            completed += l.completed;
            total += l.total;
          }
          total = Math.max(total, expectedBytes ?? 0);
          current = { ...(current as Extract<DownloadState, { status: "running" }>), completed, total };
        }
        if (ev.status === "success") succeeded = true;
      }
      if (!stillMine()) return;
      current = succeeded ? { status: "done", model } : { status: "error", model, message: t("download.failed") };
    } catch (e) {
      if (!stillMine()) return; // 中止による例外
      current = { status: "error", model, message: e instanceof Error ? e.message : t("download.failed") };
    } finally {
      if (controller === ctrl) controller = null;
    }
  }

  return {
    state: () => current,
    isBusy,

    async start(model, expectedBytes) {
      // busy の判定と「確認中」の印は await の前に同期的に行う（同時に 2 回呼ばれても 1 つだけ始める）
      if (isBusy()) return { ok: false, code: "busy", message: t("download.running") };
      checking = true;
      try {
        if (expectedBytes !== null) {
          const free = await deps.freeBytes(deps.dataDir);
          const need = expectedBytes * DISK_MARGIN;
          // 浮動小数の誤差を避けるため整数で比べる（free < expected × 1.1）
          if (free * 10 < expectedBytes * 11) {
            return { ok: false, code: "disk", message: t("download.noSpace", { need: gb(need), free: gb(free) }) };
          }
        }
        const ctrl = new AbortController();
        controller = ctrl;
        current = {
          status: "running",
          model,
          completed: 0,
          total: expectedBytes ?? 0,
          startedAt: new Date().toISOString(),
        };
        void run(model, ctrl, expectedBytes);
        return { ok: true };
      } finally {
        checking = false;
      }
    },

    cancel() {
      if (current.status === "running") controller?.abort(new Error("cancelled"));
      controller = null;
      current = { status: "idle" };
    },

    fail(model, message) {
      if (isBusy()) return;
      current = { status: "error", model, message };
    },
  };
}

declare global {
  var __downloadManager: DownloadManager | undefined;
}

export function getDownloadManager(): DownloadManager {
  globalThis.__downloadManager ??= createDownloadManager({
    pull: realPull,
    freeBytes: realFreeBytes,
    dataDir: getConfig().dataDir,
  });
  return globalThis.__downloadManager;
}

// 起動時：Ollama の起動を待ち、デフォルトモデルが未インストールならダウンロードを始める。
// 例外は外に出さない（呼び出し元は await しない）
export async function ensureDefaultModel(deps: {
  defaultModel: string;
  isUp: () => Promise<boolean>;
  getCatalog: () => Promise<ModelsResponse>;
  start: (model: string, expectedBytes: number | null) => Promise<StartResult>;
  fail?: (model: string, message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + 10 * 60_000;
  try {
    while (now() < deadline) {
      if (await deps.isUp()) {
        const catalog = await deps.getCatalog();
        // 一覧の取得中に Ollama が落ちたら、未インストールと判定せず待ち直す
        if (catalog.ollamaUp) {
          const entry = catalog.models.find((m) => m.name === deps.defaultModel);
          if (!entry?.installed) {
            const result = await deps.start(deps.defaultModel, entry?.sizeBytes ?? null);
            // 空き容量不足などで始められなかったら、画面に出す（spec 11-5）
            if (!result.ok && result.code === "disk") deps.fail?.(deps.defaultModel, result.message);
          }
          return;
        }
      }
      await sleep(5000);
    }
  } catch {
    // 起動時の処理なので、失敗しても何もしない（画面からダウンロードできる）
  }
}

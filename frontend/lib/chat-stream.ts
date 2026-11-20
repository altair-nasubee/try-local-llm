// チャットのストリーム処理：無応答タイムアウトと、Ollama のエラーの分類
import { OllamaHttpError, OllamaStreamError } from "@/lib/ollama";

export class IdleTimeoutError extends Error {
  constructor(readonly idleMs: number) {
    super(`no response for ${idleMs}ms`);
    this.name = "IdleTimeoutError";
  }
}

// 最後のチャンク（または開始）から idleMs 以上なにも来なければ IdleTimeoutError を投げる。
// 応答全体の時間では切らない（低速モデルの長い正常な回答を途中で切らないため。spec 11-1）
export async function* streamWithIdleTimeout<T>(
  src: AsyncIterable<T>,
  idleMs: number,
  signal: AbortSignal,
): AsyncIterable<T> {
  const it = src[Symbol.asyncIterator]();
  let finished = false;
  try {
    while (true) {
      signal.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const stop = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IdleTimeoutError(idleMs)), idleMs);
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      let result: IteratorResult<T>;
      try {
        result = await Promise.race([it.next(), stop]);
      } finally {
        clearTimeout(timer);
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
      if (result.done) {
        finished = true;
        return;
      }
      yield result.value;
    }
  } finally {
    // タイムアウト・中止・呼び出し側の break では元のストリームも閉じる（待たない）
    if (!finished) void it.return?.()?.catch?.(() => {});
  }
}

// コンテナのメモリ上限でモデルの実行プロセスが落ちた／読み込みを拒否されたときの Ollama の文言（版によって違う）
const TOO_HEAVY = [
  "unexpectedly stopped",
  "out of memory",
  "requires more system memory",
  "exit status",
  "signal: killed",
  "process has terminated",
  "no longer running",
  "error was encountered while running the model",
];

// 応答の途中で接続そのものが切れた（コンテナごと落ちた）ときの fetch の例外
const CONNECTION_LOST = new Set(["ECONNRESET", "UND_ERR_SOCKET", "EPIPE"]);

function isConnectionLost(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const code = (err.cause as { code?: string } | undefined)?.code;
  return err.message === "terminated" || (code !== undefined && CONNECTION_LOST.has(code));
}

// ollama_down: Ollama 自体が応答しない（コンテナの再起動中）
// too_heavy  : Ollama は生きているが、モデルの実行プロセスがメモリ不足で落ちた／読み込みを拒否した
export function classifyOllamaError(err: unknown, up: boolean): "ollama_down" | "too_heavy" | "failed" {
  // 接続が切れたあと、確かめる前に再起動が終わっていても ollama_down とする
  if (!up || isConnectionLost(err)) return "ollama_down";
  const message = err instanceof OllamaHttpError || err instanceof OllamaStreamError || err instanceof Error ? err.message : "";
  const lower = message.toLowerCase();
  return TOO_HEAVY.some((k) => lower.includes(k)) ? "too_heavy" : "failed";
}

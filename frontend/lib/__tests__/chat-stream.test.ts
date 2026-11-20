import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyOllamaError, IdleTimeoutError, streamWithIdleTimeout } from "@/lib/chat-stream";
import { OllamaHttpError, OllamaStreamError } from "@/lib/ollama";

afterEach(() => vi.useRealTimers());

// delays[i] ミリ秒待ってから i 番目を返す
async function* timed(delays: number[]) {
  for (let i = 0; i < delays.length; i++) {
    await new Promise((r) => setTimeout(r, delays[i]));
    yield i;
  }
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("streamWithIdleTimeout", () => {
  it("チャンク間が idleMs を超えたら IdleTimeoutError", async () => {
    vi.useFakeTimers();
    const out: number[] = [];
    const done = (async () => {
      for await (const v of streamWithIdleTimeout(timed([10, 10, 500]), 100, new AbortController().signal)) out.push(v);
    })();
    const result = expect(done).rejects.toBeInstanceOf(IdleTimeoutError);
    await vi.advanceTimersByTimeAsync(200);
    await result;
    expect(out).toEqual([0, 1]);
  });

  it("最初のチャンクまでの無応答も数える", async () => {
    vi.useFakeTimers();
    const p = collect(streamWithIdleTimeout(timed([150]), 100, new AbortController().signal));
    const result = expect(p).rejects.toBeInstanceOf(IdleTimeoutError);
    await vi.advanceTimersByTimeAsync(150);
    await result;
  });

  it("チャンクが来続ければ総時間が idleMs を超えても切らない", async () => {
    vi.useFakeTimers();
    const p = collect(streamWithIdleTimeout(timed(Array(10).fill(80)), 100, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("signal が abort されたら待つのをやめて abort の理由で終わる", async () => {
    const ctrl = new AbortController();
    const p = collect(streamWithIdleTimeout(timed([10_000]), 60_000, ctrl.signal));
    ctrl.abort(new Error("client gone"));
    await expect(p).rejects.toThrow("client gone");
  });

  it("タイムアウトしたら元のイテレーターを閉じる", async () => {
    vi.useFakeTimers();
    let closed = false;
    async function* src() {
      try {
        yield 1;
        await new Promise((r) => setTimeout(r, 10_000));
        yield 2;
      } finally {
        closed = true;
      }
    }
    const p = collect(streamWithIdleTimeout(src(), 100, new AbortController().signal));
    const result = expect(p).rejects.toBeInstanceOf(IdleTimeoutError);
    await vi.advanceTimersByTimeAsync(10_100);
    await result;
    expect(closed).toBe(true);
  });
});

describe("classifyOllamaError", () => {
  it("Ollama が応答しなければ ollama_down", () => {
    expect(classifyOllamaError(new Error("read ECONNRESET"), false)).toBe("ollama_down");
  });

  it.each([
    "model runner has unexpectedly stopped, this may be due to resource limitations",
    "llama runner process has terminated: exit status 2",
    "model requires more system memory (24.0 GiB) than is available (20.1 GiB)",
    "CUDA error: out of memory",
  ])("「%s」は too_heavy", (msg) => {
    expect(classifyOllamaError(new OllamaHttpError(500, `Ollama 500: ${msg}`), true)).toBe("too_heavy");
    expect(classifyOllamaError(new OllamaStreamError(msg), true)).toBe("too_heavy");
  });

  it("その他は failed", () => {
    expect(classifyOllamaError(new OllamaHttpError(400, "Ollama 400: invalid model"), true)).toBe("failed");
    expect(classifyOllamaError("weird", true)).toBe("failed");
  });
});

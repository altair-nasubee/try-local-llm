import { describe, expect, it, vi } from "vitest";
import { createDownloadManager, ensureDefaultModel, type PullEvent } from "@/lib/downloads";
import type { ModelsResponse } from "@/lib/types";

// 外から 1 行ずつ流せる偽の pull
function controllablePull() {
  const queue: (PullEvent | Error | "end")[] = [];
  let wake: (() => void) | null = null;
  let signal: AbortSignal | undefined;
  const pull = vi.fn(async function* (_name: string, s: AbortSignal) {
    signal = s;
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((r) => {
          wake = r;
          s.addEventListener("abort", () => r(), { once: true });
        });
      }
      if (s.aborted) throw s.reason;
      const next = queue.shift();
      if (next === undefined) continue;
      if (next === "end") return;
      if (next instanceof Error) throw next;
      yield next;
    }
  });
  const push = (e: PullEvent | Error | "end") => {
    queue.push(e);
    wake?.();
  };
  return { pull, push, signal: () => signal };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function manager(opts: { free?: number } = {}) {
  const p = controllablePull();
  const m = createDownloadManager({
    pull: p.pull,
    freeBytes: async () => opts.free ?? 100e9,
    dataDir: "/data",
  });
  return { m, ...p };
}

describe("DownloadManager", () => {
  it("進捗を state に反映し、完了で done になる", async () => {
    const { m, push } = manager();
    await expect(m.start("gemma4:e4b", 6.6e9)).resolves.toEqual({ ok: true });
    expect(m.state()).toMatchObject({ status: "running", model: "gemma4:e4b", completed: 0 });
    push({ status: "pulling manifest" });
    push({ status: "pulling aaa", digest: "sha256:aaa", total: 6e9, completed: 1e9 });
    push({ status: "pulling bbb", digest: "sha256:bbb", total: 6e8, completed: 6e8 });
    await flush();
    expect(m.state()).toMatchObject({ status: "running", completed: 1.6e9, total: 6.6e9 });
    push({ status: "pulling aaa", digest: "sha256:aaa", total: 6e9, completed: 6e9 });
    push({ status: "success" });
    push("end");
    await vi.waitFor(() => expect(m.state()).toEqual({ status: "done", model: "gemma4:e4b" }));
    expect(m.isBusy()).toBe(false);
  });

  it("実行中に start すると busy を返す", async () => {
    const { m } = manager();
    await m.start("a:1b", 1e9);
    await expect(m.start("b:1b", 1e9)).resolves.toMatchObject({ ok: false, code: "busy" });
    expect(m.isBusy()).toBe(true);
  });

  it("start を await せずに 2 回続けて呼んでも、2 回目は busy", async () => {
    const { m, pull } = manager();
    const first = m.start("a:1b", 1e9);
    const second = m.start("b:1b", 1e9);
    await expect(second).resolves.toMatchObject({ ok: false, code: "busy" });
    await expect(first).resolves.toEqual({ ok: true });
    await flush();
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("空き容量 < expectedBytes * 1.1 なら disk を返し開始しない", async () => {
    const { m, pull } = manager({ free: 7e9 });
    const res = await m.start("gemma4:e4b", 6.6e9); // 6.6 * 1.1 = 7.26GB 必要
    expect(res).toMatchObject({ ok: false, code: "disk" });
    expect((res as { message: string }).message).toContain("7.3");
    expect(pull).not.toHaveBeenCalled();
    expect(m.state()).toEqual({ status: "idle" });
    expect(m.isBusy()).toBe(false);
  });

  it("空き容量がちょうど足りれば開始する", async () => {
    const { m } = manager({ free: 7.26e9 });
    await expect(m.start("gemma4:e4b", 6.6e9)).resolves.toEqual({ ok: true });
  });

  it("サイズ不明なら空き容量で止めない", async () => {
    const { m } = manager({ free: 1 });
    await expect(m.start("x:1b", null)).resolves.toEqual({ ok: true });
  });

  it("cancel で AbortSignal が発火し state が idle に戻る", async () => {
    const { m, signal, push } = manager();
    await m.start("a:1b", 1e9);
    push({ status: "pulling a", digest: "a", total: 1e9, completed: 1 });
    await flush();
    m.cancel();
    expect(signal()?.aborted).toBe(true);
    expect(m.state()).toEqual({ status: "idle" });
    await flush();
    expect(m.state()).toEqual({ status: "idle" }); // 中止の例外で error にならない
    expect(m.isBusy()).toBe(false);
  });

  it("pull が error 行を返したら state は error（message 付き）", async () => {
    const { m, push } = manager();
    await m.start("a:1b", 1e9);
    push({ status: "", error: "pull model manifest: file does not exist" });
    await vi.waitFor(() =>
      expect(m.state()).toEqual({ status: "error", model: "a:1b", message: "pull model manifest: file does not exist" }),
    );
    expect(m.isBusy()).toBe(false);
  });

  it("pull が例外を出したら state は error", async () => {
    const { m, push } = manager();
    await m.start("a:1b", 1e9);
    push(new TypeError("fetch failed"));
    await vi.waitFor(() => expect(m.state()).toMatchObject({ status: "error", model: "a:1b" }));
  });

  it("success の前に終わったら error", async () => {
    const { m, push } = manager();
    await m.start("a:1b", 1e9);
    push("end");
    await vi.waitFor(() => expect(m.state()).toMatchObject({ status: "error", model: "a:1b" }));
  });

  it("done/error の後の start は受け付ける", async () => {
    const { m, push } = manager();
    await m.start("a:1b", 1e9);
    push({ status: "success" });
    push("end");
    await vi.waitFor(() => expect(m.state().status).toBe("done"));
    await expect(m.start("b:1b", 1e9)).resolves.toEqual({ ok: true });
    expect(m.state()).toMatchObject({ status: "running", model: "b:1b" });
  });

  it("error 状態で cancel すると idle に戻る", async () => {
    const { m, push } = manager();
    await m.start("a:1b", 1e9);
    push({ status: "", error: "boom" });
    await vi.waitFor(() => expect(m.state().status).toBe("error"));
    m.cancel();
    expect(m.state()).toEqual({ status: "idle" });
  });
});

describe("ensureDefaultModel（起動時の自動ダウンロード）", () => {
  const catalog = (installed: boolean, ollamaUp = true): ModelsResponse => ({
    defaultModel: "gemma4:e4b",
    ollamaUp,
    models: [
      { name: "gemma4:e4b", sizeBytes: 6.6e9, tier: "comfort", installed, capabilities: [], source: "yaml" },
    ],
  });

  it("Ollama が応答するまで待ち、未インストールなら一覧のサイズで start する", async () => {
    const isUp = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const start = vi.fn().mockResolvedValue({ ok: true });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await ensureDefaultModel({ defaultModel: "gemma4:e4b", isUp, getCatalog: async () => catalog(false), start, sleep });
    expect(isUp).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(start).toHaveBeenCalledWith("gemma4:e4b", 6.6e9);
  });

  it("インストール済みなら何もしない", async () => {
    const start = vi.fn();
    await ensureDefaultModel({
      defaultModel: "gemma4:e4b",
      isUp: async () => true,
      getCatalog: async () => catalog(true),
      start,
      sleep: async () => {},
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("10 分たっても Ollama が応答しなければあきらめる", async () => {
    let now = 0;
    const start = vi.fn();
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    await ensureDefaultModel({
      defaultModel: "gemma4:e4b",
      isUp: async () => false,
      getCatalog: async () => catalog(false),
      start,
      sleep,
      now: () => now,
    });
    expect(start).not.toHaveBeenCalled();
    expect(now).toBeGreaterThanOrEqual(600_000);
    expect(now).toBeLessThan(610_000);
  });

  it("一覧の取得時に Ollama が落ちていたら、未インストールと判定せず待ち直す", async () => {
    const getCatalog = vi.fn().mockResolvedValueOnce(catalog(false, false)).mockResolvedValue(catalog(true));
    const start = vi.fn();
    await ensureDefaultModel({
      defaultModel: "gemma4:e4b",
      isUp: async () => true,
      getCatalog,
      start,
      sleep: async () => {},
    });
    expect(getCatalog).toHaveBeenCalledTimes(2);
    expect(start).not.toHaveBeenCalled();
  });

  it("例外を外に出さない", async () => {
    await expect(
      ensureDefaultModel({
        defaultModel: "gemma4:e4b",
        isUp: async () => true,
        getCatalog: async () => {
          throw new Error("boom");
        },
        start: vi.fn(),
        sleep: async () => {},
      }),
    ).resolves.toBeUndefined();
  });

  it("空き容量不足で始められなかったら、エラーとして残す（画面に出すため）", async () => {
    const fail = vi.fn();
    await ensureDefaultModel({
      defaultModel: "gemma4:e4b",
      isUp: async () => true,
      getCatalog: async () => catalog(false),
      start: async () => ({ ok: false, code: "disk", message: "空きが足りません" }),
      fail,
      sleep: async () => {},
    });
    expect(fail).toHaveBeenCalledWith("gemma4:e4b", "空きが足りません");
  });
});

describe("DownloadManager.fail", () => {
  it("error 状態にし、cancel で idle に戻る", () => {
    const m = createDownloadManager({ pull: vi.fn(), freeBytes: async () => 1, dataDir: "/d" });
    m.fail("a:1b", "空きが足りません");
    expect(m.state()).toEqual({ status: "error", model: "a:1b", message: "空きが足りません" });
    expect(m.isBusy()).toBe(false);
    m.cancel();
    expect(m.state()).toEqual({ status: "idle" });
  });
});

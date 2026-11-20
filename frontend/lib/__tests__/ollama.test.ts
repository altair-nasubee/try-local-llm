import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chat,
  deleteModel,
  isUp,
  listInstalled,
  OllamaHttpError,
  OllamaStreamError,
  pull,
  readNdjson,
  showModel,
} from "@/lib/ollama";
import { downFetch, fakeFetch, json } from "./helpers/fake-fetch";

beforeEach(() => {
  vi.stubEnv("OLLAMA_URL", "http://ollama.test:11434");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ollama client", () => {
  it("listInstalled は /api/tags の名前とサイズを返す", async () => {
    const f = fakeFetch({
      "GET /api/tags": () =>
        json({ models: [{ name: "gemma4:e4b", size: 6_600_000_000, digest: "x" }] }),
    });
    vi.stubGlobal("fetch", f.fetch);
    await expect(listInstalled()).resolves.toEqual([{ name: "gemma4:e4b", size: 6_600_000_000 }]);
    expect(f.fetch.mock.calls[0][0].toString()).toBe("http://ollama.test:11434/api/tags");
  });

  it("showModel は capabilities を返し、無ければ空配列", async () => {
    const f = fakeFetch({
      "POST /api/show": ({ body }) =>
        (body as { model: string }).model === "a:1"
          ? json({ capabilities: ["completion", "vision"] })
          : json({}),
    });
    vi.stubGlobal("fetch", f.fetch);
    await expect(showModel("a:1")).resolves.toEqual({ capabilities: ["completion", "vision"] });
    await expect(showModel("b:1")).resolves.toEqual({ capabilities: [] });
  });

  it("deleteModel は DELETE /api/delete に model を送る", async () => {
    const f = fakeFetch({ "DELETE /api/delete": () => new Response(null, { status: 200 }) });
    vi.stubGlobal("fetch", f.fetch);
    await deleteModel("gemma4:12b");
    expect(f.calls).toEqual([{ method: "DELETE", path: "/api/delete", body: { model: "gemma4:12b" } }]);
  });

  it("Ollama のエラー応答は status 付きの OllamaHttpError にする", async () => {
    const f = fakeFetch({ "DELETE /api/delete": () => json({ error: "model not found" }, 404) });
    vi.stubGlobal("fetch", f.fetch);
    const err = await deleteModel("x:1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OllamaHttpError);
    expect((err as OllamaHttpError).status).toBe(404);
    expect((err as OllamaHttpError).message).toContain("model not found");
  });

  it("isUp は /api/version が 200 なら true", async () => {
    vi.stubGlobal("fetch", fakeFetch({ "GET /api/version": () => json({ version: "0.40.16" }) }).fetch);
    await expect(isUp()).resolves.toBe(true);
  });

  it("isUp は接続できなければ false（例外を出さない）", async () => {
    vi.stubGlobal("fetch", downFetch());
    await expect(isUp()).resolves.toBe(false);
  });

  it("isUp は応答が 2 秒来なければ false", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_input: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
            }),
        ),
      );
      const result = isUp();
      await vi.advanceTimersByTimeAsync(2000);
      await expect(result).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pull は stream:true で POST し、NDJSON を 1 行ずつ返す", async () => {
    const f = fakeFetch({
      "POST /api/pull": () =>
        new Response(
          '{"status":"pulling manifest"}\n{"status":"pulling a","digest":"a","total":10,"completed":5}\n{"status":"success"}\n',
        ),
    });
    vi.stubGlobal("fetch", f.fetch);
    const events = [];
    for await (const e of pull("gemma4:e4b", new AbortController().signal)) events.push(e);
    expect(f.calls[0]).toEqual({ method: "POST", path: "/api/pull", body: { model: "gemma4:e4b", stream: true } });
    expect(events).toEqual([
      { status: "pulling manifest" },
      { status: "pulling a", digest: "a", total: 10, completed: 5 },
      { status: "success" },
    ]);
  });
});

describe("chat", () => {
  const signal = () => new AbortController().signal;
  const params = {
    model: "gemma4:e4b",
    messages: [{ role: "user" as const, content: "hi", images: ["AAAA"] }],
    think: true,
    numCtx: 8192,
  };

  it("stream:true・think・num_ctx を付けて POST し、チャンクを返す", async () => {
    const f = fakeFetch({
      "POST /api/chat": () =>
        new Response(
          '{"message":{"role":"assistant","content":"","thinking":"ふむ"},"done":false}\n' +
            '{"message":{"role":"assistant","content":"こん"},"done":false}\n' +
            '{"message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":10,"eval_count":5}\n',
        ),
    });
    vi.stubGlobal("fetch", f.fetch);
    const chunks = [];
    for await (const c of chat(params, signal())) chunks.push(c);
    expect(f.calls[0].body).toEqual({
      model: "gemma4:e4b",
      messages: [{ role: "user", content: "hi", images: ["AAAA"] }],
      think: true,
      stream: true,
      options: { num_ctx: 8192 },
    });
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toMatchObject({ done: true, prompt_eval_count: 10, eval_count: 5 });
  });

  it("HTTP エラーは error の文を持つ OllamaHttpError", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ "POST /api/chat": () => json({ error: "model requires more system memory" }, 500) }).fetch,
    );
    const it = chat(params, signal())[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toThrow(/requires more system memory/);
  });

  it("ストリームの途中の error 行は OllamaStreamError", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "POST /api/chat": () =>
          new Response('{"message":{"content":"a"},"done":false}\n{"error":"model runner has unexpectedly stopped"}\n'),
      }).fetch,
    );
    const got: unknown[] = [];
    const err = await (async () => {
      for await (const c of chat(params, signal())) got.push(c);
    })().catch((e: unknown) => e);
    expect(got).toHaveLength(1);
    expect(err).toBeInstanceOf(OllamaStreamError);
    expect((err as Error).message).toBe("model runner has unexpectedly stopped");
  });
});

describe("readNdjson", () => {
  function streamOf(chunks: string[]) {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
  }

  it("1 行が 2 チャンクに分かれても、1 チャンクに 2 行あっても 1 行ずつ返す", async () => {
    const out = [];
    for await (const v of readNdjson<{ n: number }>(streamOf(['{"n":1}\n{"n"', ':2}\n{"n":3}\n']))) out.push(v);
    expect(out).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("最後の行に改行が無くても返し、空行は飛ばす", async () => {
    const out = [];
    for await (const v of readNdjson<{ n: number }>(streamOf(['{"n":1}\n\n', '{"n":2}']))) out.push(v);
    expect(out).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("マルチバイト文字がチャンクの境目で分かれても壊れない", async () => {
    const bytes = new TextEncoder().encode('{"t":"日本語"}\n');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 9));
        c.enqueue(bytes.slice(9));
        c.close();
      },
    });
    const out = [];
    for await (const v of readNdjson<{ t: string }>(stream)) out.push(v);
    expect(out).toEqual([{ t: "日本語" }]);
  });
});

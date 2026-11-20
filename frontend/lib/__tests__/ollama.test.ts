import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteModel, isUp, listInstalled, OllamaHttpError, showModel } from "@/lib/ollama";
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
});

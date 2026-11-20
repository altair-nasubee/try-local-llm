import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/models/download/route";
import { downFetch, fakeFetch, json } from "@/lib/__tests__/helpers/fake-fetch";
import type { DownloadManager } from "@/lib/downloads";
import type { DownloadState } from "@/lib/types";

let dir: string;
let manager: DownloadManager & { start: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
let state: DownloadState;

const ollamaUp = () =>
  fakeFetch({
    "GET /api/version": () => json({ version: "x" }),
    "GET /api/tags": () => json({ models: [] }),
  }).fetch;

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/models/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dl-route-"));
  const p = path.join(dir, "models.yaml");
  writeFileSync(p, 'families: []\nmodels:\n  - { name: "gemma4:e4b", sizeGb: 6.6 }\n  - { name: "gemma4:12b", sizeGb: 8 }\n');
  vi.stubEnv("MODELS_YAML_PATH", p);
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("OLLAMA_URL", "http://ollama.test:11434");
  vi.stubEnv("DISCOVERY_ENABLED", "false");
  state = { status: "idle" };
  manager = {
    state: () => state,
    isBusy: () => state.status === "running",
    start: vi.fn(async () => ({ ok: true as const })),
    cancel: vi.fn(() => {
      state = { status: "idle" };
    }),
    fail: vi.fn(),
  };
  globalThis.__downloadManager = manager;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.__downloadManager = undefined;
});

describe("/api/models/download", () => {
  it("GET は今の状態を返す", async () => {
    state = { status: "running", model: "gemma4:12b", completed: 1, total: 2, startedAt: "t" };
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(state);
  });

  it("POST は一覧のサイズで start し 202", async () => {
    vi.stubGlobal("fetch", ollamaUp());
    const res = await post({ model: "gemma4:12b" });
    expect(res.status).toBe(202);
    expect(manager.start).toHaveBeenCalledWith("gemma4:12b", 8e9);
  });

  it("形式の違うモデル名は 400", async () => {
    vi.stubGlobal("fetch", ollamaUp());
    const res = await post({ model: "../x" });
    expect(res.status).toBe(400);
    expect(manager.start).not.toHaveBeenCalled();
  });

  it("壊れた JSON は 400", async () => {
    expect((await post("{")).status).toBe(400);
  });

  it("一覧に無いモデル名は 400", async () => {
    vi.stubGlobal("fetch", ollamaUp());
    const res = await post({ model: "nothere:1b" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "unknown_model" });
  });

  it("Ollama 停止中は 503 ollama_down", async () => {
    vi.stubGlobal("fetch", downFetch());
    const res = await post({ model: "gemma4:12b" });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "ollama_down" });
  });

  it("busy なら 409、空き容量不足なら 507", async () => {
    vi.stubGlobal("fetch", ollamaUp());
    manager.start.mockResolvedValueOnce({ ok: false, code: "busy", message: "b" });
    const busy = await post({ model: "gemma4:12b" });
    expect(busy.status).toBe(409);
    await expect(busy.json()).resolves.toEqual({ error: "busy", message: "b" });
    manager.start.mockResolvedValueOnce({ ok: false, code: "disk", message: "d" });
    const disk = await post({ model: "gemma4:12b" });
    expect(disk.status).toBe(507);
    await expect(disk.json()).resolves.toEqual({ error: "disk", message: "d" });
  });

  it("DELETE は cancel して状態を返す", async () => {
    state = { status: "error", model: "x:1b", message: "m" };
    const res = await DELETE();
    expect(manager.cancel).toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ status: "idle" });
  });
});

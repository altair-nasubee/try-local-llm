import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/models/[name]/route";
import { downFetch, fakeFetch, json } from "@/lib/__tests__/helpers/fake-fetch";

let dir: string;
let busy: boolean;

const installed = ["gemma4:e4b", "gemma4:12b", "hf.co/user/repo:Q4_K_M"];

function ollama() {
  return fakeFetch({
    "GET /api/version": () => json({ version: "x" }),
    "GET /api/tags": () => json({ models: installed.map((name) => ({ name, size: 5e9 })) }),
    "POST /api/show": () => json({ capabilities: [] }),
    "DELETE /api/delete": () => new Response(null, { status: 200 }),
  });
}

// Next.js 16 は params をデコード済みで渡す（next start で確認：/api/models/gemma4%3Ae4b → "gemma4:e4b"）
const del = (decodedName: string) =>
  DELETE(new Request(`http://localhost/api/models/${encodeURIComponent(decodedName)}`, { method: "DELETE" }), {
    params: Promise.resolve({ name: decodedName }),
  });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "del-route-"));
  const p = path.join(dir, "models.yaml");
  writeFileSync(p, 'families: []\nmodels:\n  - { name: "gemma4:e4b", sizeGb: 6.6 }\n  - { name: "gemma4:26b", sizeGb: 18 }\n');
  vi.stubEnv("MODELS_YAML_PATH", p);
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("OLLAMA_URL", "http://ollama.test:11434");
  vi.stubEnv("DEFAULT_MODEL", "gemma4:e4b");
  busy = false;
  globalThis.__downloadManager = {
    state: () => ({ status: "idle" }),
    isBusy: () => busy,
    start: vi.fn(),
    cancel: vi.fn(),
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.__downloadManager = undefined;
});

describe("DELETE /api/models/:name", () => {
  it("通常は deleteModel を呼び 204", async () => {
    const f = ollama();
    vi.stubGlobal("fetch", f.fetch);
    const res = await del("gemma4:12b");
    expect(res.status).toBe(204);
    expect(f.calls).toContainEqual({ method: "DELETE", path: "/api/delete", body: { model: "gemma4:12b" } });
  });

  it("デフォルトモデルは 400", async () => {
    const f = ollama();
    vi.stubGlobal("fetch", f.fetch);
    const res = await del("gemma4:e4b");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "default_model" });
    expect(f.calls.some((c) => c.path === "/api/delete")).toBe(false);
  });

  it("ダウンロード中は 409", async () => {
    vi.stubGlobal("fetch", ollama().fetch);
    busy = true;
    const res = await del("gemma4:12b");
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "busy" });
  });

  it("未インストールは 404", async () => {
    vi.stubGlobal("fetch", ollama().fetch);
    expect((await del("gemma4:26b")).status).toBe(404);
  });

  it("..%2Fetc:x（デコード後 ../etc:x）は 400", async () => {
    const f = ollama();
    vi.stubGlobal("fetch", f.fetch);
    const res = await del("../etc:x");
    expect(res.status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });

  it("二重にエンコードされた名前（Next がデコードしても % が残る）は通さない", async () => {
    vi.stubGlobal("fetch", ollama().fetch);
    expect((await del("gemma4%3A12b")).status).toBe(400);
  });

  it("hf.co/user/repo:Q4_K_M は形式チェックを通る", async () => {
    const f = ollama();
    vi.stubGlobal("fetch", f.fetch);
    const res = await del("hf.co/user/repo:Q4_K_M");
    expect(res.status).toBe(204);
    expect(f.calls).toContainEqual({ method: "DELETE", path: "/api/delete", body: { model: "hf.co/user/repo:Q4_K_M" } });
  });

  it("Ollama 停止中は 503", async () => {
    vi.stubGlobal("fetch", downFetch());
    const res = await del("gemma4:12b");
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "ollama_down" });
  });

  it("Ollama が削除時に 404 を返したら 404", async () => {
    const f = fakeFetch({
      "GET /api/version": () => json({ version: "x" }),
      "GET /api/tags": () => json({ models: [{ name: "gemma4:12b", size: 5e9 }] }),
      "POST /api/show": () => json({}),
      "DELETE /api/delete": () => json({ error: "model not found" }, 404),
    });
    vi.stubGlobal("fetch", f.fetch);
    expect((await del("gemma4:12b")).status).toBe(404);
  });

  it("Ollama が削除時に 500 を返したら 500 failed", async () => {
    const f = fakeFetch({
      "GET /api/version": () => json({ version: "x" }),
      "GET /api/tags": () => json({ models: [{ name: "gemma4:12b", size: 5e9 }] }),
      "POST /api/show": () => json({}),
      "DELETE /api/delete": () => json({ error: "disk busy" }, 500),
    });
    vi.stubGlobal("fetch", f.fetch);
    const res = await del("gemma4:12b");
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "failed" });
  });
});

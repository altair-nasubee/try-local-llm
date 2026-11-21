import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { GET as models } from "@/app/api/models/route";
import { downFetch, fakeFetch, json } from "@/lib/__tests__/helpers/fake-fetch";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "routes-"));
  const p = path.join(dir, "models.yaml");
  writeFileSync(p, 'families: []\nmodels:\n  - { name: "gemma4:e4b", sizeGb: 6.6 }\n');
  vi.stubEnv("MODELS_YAML_PATH", p);
  vi.stubEnv("OLLAMA_URL", "http://ollama.test:11434");
  vi.stubEnv("DISCOVERY_ENABLED", "false");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/models", () => {
  it("Ollama 停止中も 200 で ollamaUp:false を返す", async () => {
    vi.stubGlobal("fetch", downFetch());
    const res = await models();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ollamaUp: false, defaultModel: "gemma4:e4b" });
    expect(body.models[0]).toMatchObject({ name: "gemma4:e4b", installed: false });
  });

  it("応答をキャッシュさせない", async () => {
    vi.stubGlobal("fetch", downFetch());
    const res = await models();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("GET /api/models と自動検索", () => {
  const searched = (f: ReturnType<typeof downFetch>) =>
    f.mock.calls.some((c) => String((c as unknown[])[0]).startsWith("https://ollama.com/"));

  it("DISCOVERY_ENABLED=true なら裏で検索を始める（応答は待たない）", async () => {
    vi.stubEnv("DISCOVERY_ENABLED", "true");
    vi.stubEnv("DATA_DIR", dir);
    writeFileSync(path.join(dir, "models.yaml"), "families: [gemma4]\nmodels: []\n");
    const f = downFetch();
    vi.stubGlobal("fetch", f);
    const res = await models();
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(searched(f)).toBe(true));
  });

  it("DISCOVERY_ENABLED=false なら外部に出ない", async () => {
    vi.stubEnv("DATA_DIR", dir);
    writeFileSync(path.join(dir, "models.yaml"), "families: [gemma4]\nmodels: []\n");
    const f = downFetch();
    vi.stubGlobal("fetch", f);
    await models();
    await new Promise((r) => setTimeout(r, 50));
    expect(searched(f)).toBe(false);
  });
});

describe("GET /api/health", () => {
  it("Ollama が応答すれば ollamaUp:true", async () => {
    vi.stubGlobal("fetch", fakeFetch({ "GET /api/version": () => json({ version: "x" }) }).fetch);
    const res = await health();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ollamaUp: true });
  });

  it("Ollama 停止中は ollamaUp:false", async () => {
    vi.stubGlobal("fetch", downFetch());
    await expect((await health()).json()).resolves.toEqual({ ollamaUp: false });
  });
});

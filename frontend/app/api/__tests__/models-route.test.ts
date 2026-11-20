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

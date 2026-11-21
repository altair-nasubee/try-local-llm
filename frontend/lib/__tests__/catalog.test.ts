import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalog, getCatalog, loadYaml, type YamlModels } from "@/lib/catalog";
import { getConfig } from "@/lib/config";
import { downFetch, fakeFetch, json } from "./helpers/fake-fetch";

const cfg = getConfig({ DEFAULT_MODEL: "gemma4:e4b", TIER_COMFORT_MAX_GB: "7", TIER_EXCLUDE_MIN_GB: "20" });

const yaml: YamlModels = {
  families: ["gemma4"],
  models: [
    { name: "gemma4:e4b", sizeGb: 6.6 },
    { name: "gemma4:12b", sizeGb: 8 },
    { name: "gemma4:26b", sizeGb: 18 },
  ],
};

const names = (entries: { name: string }[]) => entries.map((e) => e.name);

describe("buildCatalog", () => {
  it("excluded を除き、同名は installed を優先し実サイズで判定する", () => {
    const list = buildCatalog({
      yaml,
      installed: [{ name: "gemma4:12b", size: 6e9, capabilities: ["completion"] }],
      discovered: [],
      cfg,
    });
    const m = list.find((e) => e.name === "gemma4:12b");
    expect(m).toEqual({
      name: "gemma4:12b",
      sizeBytes: 6e9,
      tier: "comfort",
      installed: true,
      capabilities: ["completion"],
      source: "installed",
    });
    expect(list.filter((e) => e.name === "gemma4:12b")).toHaveLength(1);
  });

  it("未インストールの yaml モデルは sizeGb から判定し、capabilities は空", () => {
    const list = buildCatalog({ yaml, installed: [], discovered: [], cfg });
    expect(list.find((e) => e.name === "gemma4:26b")).toEqual({
      name: "gemma4:26b",
      sizeBytes: 18e9,
      tier: "slow",
      installed: false,
      capabilities: [],
      source: "yaml",
    });
  });

  it("yaml に無い installed も出す", () => {
    const list = buildCatalog({
      yaml,
      installed: [{ name: "phi4:14b", size: 9.1e9, capabilities: [] }],
      discovered: [],
      cfg,
    });
    expect(names(list)).toContain("phi4:14b");
  });

  it("discovered の 31b(20.1e9) は出さない", () => {
    const list = buildCatalog({
      yaml,
      installed: [],
      discovered: [
        { name: "gemma4:31b", sizeBytes: 20.1e9 },
        { name: "qwen3:8b", sizeBytes: 5.2e9 },
      ],
      cfg,
    });
    expect(names(list)).not.toContain("gemma4:31b");
    expect(list.find((e) => e.name === "qwen3:8b")?.source).toBe("discovered");
  });

  it("yaml と discovered が同名なら yaml を使う", () => {
    const list = buildCatalog({
      yaml,
      installed: [],
      discovered: [{ name: "gemma4:12b", sizeBytes: 9.6e9 }],
      cfg,
    });
    const m = list.filter((e) => e.name === "gemma4:12b");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ source: "yaml", sizeBytes: 8e9 });
  });

  it("インストール済みなら excluded サイズでも tier:\"slow\" で出す（ターミナルで入れたモデルも使え、削除できる）", () => {
    const list = buildCatalog({
      yaml,
      installed: [{ name: "big:70b", size: 40e9, capabilities: [] }],
      discovered: [],
      cfg,
    });
    expect(list.find((e) => e.name === "big:70b")).toMatchObject({ installed: true, tier: "slow" });
  });

  it("未インストールの excluded サイズは出さない", () => {
    const list = buildCatalog({ yaml, installed: [], discovered: [{ name: "big:70b", sizeBytes: 40e9 }], cfg });
    expect(names(list)).not.toContain("big:70b");
  });

  it("yaml に sizeGb が無く検索で見つかったモデルは、検索のサイズを使う", () => {
    const list = buildCatalog({
      yaml: { families: [], models: [{ name: "qwen3:8b", sizeGb: null }] },
      installed: [],
      discovered: [{ name: "qwen3:8b", sizeBytes: 5.2e9 }],
      cfg,
    });
    expect(list.find((e) => e.name === "qwen3:8b")).toMatchObject({ source: "yaml", sizeBytes: 5.2e9, tier: "comfort" });
  });

  it("並び順：installed が先、次に sizeBytes 昇順", () => {
    const list = buildCatalog({
      yaml,
      installed: [
        { name: "phi4:14b", size: 9.1e9, capabilities: [] },
        { name: "gemma4:12b", size: 8e9, capabilities: [] },
      ],
      discovered: [{ name: "qwen3:1.7b", sizeBytes: 1.4e9 }],
      cfg,
    });
    expect(names(list)).toEqual(["gemma4:12b", "phi4:14b", "qwen3:1.7b", "gemma4:e4b", "gemma4:26b"]);
  });

  it("デフォルトモデルが excluded サイズでも tier:\"slow\" として一覧に残す", () => {
    const big = getConfig({ DEFAULT_MODEL: "gemma4:31b" });
    const list = buildCatalog({
      yaml: { families: [], models: [{ name: "gemma4:31b", sizeGb: 20.1 }] },
      installed: [],
      discovered: [],
      cfg: big,
    });
    expect(list).toEqual([
      expect.objectContaining({ name: "gemma4:31b", tier: "slow", installed: false }),
    ]);
  });

  it("デフォルトモデルがどこにも無くても、サイズ不明として一覧に出す", () => {
    const list = buildCatalog({ yaml: { families: [], models: [] }, installed: [], discovered: [], cfg });
    expect(list).toEqual([
      {
        name: "gemma4:e4b",
        sizeBytes: null,
        tier: "slow",
        installed: false,
        capabilities: [],
        source: "yaml",
      },
    ]);
  });
});

describe("loadYaml", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "catalog-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("families と models を読む", () => {
    const p = path.join(dir, "models.yaml");
    writeFileSync(
      p,
      'families: [gemma4, qwen3]\nmodels:\n  - { name: "gemma4:e4b", sizeGb: 6.6 }\n',
    );
    expect(loadYaml(p)).toEqual({ families: ["gemma4", "qwen3"], models: [{ name: "gemma4:e4b", sizeGb: 6.6 }] });
  });

  it("ファイルが無ければ空", () => {
    expect(loadYaml(path.join(dir, "none.yaml"))).toEqual({ families: [], models: [] });
  });

  it("壊れた YAML は空として扱う", () => {
    const p = path.join(dir, "models.yaml");
    writeFileSync(p, "families: [gemma4\nmodels: {");
    expect(loadYaml(p)).toEqual({ families: [], models: [] });
  });

  it("形式の合わない項目は捨てる", () => {
    const p = path.join(dir, "models.yaml");
    writeFileSync(
      p,
      [
        "families: [gemma4, 3, '../x']",
        "models:",
        '  - { name: "ok:1b", sizeGb: 1 }',
        '  - { name: "../../etc:x", sizeGb: 1 }',
        '  - { name: "nosize:1b" }',
        "  - just-a-string",
      ].join("\n"),
    );
    expect(loadYaml(p)).toEqual({
      families: ["gemma4"],
      models: [
        { name: "ok:1b", sizeGb: 1 },
        { name: "nosize:1b", sizeGb: null },
      ],
    });
  });
});

describe("getCatalog", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "catalog-"));
    const p = path.join(dir, "models.yaml");
    writeFileSync(p, 'families: []\nmodels:\n  - { name: "gemma4:e4b", sizeGb: 6.6 }\n  - { name: "gemma4:12b", sizeGb: 8 }\n');
    vi.stubEnv("MODELS_YAML_PATH", p);
    vi.stubEnv("OLLAMA_URL", "http://ollama.test:11434");
    vi.stubEnv("DEFAULT_MODEL", "gemma4:e4b");
    vi.stubEnv("DISCOVERY_ENABLED", "false");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("インストール済みモデルに capabilities を付けて返す", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /api/version": () => json({ version: "x" }),
        "GET /api/tags": () => json({ models: [{ name: "gemma4:e4b", size: 6.6e9 }] }),
        "POST /api/show": () => json({ capabilities: ["completion", "vision", "thinking"] }),
      }).fetch,
    );
    const res = await getCatalog();
    expect(res.ollamaUp).toBe(true);
    expect(res.defaultModel).toBe("gemma4:e4b");
    expect(res.models[0]).toMatchObject({
      name: "gemma4:e4b",
      installed: true,
      capabilities: ["completion", "vision", "thinking"],
    });
    expect(res.models[1]).toMatchObject({ name: "gemma4:12b", installed: false });
  });

  it("検索結果のキャッシュを一覧に含める", async () => {
    vi.stubEnv("DATA_DIR", dir);
    mkdirSync(path.join(dir, "cache"), { recursive: true });
    writeFileSync(
      path.join(dir, "cache", "discovery.json"),
      JSON.stringify({ fetchedAt: new Date().toISOString(), families: [], models: [{ name: "qwen3:8b", sizeBytes: 5.2e9 }] }),
    );
    vi.stubGlobal("fetch", downFetch());
    const res = await getCatalog();
    expect(res.models.find((m) => m.name === "qwen3:8b")).toMatchObject({ source: "discovered", tier: "comfort" });
  });

  it("Ollama 停止時は例外を出さず、installed なし・ollamaUp:false", async () => {
    vi.stubGlobal("fetch", downFetch());
    const res = await getCatalog();
    expect(res.ollamaUp).toBe(false);
    expect(res.models.every((m) => !m.installed)).toBe(true);
    expect(names(res.models)).toEqual(["gemma4:e4b", "gemma4:12b"]);
  });

  it("/api/tags が失敗したら ollamaUp:false として扱う（未インストールと判定しない）", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /api/version": () => json({ version: "x" }),
        "GET /api/tags": () => json({ error: "boom" }, 500),
      }).fetch,
    );
    const res = await getCatalog();
    expect(res.ollamaUp).toBe(false);
  });

  it("showModel が失敗したモデルは capabilities を空にする", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /api/version": () => json({ version: "x" }),
        "GET /api/tags": () => json({ models: [{ name: "gemma4:e4b", size: 6.6e9 }] }),
        "POST /api/show": () => json({ error: "x" }, 500),
      }).fetch,
    );
    const res = await getCatalog();
    expect(res.models[0]).toMatchObject({ name: "gemma4:e4b", installed: true, capabilities: [] });
  });
});

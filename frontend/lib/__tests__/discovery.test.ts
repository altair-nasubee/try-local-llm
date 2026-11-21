import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig, type AppConfig } from "@/lib/config";

type Discovery = typeof import("@/lib/discovery");

const fixtureHtml = readFileSync(path.join(__dirname, "fixtures/gemma4-tags.html"), "utf8");

// 呼び出しのたびにモジュールを読み直し、メモリ上の状態（失敗時刻・実行中の検索）を初期化する
async function load(): Promise<Discovery> {
  vi.resetModules();
  return import("@/lib/discovery");
}

describe("parseTagNames / isStandardTag", () => {
  it("タグ一覧ページから版の名前を抜き出す", async () => {
    const { parseTagNames } = await load();
    const tags = parseTagNames(fixtureHtml, "gemma4");
    expect(tags).toEqual(expect.arrayContaining(["e4b", "12b", "26b", "31b-mlx"]));
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("ほかの種類のリンクは拾わない", async () => {
    const { parseTagNames } = await load();
    const html = '<a href="/library/gemma4:e4b"></a><a href="/library/gemma4b:1b"></a><a href="/library/qwen3:8b"></a>';
    expect(parseTagNames(html, "gemma4")).toEqual(["e4b"]);
  });

  it("標準の版だけを通す", async () => {
    const { isStandardTag } = await load();
    expect(["e2b", "e4b", "12b", "26b", "31b", "1.5b", "70b"].every(isStandardTag)).toBe(true);
    expect(
      ["latest", "31b-cloud", "12b-mlx", "12b-it-q8_0", "26b-a4b", "12b-nvfp4", "12b-mxfp8", "31b-it-bf16"].some(
        isStandardTag,
      ),
    ).toBe(false);
  });
});

describe("fetchManifestSize", () => {
  it("manifest の layers.size を合計する", async () => {
    const { fetchManifestSize } = await load();
    const fetchFn = vi.fn(async () => Response.json({ config: { size: 5 }, layers: [{ size: 100 }, { size: 200 }] }));
    await expect(fetchManifestSize("gemma4", "e4b", fetchFn)).resolves.toBe(300);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://registry.ollama.ai/v2/library/gemma4/manifests/e4b");
    expect(new Headers(init.headers).get("accept")).toBe("application/vnd.docker.distribution.manifest.v2+json");
  });

  it("取得できなければ null", async () => {
    const { fetchManifestSize } = await load();
    await expect(fetchManifestSize("gemma4", "x", async () => new Response("", { status: 404 }))).resolves.toBeNull();
    await expect(
      fetchManifestSize("gemma4", "x", async () => {
        throw new TypeError("fetch failed");
      }),
    ).resolves.toBeNull();
  });
});

describe("refreshDiscovery / readDiscoveryCache", () => {
  let dir: string;
  let cfg: AppConfig;
  const cacheFile = () => path.join(dir, "data/cache/discovery.json");

  function writeYaml(families: string[]) {
    writeFileSync(path.join(dir, "models.yaml"), `families: [${families.join(", ")}]\nmodels: []\n`);
  }

  function writeCache(c: { fetchedAt: string; families: string[]; models: { name: string; sizeBytes: number }[] }) {
    mkdirSync(path.dirname(cacheFile()), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify(c));
  }

  // ollama.com と registry の偽物
  function onlineFetch() {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://ollama.com/library/gemma4/tags") {
        return new Response(
          '<a href="/library/gemma4:e4b"></a><a href="/library/gemma4:31b"></a><a href="/library/gemma4:12b-mlx"></a>',
        );
      }
      if (url.endsWith("/manifests/e4b")) return Response.json({ layers: [{ size: 6e9 }, { size: 6e8 }] });
      if (url.endsWith("/manifests/31b")) return Response.json({ layers: [{ size: 20.1e9 }] });
      return new Response("", { status: 404 });
    });
  }

  const offlineFetch = () =>
    vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

  beforeEach(() => {
    globalThis.__discoveryState = undefined;
    dir = mkdtempSync(path.join(tmpdir(), "discovery-"));
    writeYaml(["gemma4"]);
    cfg = getConfig({ DATA_DIR: path.join(dir, "data"), MODELS_YAML_PATH: path.join(dir, "models.yaml") });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("検索して標準の版とサイズをキャッシュに書き、readDiscoveryCache で読める", async () => {
    const { refreshDiscovery, readDiscoveryCache } = await load();
    await refreshDiscovery(cfg, onlineFetch());
    const cache = JSON.parse(readFileSync(cacheFile(), "utf8"));
    expect(cache.families).toEqual(["gemma4"]);
    expect(typeof cache.fetchedAt).toBe("string");
    await expect(readDiscoveryCache(cfg)).resolves.toEqual([
      { name: "gemma4:e4b", sizeBytes: 6.6e9 },
      { name: "gemma4:31b", sizeBytes: 20.1e9 },
    ]);
  });

  it("キャッシュが無ければ readDiscoveryCache は []（ネットワークに出ない）", async () => {
    const { readDiscoveryCache } = await load();
    await expect(readDiscoveryCache(cfg)).resolves.toEqual([]);
  });

  it("readDiscoveryCache はファイルを毎回読む（置き換えがすぐ反映される）", async () => {
    const { readDiscoveryCache } = await load();
    writeCache({ fetchedAt: new Date().toISOString(), families: ["gemma4"], models: [{ name: "a:1b", sizeBytes: 1 }] });
    await expect(readDiscoveryCache(cfg)).resolves.toEqual([{ name: "a:1b", sizeBytes: 1 }]);
    writeCache({ fetchedAt: new Date().toISOString(), families: ["gemma4"], models: [{ name: "b:2b", sizeBytes: 2 }] });
    await expect(readDiscoveryCache(cfg)).resolves.toEqual([{ name: "b:2b", sizeBytes: 2 }]);
  });

  it("キャッシュが TTL 内なら fetch しない", async () => {
    const { refreshDiscovery } = await load();
    writeCache({ fetchedAt: new Date(Date.now() - 23 * 3600e3).toISOString(), families: ["gemma4"], models: [] });
    const fetchFn = onlineFetch();
    await refreshDiscovery(cfg, fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("TTL を過ぎていたら検索する", async () => {
    const { refreshDiscovery } = await load();
    writeCache({ fetchedAt: new Date(Date.now() - 25 * 3600e3).toISOString(), families: ["gemma4"], models: [] });
    const fetchFn = onlineFetch();
    await refreshDiscovery(cfg, fetchFn);
    expect(fetchFn).toHaveBeenCalled();
  });

  it("TTL 内でも models.yaml の families が変わっていたら検索する", async () => {
    const { refreshDiscovery } = await load();
    writeCache({ fetchedAt: new Date().toISOString(), families: ["gemma4"], models: [] });
    writeYaml(["gemma4", "qwen3"]);
    const fetchFn = onlineFetch();
    await refreshDiscovery(cfg, fetchFn);
    expect(fetchFn.mock.calls.map((c) => String(c[0]))).toContain("https://ollama.com/library/qwen3/tags");
  });

  it("fetch が全て失敗してもキャッシュは壊さず、readDiscoveryCache は [] を返す", async () => {
    const { refreshDiscovery, readDiscoveryCache } = await load();
    await expect(refreshDiscovery(cfg, offlineFetch())).resolves.toBeUndefined();
    await expect(readDiscoveryCache(cfg)).resolves.toEqual([]);
  });

  it("失敗しても古いキャッシュを残す", async () => {
    const { refreshDiscovery, readDiscoveryCache } = await load();
    const old = { fetchedAt: "2020-01-01T00:00:00.000Z", families: ["gemma4"], models: [{ name: "gemma4:e4b", sizeBytes: 1 }] };
    writeCache(old);
    await refreshDiscovery(cfg, offlineFetch());
    expect(JSON.parse(readFileSync(cacheFile(), "utf8"))).toEqual(old);
    await expect(readDiscoveryCache(cfg)).resolves.toEqual([{ name: "gemma4:e4b", sizeBytes: 1 }]);
  });

  it("失敗した直後の再呼び出しでは fetch しない", async () => {
    const { refreshDiscovery } = await load();
    const fetchFn = offlineFetch();
    await refreshDiscovery(cfg, fetchFn);
    const count = fetchFn.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    await refreshDiscovery(cfg, fetchFn);
    expect(fetchFn.mock.calls.length).toBe(count);
  });

  it("失敗から 1 時間たてば再検索する", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { refreshDiscovery } = await load();
    const fetchFn = offlineFetch();
    await refreshDiscovery(cfg, fetchFn);
    const count = fetchFn.mock.calls.length;
    vi.setSystemTime(Date.now() + 3600e3 + 1);
    await refreshDiscovery(cfg, fetchFn);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(count);
  });

  it("refreshDiscovery の同時呼び出しは 1 回だけ検索する", async () => {
    const { refreshDiscovery } = await load();
    const fetchFn = onlineFetch();
    await Promise.all([refreshDiscovery(cfg, fetchFn), refreshDiscovery(cfg, fetchFn)]);
    const pageCalls = fetchFn.mock.calls.filter((c) => String(c[0]).startsWith("https://ollama.com/"));
    expect(pageCalls).toHaveLength(1);
  });

  it("2 か所で別々に読み込まれたモジュール（instrumentation と Route Handler）から同時に呼んでも、検索は 1 回", async () => {
    const a = await load();
    const b = await load();
    const fetchFn = onlineFetch();
    await Promise.all([a.refreshDiscovery(cfg, fetchFn), b.refreshDiscovery(cfg, fetchFn)]);
    const pageCalls = fetchFn.mock.calls.filter((c) => String(c[0]).startsWith("https://ollama.com/"));
    expect(pageCalls).toHaveLength(1);
  });

  it("失敗した記録も、別々に読み込まれたモジュールで共有する（1 時間は再検索しない）", async () => {
    const a = await load();
    const b = await load();
    await a.refreshDiscovery(cfg, offlineFetch());
    const online = onlineFetch();
    await b.refreshDiscovery(cfg, online);
    expect(online).not.toHaveBeenCalled();
  });

  it("取れなかった種類があれば、取れた分は保存するが取得時刻は進めず、1 時間後に検索し直す", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T00:00:00Z"));
    const { refreshDiscovery, readDiscoveryCache } = await load();
    writeYaml(["gemma4", "qwen3"]);
    await refreshDiscovery(cfg, onlineFetch()); // qwen3 のページは 404
    await expect(readDiscoveryCache(cfg)).resolves.toContainEqual({ name: "gemma4:e4b", sizeBytes: 6.6e9 });
    expect(Date.parse(JSON.parse(readFileSync(cacheFile(), "utf8")).fetchedAt)).toBeLessThan(
      Date.parse("2026-11-21T00:00:00Z"),
    );
    const again = onlineFetch();
    await refreshDiscovery(cfg, again);
    expect(again).not.toHaveBeenCalled(); // 直後は検索しない
    vi.setSystemTime(new Date("2026-11-21T01:00:01Z"));
    await refreshDiscovery(cfg, again);
    expect(again).toHaveBeenCalled();
  });

  it("一部の種類だけ失敗したら、その種類は古いキャッシュの結果を残す", async () => {
    const { refreshDiscovery, readDiscoveryCache } = await load();
    writeYaml(["gemma4", "qwen3"]);
    writeCache({
      fetchedAt: "2020-01-01T00:00:00.000Z",
      families: ["gemma4", "qwen3"],
      models: [{ name: "qwen3:8b", sizeBytes: 5e9 }],
    });
    await refreshDiscovery(cfg, onlineFetch()); // qwen3 のページは 404
    await expect(readDiscoveryCache(cfg)).resolves.toEqual(
      expect.arrayContaining([
        { name: "gemma4:e4b", sizeBytes: 6.6e9 },
        { name: "qwen3:8b", sizeBytes: 5e9 },
      ]),
    );
  });

  it("全体で 30 秒を超えたら打ち切り、例外を外に出さない", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { refreshDiscovery } = await load();
    const hang = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const p = refreshDiscovery(cfg, hang);
    // キャッシュの読み込み（実際のファイル I/O）が終わり、検索が始まるまで待つ
    while (hang.mock.calls.length === 0) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBeUndefined();
  });
});

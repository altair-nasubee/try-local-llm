// 起動時のモデル自動検索。
// models.yaml の families について ollama.com のタグ一覧ページから版を読み取り、
// registry.ollama.ai のマニフェストから正確なサイズを取って ${dataDir}/cache/discovery.json に保存する。
// 失敗してもエラーにしない（models.yaml とダウンロード済みモデルだけで動く）。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredModel } from "@/lib/catalog";
import type { AppConfig } from "@/lib/config";
import { loadYaml } from "@/lib/models-yaml";
import { isValidModelName } from "@/lib/validate";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

type DiscoveryCache = { fetchedAt: string; families: string[]; models: DiscoveredModel[] };

const TOTAL_TIMEOUT_MS = 30_000;
const RETRY_AFTER_FAILURE_MS = 3600e3;
const MANIFEST_ACCEPT = "application/vnd.docker.distribution.manifest.v2+json";

// メモリ上の状態：直前の失敗時刻（1 時間は再検索しない）と、実行中の検索（同時実行は 1 つ）。
// instrumentation と Route Handler ではモジュールが別々に読み込まれるため、globalThis に置いて共有する
type DiscoveryState = { lastFailureAt: number | null; running: Promise<void> | null };
declare global {
  var __discoveryState: DiscoveryState | undefined;
}
const state = (): DiscoveryState => (globalThis.__discoveryState ??= { lastFailureAt: null, running: null });

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseTagNames(html: string, family: string): string[] {
  const re = new RegExp(`href="/library/${escapeRegExp(family)}:([^"]+)"`, "g");
  const tags = new Set<string>();
  for (const m of html.matchAll(re)) tags.add(m[1]);
  return [...tags];
}

// 標準の版だけ（-mlx / -cloud / 量子化・派生版を除く）
export function isStandardTag(tag: string): boolean {
  return /^e?\d+(\.\d+)?b$/.test(tag);
}

export async function fetchManifestSize(
  family: string,
  tag: string,
  fetchFn: FetchFn = fetch,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const res = await fetchFn(`https://registry.ollama.ai/v2/library/${family}/manifests/${tag}`, {
      headers: { accept: MANIFEST_ACCEPT },
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { layers?: { size?: unknown }[] };
    if (!Array.isArray(body.layers)) return null;
    return body.layers.reduce((sum, l) => sum + (typeof l.size === "number" ? l.size : 0), 0);
  } catch {
    return null;
  }
}

const cachePath = (cfg: AppConfig) => path.join(cfg.dataDir, "cache", "discovery.json");

async function readCache(cfg: AppConfig): Promise<DiscoveryCache | null> {
  try {
    const raw = JSON.parse(await readFile(cachePath(cfg), "utf8")) as Partial<DiscoveryCache>;
    const models = Array.isArray(raw.models)
      ? raw.models.filter(
          (m): m is DiscoveredModel =>
            !!m && typeof m.name === "string" && isValidModelName(m.name) && typeof m.sizeBytes === "number",
        )
      : [];
    return {
      fetchedAt: typeof raw.fetchedAt === "string" ? raw.fetchedAt : "",
      families: Array.isArray(raw.families) ? raw.families.filter((f) => typeof f === "string") : [],
      models: models.map((m) => ({ name: m.name, sizeBytes: m.sizeBytes })),
    };
  } catch {
    return null;
  }
}

// キャッシュを読むだけ。ネットワークに出ない。毎回ファイルを読む（置き換えをすぐ反映するため）
export async function readDiscoveryCache(cfg: AppConfig): Promise<DiscoveredModel[]> {
  return (await readCache(cfg))?.models ?? [];
}

const sameFamilies = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

function needsSearch(cache: DiscoveryCache | null, families: string[], cfg: AppConfig): boolean {
  if (!cache) return true;
  const fetchedAt = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > cfg.discoveryTtlHours * 3600e3) return true;
  return !sameFamilies(cache.families, families);
}

// 1 つの種類を検索する。タグ一覧ページが読めなければ null
async function searchFamily(family: string, fetchFn: FetchFn, signal: AbortSignal): Promise<DiscoveredModel[] | null> {
  let html: string;
  try {
    const res = await fetchFn(`https://ollama.com/library/${family}/tags`, { signal });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  const models: DiscoveredModel[] = [];
  // サーバーに負荷をかけないよう直列に取得する
  for (const tag of parseTagNames(html, family).filter(isStandardTag)) {
    if (signal.aborted) return null;
    const size = await fetchManifestSize(family, tag, fetchFn, signal);
    if (size !== null && size > 0) models.push({ name: `${family}:${tag}`, sizeBytes: size });
  }
  return signal.aborted ? null : models;
}

async function search(cfg: AppConfig, fetchFn: FetchFn): Promise<void> {
  const families = loadYaml(cfg.modelsYamlPath).families;
  const cache = await readCache(cfg);
  if (!needsSearch(cache, families, cfg)) return;
  const st = state();
  if (st.lastFailureAt !== null && Date.now() - st.lastFailureAt < RETRY_AFTER_FAILURE_MS) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("discovery timeout")), TOTAL_TIMEOUT_MS);
  try {
    const models: DiscoveredModel[] = [];
    let succeeded = 0;
    for (const family of families) {
      const found = await searchFamily(family, fetchFn, controller.signal);
      if (found) {
        succeeded++;
        models.push(...found);
      } else {
        // 読めなかった種類は、古いキャッシュの結果を残す
        models.push(...(cache?.models.filter((m) => m.name.startsWith(`${family}:`)) ?? []));
      }
    }
    if (families.length > 0 && succeeded === 0) {
      st.lastFailureAt = Date.now();
      return;
    }
    // 取れなかった種類（打ち切り・404 など）があれば、取れた分は保存するが取得時刻は進めず、1 時間後に検索し直す
    const complete = succeeded === families.length;
    st.lastFailureAt = complete ? null : Date.now();
    const fetchedAt = complete ? new Date().toISOString() : (cache?.fetchedAt ?? new Date(0).toISOString());
    const next: DiscoveryCache = { fetchedAt, families, models };
    const file = cachePath(cfg);
    await mkdir(path.dirname(file), { recursive: true });
    // 書きかけのファイルを読まれないよう、一時ファイルに書いてから置き換える（名前は書き手ごとに変える）
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, file);
  } finally {
    clearTimeout(timer);
  }
}

// 必要なときだけ検索してキャッシュを更新する。例外は外に出さない
export function refreshDiscovery(cfg: AppConfig, fetchFn: FetchFn = fetch): Promise<void> {
  const st = state();
  if (!st.running) {
    st.running = search(cfg, fetchFn)
      .catch(() => {
        st.lastFailureAt = Date.now();
      })
      .finally(() => {
        st.running = null;
      });
  }
  return st.running;
}

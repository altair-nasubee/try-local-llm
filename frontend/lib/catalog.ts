// モデル一覧の組み立て：models.yaml の候補 + インストール済み + 自動検索の結果
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { type AppConfig, getConfig } from "@/lib/config";
import { isUp, listInstalled, showModel } from "@/lib/ollama";
import { classifyTier } from "@/lib/tiers";
import type { ModelEntry, ModelsResponse } from "@/lib/types";
import { isValidFamily, isValidModelName } from "@/lib/validate";

export type YamlModels = { families: string[]; models: { name: string; sizeGb: number | null }[] };
export type InstalledModel = { name: string; size: number; capabilities: string[] };
export type DiscoveredModel = { name: string; sizeBytes: number };

const GB = 1e9;

// models.yaml を読む。無い・壊れている・形式の合わない項目は捨てる（起動を止めない）
export function loadYaml(path: string): YamlModels {
  let doc: unknown;
  try {
    doc = parse(readFileSync(path, "utf8"));
  } catch {
    return { families: [], models: [] };
  }
  const obj = (doc ?? {}) as { families?: unknown; models?: unknown };
  const families = Array.isArray(obj.families)
    ? obj.families.filter((f): f is string => typeof f === "string" && isValidFamily(f))
    : [];
  const models: YamlModels["models"] = [];
  if (Array.isArray(obj.models)) {
    for (const m of obj.models) {
      if (!m || typeof m !== "object") continue;
      const { name, sizeGb } = m as { name?: unknown; sizeGb?: unknown };
      if (typeof name !== "string" || !isValidModelName(name)) continue;
      models.push({ name, sizeGb: typeof sizeGb === "number" && sizeGb > 0 ? sizeGb : null });
    }
  }
  return { families, models };
}

export function buildCatalog(input: {
  yaml: YamlModels;
  installed: InstalledModel[];
  discovered: DiscoveredModel[];
  cfg: AppConfig;
}): ModelEntry[] {
  const { yaml, installed, discovered, cfg } = input;
  const byName = new Map<string, Omit<ModelEntry, "tier">>();

  // 優先度の低い順に入れ、同名は上書きする（discovered < yaml < installed）
  for (const d of discovered) {
    byName.set(d.name, { name: d.name, sizeBytes: d.sizeBytes, installed: false, capabilities: [], source: "discovered" });
  }
  for (const y of yaml.models) {
    byName.set(y.name, {
      name: y.name,
      sizeBytes: y.sizeGb === null ? null : Math.round(y.sizeGb * GB),
      installed: false,
      capabilities: [],
      source: "yaml",
    });
  }
  for (const i of installed) {
    byName.set(i.name, { name: i.name, sizeBytes: i.size, installed: true, capabilities: i.capabilities, source: "installed" });
  }
  // デフォルトモデルは起動時のダウンロード対象・選択の初期値なので、どこにも無くても出す
  if (!byName.has(cfg.defaultModel)) {
    byName.set(cfg.defaultModel, {
      name: cfg.defaultModel,
      sizeBytes: null,
      installed: false,
      capabilities: [],
      source: "yaml",
    });
  }

  const entries: ModelEntry[] = [];
  for (const e of byName.values()) {
    const tier = classifyTier(e.sizeBytes, cfg);
    if (tier === "excluded") {
      // デフォルトモデルは削除不可・起動時 DL 対象のため、重くても slow として残す
      if (e.name === cfg.defaultModel) entries.push({ ...e, tier: "slow" });
      continue;
    }
    entries.push({ ...e, tier });
  }

  return entries.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    const sa = a.sizeBytes ?? Number.POSITIVE_INFINITY;
    const sb = b.sizeBytes ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
}

// Ollama からインストール済みモデルを集める。Ollama が止まっていれば null（未インストールとは扱わない）
async function collectInstalled(): Promise<InstalledModel[] | null> {
  if (!(await isUp())) return null;
  try {
    const list = await listInstalled();
    return await Promise.all(
      list.map(async (m) => ({
        ...m,
        capabilities: await showModel(m.name)
          .then((r) => r.capabilities)
          .catch(() => []),
      })),
    );
  } catch {
    return null;
  }
}

// /api/models・/api/models/download・/api/models/[name] が共有する一覧
export async function getCatalog(): Promise<ModelsResponse> {
  const cfg = getConfig();
  const yaml = loadYaml(cfg.modelsYamlPath);
  const installed = await collectInstalled();
  const discovered: DiscoveredModel[] = [];
  return {
    models: buildCatalog({ yaml, installed: installed ?? [], discovered, cfg }),
    defaultModel: cfg.defaultModel,
    ollamaUp: installed !== null,
  };
}

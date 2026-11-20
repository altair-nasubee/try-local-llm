// モデル一覧の組み立て：models.yaml の候補 + インストール済み + 自動検索の結果
import { type AppConfig, getConfig } from "@/lib/config";
import { readDiscoveryCache } from "@/lib/discovery";
import { isUp, listInstalled, showModel } from "@/lib/ollama";
import { classifyTier } from "@/lib/tiers";
import type { ModelEntry, ModelsResponse } from "@/lib/types";
import { loadYaml, type YamlModels } from "@/lib/models-yaml";

export { loadYaml, type YamlModels } from "@/lib/models-yaml";

export type InstalledModel = { name: string; size: number; capabilities: string[] };
export type DiscoveredModel = { name: string; sizeBytes: number };

const GB = 1e9;

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
  const [installed, discovered] = await Promise.all([collectInstalled(), readDiscoveryCache(cfg)]);
  return {
    models: buildCatalog({ yaml, installed: installed ?? [], discovered, cfg }),
    defaultModel: cfg.defaultModel,
    ollamaUp: installed !== null,
  };
}

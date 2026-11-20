// models.yaml の読み込み（catalog と discovery が使う）
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { isValidFamily, isValidModelName } from "@/lib/validate";

export type YamlModels = { families: string[]; models: { name: string; sizeGb: number | null }[] };

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

import type { AppConfig } from "@/lib/config";
import type { Tier } from "@/lib/types";

const GB = 1e9;

// サイズから負荷区分を決める。サイズ不明は comfort 扱いにせず slow とする
export function classifyTier(
  sizeBytes: number | null,
  cfg: Pick<AppConfig, "tierComfortMaxGb" | "tierExcludeMinGb">,
): Tier {
  if (sizeBytes === null) return "slow";
  if (sizeBytes >= cfg.tierExcludeMinGb * GB) return "excluded";
  if (sizeBytes <= cfg.tierComfortMaxGb * GB) return "comfort";
  return "slow";
}

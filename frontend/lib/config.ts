// 環境変数から設定を読む。モジュールの読み込み時には何も読まず、呼ばれたときに読む
// （next build 中に Route Handler が読み込まれても失敗しないようにするため）

export type AppConfig = {
  ollamaUrl: string;
  defaultModel: string;
  numCtx: number;
  idleTimeoutSec: number;
  contextWarnRatio: number;
  tierComfortMaxGb: number;
  tierExcludeMinGb: number;
  discoveryTtlHours: number;
  discoveryEnabled: boolean;
  sessionLimit: number;
  dataDir: string;
  modelsYamlPath: string;
};

type Env = Record<string, string | undefined>;

function str(value: string | undefined, fallback: string): string {
  return value && value.trim() !== "" ? value.trim() : fallback;
}

// Ollama はタグを省いたモデルを「<名前>:latest」として一覧に出す。同じ名前で比べられるよう補う
function withTag(model: string): string {
  const last = model.slice(model.lastIndexOf("/") + 1);
  return last.includes(":") ? model : `${model}:latest`;
}

// 正の数でなければ既定値に戻す
function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

export function getConfig(env: Env = process.env): AppConfig {
  return {
    ollamaUrl: str(env.OLLAMA_URL, "http://ollama:11434"),
    defaultModel: withTag(str(env.DEFAULT_MODEL, "gemma4:e4b")),
    numCtx: num(env.NUM_CTX, 8192),
    idleTimeoutSec: num(env.IDLE_TIMEOUT_SEC, 180),
    contextWarnRatio: num(env.CONTEXT_WARN_RATIO, 0.8),
    tierComfortMaxGb: num(env.TIER_COMFORT_MAX_GB, 7),
    tierExcludeMinGb: num(env.TIER_EXCLUDE_MIN_GB, 20),
    discoveryTtlHours: num(env.DISCOVERY_TTL_HOURS, 24),
    discoveryEnabled: bool(env.DISCOVERY_ENABLED, true),
    sessionLimit: num(env.SESSION_LIMIT, 10),
    dataDir: str(env.DATA_DIR, "/app/data"),
    modelsYamlPath: str(env.MODELS_YAML_PATH, "/app/models.yaml"),
  };
}

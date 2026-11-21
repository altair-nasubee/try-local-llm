// 画面と API で共有する型。同じ型をほかの場所で定義しない

export type Tier = "comfort" | "slow" | "excluded";

export type ModelEntry = {
  name: string; // "gemma4:e4b"
  sizeBytes: number | null; // 不明なら null（区分は comfort 扱いにしない→"slow"）
  tier: Exclude<Tier, "excluded">;
  installed: boolean;
  capabilities: string[]; // installed のときのみ Ollama /api/show の値。未DLは []
  source: "yaml" | "discovered" | "installed";
};

export type ModelsResponse = { models: ModelEntry[]; defaultModel: string; ollamaUp: boolean };

export type DownloadState =
  | { status: "idle" }
  | { status: "running"; model: string; completed: number; total: number; startedAt: string }
  | { status: "error"; model: string; message: string }
  | { status: "done"; model: string };

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  images?: string[]; // セッションフォルダ内のファイル名
  interrupted?: boolean;
  createdAt: string;
};

export type Session = {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  lastContextTokens?: number;
};

export type SessionSummary = Pick<Session, "id" | "title" | "model" | "updatedAt">;

export type ChatEvent =
  | { type: "session"; session: SessionSummary }
  | { type: "thinking"; text: string }
  | { type: "content"; text: string }
  | { type: "done"; contextTokens: number; contextLimit: number; warn: boolean }
  | { type: "error"; code: "timeout" | "ollama_down" | "too_heavy" | "failed"; message: string };
// ollama_down: Ollama コンテナ自体が応答しない（再起動中）
// too_heavy : Ollama は生きているが、モデルの実行プロセスがメモリ不足で落ちた／読み込みを拒否した

// Ollama の HTTP クライアント。接続先は呼ばれたときに getConfig() から読む
import { getConfig } from "@/lib/config";
import { readNdjson } from "@/lib/ndjson";

export class OllamaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OllamaHttpError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

async function request(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const url = new URL(path, getConfig().ollamaUrl);
  const res = await fetch(url, {
    ...init,
    headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // 本文が JSON でなければ statusText のまま
    }
    throw new OllamaHttpError(res.status, `Ollama ${res.status}: ${detail}`);
  }
  return res;
}

export async function listInstalled(): Promise<{ name: string; size: number }[]> {
  const res = await request("/api/tags");
  const body = (await res.json()) as { models?: { name: string; size: number }[] };
  return (body.models ?? []).map((m) => ({ name: m.name, size: m.size }));
}

export async function showModel(name: string): Promise<{ capabilities: string[] }> {
  const res = await request("/api/show", { method: "POST", body: JSON.stringify({ model: name }) });
  const body = (await res.json()) as { capabilities?: string[] };
  return { capabilities: Array.isArray(body.capabilities) ? body.capabilities : [] };
}

export async function deleteModel(name: string): Promise<void> {
  await request("/api/delete", { method: "DELETE", body: JSON.stringify({ model: name }) });
}

// Ollama が応答するか。2 秒で打ち切り、例外は出さない
export async function isUp(): Promise<boolean> {
  try {
    await request("/api/version", {}, 2000);
    return true;
  } catch {
    return false;
  }
}

export { readNdjson };

export type PullEvent = { status: string; digest?: string; completed?: number; total?: number; error?: string };

// モデルのダウンロード。進捗を 1 行ずつ返す。中止は signal で行う
export async function* pull(name: string, signal: AbortSignal): AsyncIterable<PullEvent> {
  const res = await request("/api/pull", { method: "POST", body: JSON.stringify({ model: name, stream: true }), signal });
  if (!res.body) throw new Error("Ollama の応答が空です");
  yield* readNdjson<PullEvent>(res.body);
}

// 200 のストリームの途中に来た {"error": "…"} の行
export class OllamaStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaStreamError";
  }
}

export type OllamaChatMessage = { role: "user" | "assistant"; content: string; images?: string[] };

export type OllamaChatChunk = {
  message?: { role?: string; content?: string; thinking?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

// チャット。images は base64。中止は signal で行う
export async function* chat(
  params: { model: string; messages: OllamaChatMessage[]; think: boolean; numCtx: number },
  signal: AbortSignal,
): AsyncIterable<OllamaChatChunk> {
  const res = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      think: params.think,
      stream: true,
      options: { num_ctx: params.numCtx },
    }),
    signal,
  });
  if (!res.body) throw new Error("Ollama の応答が空です");
  for await (const chunk of readNdjson<OllamaChatChunk>(res.body)) {
    if (chunk.error) throw new OllamaStreamError(chunk.error);
    yield chunk;
  }
}

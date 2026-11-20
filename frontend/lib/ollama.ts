// Ollama の HTTP クライアント。接続先は呼ばれたときに getConfig() から読む
import { getConfig } from "@/lib/config";

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

// NDJSON（1 行 1 JSON）のストリームを 1 行ずつ返す。行がチャンクをまたいでも正しく区切る
export async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncIterable<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as T;
  } finally {
    reader.releaseLock();
  }
}

export type PullEvent = { status: string; digest?: string; completed?: number; total?: number; error?: string };

// モデルのダウンロード。進捗を 1 行ずつ返す。中止は signal で行う
export async function* pull(name: string, signal: AbortSignal): AsyncIterable<PullEvent> {
  const res = await request("/api/pull", { method: "POST", body: JSON.stringify({ model: name, stream: true }), signal });
  if (!res.body) throw new Error("Ollama の応答が空です");
  yield* readNdjson<PullEvent>(res.body);
}

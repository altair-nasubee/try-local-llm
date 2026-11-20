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

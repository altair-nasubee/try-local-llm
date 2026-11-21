import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OllamaChatChunk } from "@/lib/ollama";
import type { ChatEvent, Session } from "@/lib/types";

// Ollama クライアントをまるごと差し替える（catalog もこれを使う）
const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  isUp: vi.fn(),
  listInstalled: vi.fn(),
  showModel: vi.fn(),
}));
vi.mock("@/lib/ollama", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ollama")>()),
  ...mocks,
}));

const { POST } = await import("@/app/api/chat/route");
const { createSession, deleteSession, getSession, saveImage, saveSession } = await import("@/lib/sessions");
const { OllamaHttpError, OllamaStreamError } = await import("@/lib/ollama");

let dir: string;
let busy = false;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const pngFile = (name = "a.png") => new File([PNG], name, { type: "image/png" });

type Installed = { name: string; capabilities: string[] };
function setInstalled(models: Installed[]) {
  mocks.listInstalled.mockResolvedValue(models.map((m) => ({ name: m.name, size: 5e9 })));
  mocks.showModel.mockImplementation(async (name: string) => ({
    capabilities: models.find((m) => m.name === name)?.capabilities ?? [],
  }));
}

const content = (text: string, extra: Partial<OllamaChatChunk> = {}): OllamaChatChunk => ({
  message: { role: "assistant", content: text },
  done: false,
  ...extra,
});

function form(fields: Record<string, string | File | File[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

function post(fields: Record<string, string | File | File[]>, signal?: AbortSignal) {
  return POST(new Request("http://localhost/api/chat", { method: "POST", body: form(fields), signal }));
}

async function readEvents(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ChatEvent);
}

// 1 行ずつ読む
function lineReader(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  return {
    reader,
    async next(): Promise<ChatEvent> {
      while (!buf.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buf += dec.decode(value, { stream: true });
      }
      const i = buf.indexOf("\n");
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      return JSON.parse(line) as ChatEvent;
    },
  };
}

// signal が abort されるまで待ち、abort の理由で終わる
function waitForAbort(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "chat-route-"));
  writeFileSync(path.join(dir, "models.yaml"), "families: []\nmodels: []\n");
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("MODELS_YAML_PATH", path.join(dir, "models.yaml"));
  vi.stubEnv("DEFAULT_MODEL", "gemma4:e4b");
  vi.stubEnv("NUM_CTX", "8192");
  vi.stubEnv("CONTEXT_WARN_RATIO", "0.8");
  vi.stubEnv("DISCOVERY_ENABLED", "false");
  mocks.isUp.mockResolvedValue(true);
  setInstalled([
    { name: "gemma4:e4b", capabilities: ["completion", "vision", "thinking"] },
    { name: "qwen3:8b", capabilities: ["completion"] },
  ]);
  busy = false;
  globalThis.__downloadManager = {
    state: () => ({ status: "idle" }),
    isBusy: () => busy,
    start: vi.fn(),
    cancel: vi.fn(),
    fail: vi.fn(),
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  globalThis.__downloadManager = undefined;
});

describe("POST /api/chat", () => {
  it("thinking と content を別イベントで流し、done に contextTokens と warn を入れる", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield { message: { role: "assistant", content: "", thinking: "考える" }, done: false };
      yield content("こん");
      yield content("にちは");
      yield { message: { role: "assistant", content: "" }, done: true, prompt_eval_count: 6000, eval_count: 1000 };
    });
    const res = await post({ model: "gemma4:e4b", content: "やあ" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await readEvents(res);
    expect(events[0]).toMatchObject({ type: "session", session: { title: "やあ", model: "gemma4:e4b" } });
    expect(events.slice(1)).toEqual([
      { type: "thinking", text: "考える" },
      { type: "content", text: "こん" },
      { type: "content", text: "にちは" },
      { type: "done", contextTokens: 7000, contextLimit: 8192, warn: true },
    ]);
    const id = (events[0] as Extract<ChatEvent, { type: "session" }>).session.id;
    const saved = (await getSession(id))!;
    expect(saved.lastContextTokens).toBe(7000);
    expect(saved.messages).toEqual([
      { role: "user", content: "やあ", createdAt: expect.any(String) },
      { role: "assistant", content: "こんにちは", thinking: "考える", createdAt: expect.any(String) },
    ]);
    // thinking 対応モデルなので think:true、num_ctx は設定どおり
    expect(mocks.chat.mock.calls[0][0]).toMatchObject({ model: "gemma4:e4b", think: true, numCtx: 8192 });
  });

  it("warn は contextTokens が上限 × 割合 未満なら false", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield { message: { content: "x" }, done: true, prompt_eval_count: 100, eval_count: 10 };
    });
    const events = await readEvents(await post({ model: "gemma4:e4b", content: "q" }));
    expect(events.at(-1)).toEqual({ type: "done", contextTokens: 110, contextLimit: 8192, warn: false });
  });

  it("thinking に対応しないモデルは think:false", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield { message: { content: "x" }, done: true, prompt_eval_count: 1, eval_count: 1 };
    });
    await readEvents(await post({ model: "qwen3:8b", content: "q" }));
    expect(mocks.chat.mock.calls[0][0]).toMatchObject({ think: false });
  });

  it("既存セッションの続きは過去の発言（画像は base64）も送り、session イベントは送らない", async () => {
    const s = await createSession("gemma4:e4b", "前の質問");
    const img = await saveImage(s.id, { name: "a.png", type: "image/png", bytes: PNG });
    s.messages.push(
      { role: "user", content: "前の質問", images: [img], createdAt: s.createdAt },
      { role: "assistant", content: "前の答え", thinking: "t", createdAt: s.createdAt },
    );
    await saveSession(s);
    mocks.chat.mockImplementation(async function* () {
      yield { message: { content: "続き" }, done: true, prompt_eval_count: 1, eval_count: 1 };
    });
    const events = await readEvents(await post({ sessionId: s.id, model: "gemma4:e4b", content: "次" }));
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
    expect(mocks.chat.mock.calls[0][0].messages).toEqual([
      { role: "user", content: "前の質問", images: [Buffer.from(PNG).toString("base64")] },
      { role: "assistant", content: "前の答え" },
      { role: "user", content: "次" },
    ]);
    expect((await getSession(s.id))!.messages).toHaveLength(4);
  });

  it("既存 sessionId に別の model を送ってもセッションのモデルで実行する", async () => {
    const s = await createSession("qwen3:8b", "q");
    mocks.chat.mockImplementation(async function* () {
      yield { message: { content: "x" }, done: true, prompt_eval_count: 1, eval_count: 1 };
    });
    await readEvents(await post({ sessionId: s.id, model: "gemma4:e4b", content: "q2" }));
    expect(mocks.chat.mock.calls[0][0].model).toBe("qwen3:8b");
  });

  it("画像を保存し、ユーザー発言にファイル名を残して Ollama に base64 で送る", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield { message: { content: "猫です" }, done: true, prompt_eval_count: 1, eval_count: 1 };
    });
    const events = await readEvents(await post({ model: "gemma4:e4b", content: "", images: [pngFile()] }));
    const id = (events[0] as Extract<ChatEvent, { type: "session" }>).session.id;
    const saved = (await getSession(id))!;
    expect(saved.title).toBe("画像の質問");
    expect(saved.messages[0]).toMatchObject({ role: "user", content: "", images: ["img-1.png"] });
    expect(mocks.chat.mock.calls[0][0].messages[0].images).toEqual([Buffer.from(PNG).toString("base64")]);
  });

  it("途中で ollama.chat が ECONNRESET、isUp=false → error ollama_down、途中の応答が interrupted で保存", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield content("途中まで");
      mocks.isUp.mockResolvedValue(false);
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    });
    const events = await readEvents(await post({ model: "gemma4:e4b", content: "q" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "ollama_down" });
    const id = (events[0] as Extract<ChatEvent, { type: "session" }>).session.id;
    expect((await getSession(id))!.messages[1]).toMatchObject({
      role: "assistant",
      content: "途中まで",
      interrupted: true,
    });
  });

  it("Ollama が 'model runner has unexpectedly stopped' を返す → error too_heavy", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield* [];
      throw new OllamaHttpError(500, "Ollama 500: model runner has unexpectedly stopped");
    });
    const events = await readEvents(await post({ model: "gemma4:e4b", content: "q" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "too_heavy" });
  });

  it("Ollama が 'model requires more system memory' を返す → error too_heavy", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield* [];
      throw new OllamaHttpError(500, "Ollama 500: model requires more system memory (30 GiB) than is available");
    });
    const events = await readEvents(await post({ model: "gemma4:e4b", content: "q" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "too_heavy" });
  });

  it("ストリームの途中に {\"error\":\"model runner has unexpectedly stopped\"} の行が来ても too_heavy", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield content("a");
      throw new OllamaStreamError("model runner has unexpectedly stopped");
    });
    const events = await readEvents(await post({ model: "gemma4:e4b", content: "q" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "too_heavy" });
  });

  it("その他のエラーは failed", async () => {
    mocks.chat.mockImplementation(async function* () {
      yield* [];
      throw new OllamaHttpError(400, "Ollama 400: invalid options");
    });
    const events = await readEvents(await post({ model: "gemma4:e4b", content: "q" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "failed" });
  });

  it("無応答が IDLE_TIMEOUT_SEC を超えたら error timeout、途中の応答が interrupted で保存", async () => {
    vi.stubEnv("IDLE_TIMEOUT_SEC", "0.05");
    mocks.chat.mockImplementation(async function* (_p: unknown, signal: AbortSignal) {
      yield content("少し");
      await waitForAbort(signal);
    });
    const events = await readEvents(await post({ model: "gemma4:e4b", content: "q" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "timeout" });
    const id = (events[0] as Extract<ChatEvent, { type: "session" }>).session.id;
    expect((await getSession(id))!.messages[1]).toMatchObject({ content: "少し", interrupted: true });
  });

  it("request.signal を abort すると途中の応答が interrupted で保存", async () => {
    let chatSignal: AbortSignal | undefined;
    mocks.chat.mockImplementation(async function* (_p: unknown, signal: AbortSignal) {
      chatSignal = signal;
      yield content("書きかけ");
      await waitForAbort(signal);
    });
    const client = new AbortController();
    const res = await post({ model: "gemma4:e4b", content: "q" }, client.signal);
    const lines = lineReader(res);
    const first = (await lines.next()) as Extract<ChatEvent, { type: "session" }>;
    expect(await lines.next()).toEqual({ type: "content", text: "書きかけ" });
    client.abort();
    await vi.waitFor(async () => {
      const s = (await getSession(first.session.id)) as Session;
      expect(s.messages[1]).toMatchObject({ role: "assistant", content: "書きかけ", interrupted: true });
    });
    expect(chatSignal?.aborted).toBe(true);
  });

  it("ReadableStream の cancel() でも途中の応答が interrupted で 1 回だけ保存される", async () => {
    mocks.chat.mockImplementation(async function* (_p: unknown, signal: AbortSignal) {
      yield content("途中");
      await waitForAbort(signal);
    });
    const client = new AbortController();
    const res = await post({ model: "gemma4:e4b", content: "q" }, client.signal);
    const lines = lineReader(res);
    const first = (await lines.next()) as Extract<ChatEvent, { type: "session" }>;
    await lines.next();
    await lines.reader.cancel();
    client.abort(); // 両方来ても保存は 1 回
    await vi.waitFor(async () => {
      const s = (await getSession(first.session.id)) as Session;
      expect(s.messages[1]).toMatchObject({ content: "途中", interrupted: true });
    });
    await new Promise((r) => setTimeout(r, 50));
    expect((await getSession(first.session.id))!.messages).toHaveLength(2);
  });

  it("応答中にセッションが削除されたら、中断の保存でフォルダを作り直さない", async () => {
    mocks.chat.mockImplementation(async function* (_p: unknown, signal: AbortSignal) {
      yield content("途中");
      await waitForAbort(signal);
    });
    const client = new AbortController();
    const res = await post({ model: "gemma4:e4b", content: "q" }, client.signal);
    const lines = lineReader(res);
    const first = (await lines.next()) as Extract<ChatEvent, { type: "session" }>;
    await lines.next();
    await deleteSession(first.session.id);
    client.abort();
    await new Promise((r) => setTimeout(r, 100));
    await expect(getSession(first.session.id)).resolves.toBeNull();
    expect(existsSync(path.join(dir, "sessions", first.session.id))).toBe(false);
  });

  describe("送信前のチェック", () => {
    it("ダウンロード中は 409", async () => {
      busy = true;
      const res = await post({ model: "gemma4:e4b", content: "q" });
      expect(res.status).toBe(409);
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it("capabilities に vision が無いモデルに画像を送ると 400", async () => {
      const res = await post({ model: "qwen3:8b", content: "q", images: [pngFile()] });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "no_vision" });
    });

    it("画像 5 枚は 400", async () => {
      const res = await post({ model: "gemma4:e4b", content: "q", images: Array.from({ length: 5 }, () => pngFile()) });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "too_many_images" });
    });

    it("PNG 以外（gif）は 400", async () => {
      const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], "a.gif", { type: "image/gif" });
      const res = await post({ model: "gemma4:e4b", content: "q", images: [gif] });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "invalid_image" });
    });

    it("本文が空で画像も無いと 400", async () => {
      const res = await post({ model: "gemma4:e4b", content: "  " });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "empty" });
    });

    it("存在しない sessionId は 404", async () => {
      expect((await post({ sessionId: "20200101-000000-zzzzzz", model: "gemma4:e4b", content: "q" })).status).toBe(404);
    });

    it("形式違反の sessionId・モデル名は 400", async () => {
      expect((await post({ sessionId: "../x", model: "gemma4:e4b", content: "q" })).status).toBe(400);
      expect((await post({ model: "../x:1", content: "q" })).status).toBe(400);
    });

    it("セッションのモデルが未インストールなら 409（閲覧のみ）", async () => {
      const s = await createSession("gemma4:12b", "q");
      const res = await post({ sessionId: s.id, model: "gemma4:e4b", content: "q2" });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ error: "model_not_installed" });
    });

    it("Ollama 停止中に既存セッションへ送ると 409 ではなく error ollama_down", async () => {
      const s = await createSession("gemma4:12b", "q");
      mocks.isUp.mockResolvedValue(false);
      const res = await post({ sessionId: s.id, model: "gemma4:e4b", content: "q2" });
      // 送っていないことが画面に分かるよう、ストリームではなく 503 で返す（入力欄の文を消さないため）
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({ error: "ollama_down" });
      expect((await getSession(s.id))!.messages).toHaveLength(0); // 送っていない質問は保存しない
      expect(mocks.chat).not.toHaveBeenCalled();
    });
  });
});

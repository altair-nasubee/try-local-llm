import { readFile } from "node:fs/promises";
import { apiError } from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import { classifyOllamaError, IdleTimeoutError, streamWithIdleTimeout } from "@/lib/chat-stream";
import { getConfig } from "@/lib/config";
import { getDownloadManager } from "@/lib/downloads";
import { t } from "@/lib/i18n";
import { chat, isUp, type OllamaChatMessage } from "@/lib/ollama";
import { createSession, getSession, imagePath, saveImage, saveSession, validateImage } from "@/lib/sessions";
import type { ChatEvent, ChatMessage, Session } from "@/lib/types";
import { isValidModelName, isValidSessionId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGES = 4;

const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  // 途中のプロキシにためこませない
  "x-accel-buffering": "no",
};

const encoder = new TextEncoder();
const line = (e: ChatEvent) => encoder.encode(JSON.stringify(e) + "\n");

function errorEvent(code: Extract<ChatEvent, { type: "error" }>["code"], detail = ""): ChatEvent {
  const message =
    code === "timeout"
      ? t("chat.timeout", { sec: getConfig().idleTimeoutSec })
      : code === "failed"
        ? t("chat.failed", { detail })
        : t("ollama.restarting");
  return { type: "error", code, message };
}

// セッションの発言を Ollama に送る形にする。過去のユーザー発言の画像も毎回 base64 で付ける
async function toOllamaMessages(s: Session): Promise<OllamaChatMessage[]> {
  return Promise.all(
    s.messages.map(async (m): Promise<OllamaChatMessage> => {
      const out: OllamaChatMessage = { role: m.role, content: m.content };
      if (m.role === "user" && m.images?.length) {
        out.images = await Promise.all(
          m.images.map(async (f) => (await readFile(imagePath(s.id, f))).toString("base64")),
        );
      }
      return out;
    }),
  );
}

// 送信：multipart/form-data（sessionId?、model、content、images × 最大 4）→ ChatEvent の NDJSON
export async function POST(req: Request) {
  if (getDownloadManager().isBusy()) return apiError(409, "busy");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(400, "invalid_form");
  }

  const sessionIdRaw = form.get("sessionId");
  const sessionId = typeof sessionIdRaw === "string" && sessionIdRaw !== "" ? sessionIdRaw : null;
  if (sessionId !== null && !isValidSessionId(sessionId)) return apiError(400, "invalid_session");
  const contentRaw = form.get("content");
  const content = typeof contentRaw === "string" ? contentRaw : "";

  const files = form.getAll("images").filter((v): v is File => v instanceof File);
  if (files.length > MAX_IMAGES) return apiError(400, "too_many_images");
  const images: { name: string; type: string; bytes: Uint8Array }[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const check = validateImage({ type: f.type, bytes });
    if (!check.ok) return apiError(400, "invalid_image", check.reason);
    images.push({ name: f.name, type: f.type, bytes });
  }
  if (content.trim() === "" && images.length === 0) return apiError(400, "empty");

  // 既存セッションはセッションのモデルを使う（1 セッション = 1 モデル）
  let session: Session | null = null;
  let model: string;
  if (sessionId !== null) {
    session = await getSession(sessionId);
    if (!session) return apiError(404, "not_found");
    model = session.model;
  } else {
    const m = form.get("model");
    if (typeof m !== "string" || !isValidModelName(m)) return apiError(400, "invalid_model");
    model = m;
  }

  const catalog = await getCatalog();
  // Ollama が止まっている間はモデルの有無が分からないので、閲覧のみ（409）にせず再起動中として返す。
  // 質問は保存しない（画面は入力欄の文を残す）
  if (!catalog.ollamaUp) return apiError(503, "ollama_down", t("ollama.restarting"));
  const entry = catalog.models.find((m) => m.name === model && m.installed);
  if (!entry) return apiError(409, "model_not_installed");
  if (images.length > 0 && !entry.capabilities.includes("vision")) return apiError(400, "no_vision");

  const cfg = getConfig();
  const isNew = session === null;
  if (session === null) session = await createSession(model, content);
  const s: Session = session;

  const now = new Date().toISOString();
  const userMessage: ChatMessage = { role: "user", content, createdAt: now };
  if (images.length > 0) {
    userMessage.images = [];
    for (const img of images) userMessage.images.push(await saveImage(s.id, img));
  }
  s.messages.push(userMessage);
  s.updatedAt = now;
  await saveSession(s);
  const ollamaMessages = await toOllamaMessages(s);

  const abort = new AbortController();
  let answer = "";
  let thinking = "";
  let saved = false;
  let closed = false;

  // 応答を保存する。完了・中断・エラー・切断のどれが先でも 1 回だけ
  async function saveAnswer(interrupted: boolean, contextTokens?: number) {
    if (saved) return;
    saved = true;
    const msg: ChatMessage = { role: "assistant", content: answer, createdAt: new Date().toISOString() };
    if (thinking) msg.thinking = thinking;
    if (interrupted) msg.interrupted = true;
    s.messages.push(msg);
    s.updatedAt = msg.createdAt;
    if (contextTokens !== undefined) s.lastContextTokens = contextTokens;
    // 応答中に利用者がセッションを削除していたら、作り直さない
    await saveSession(s, { mustExist: true });
  }

  const onClientGone = () => abort.abort(new Error("client disconnected"));
  req.signal.addEventListener("abort", onClientGone, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(line(e));
        } catch {
          closed = true;
        }
      };
      try {
        if (isNew) {
          send({ type: "session", session: { id: s.id, title: s.title, model: s.model, updatedAt: s.updatedAt } });
        }
        let contextTokens = 0;
        const chunks = chat(
          { model, messages: ollamaMessages, think: entry.capabilities.includes("thinking"), numCtx: cfg.numCtx },
          abort.signal,
        );
        for await (const chunk of streamWithIdleTimeout(chunks, cfg.idleTimeoutSec * 1000, abort.signal)) {
          const th = chunk.message?.thinking;
          if (th) {
            thinking += th;
            send({ type: "thinking", text: th });
          }
          const c = chunk.message?.content;
          if (c) {
            answer += c;
            send({ type: "content", text: c });
          }
          if (chunk.done) contextTokens = (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0);
        }
        await saveAnswer(false, contextTokens);
        send({
          type: "done",
          contextTokens,
          contextLimit: cfg.numCtx,
          warn: contextTokens >= cfg.numCtx * cfg.contextWarnRatio,
        });
      } catch (err) {
        if (abort.signal.aborted && !(err instanceof IdleTimeoutError)) {
          // 利用者の停止・切断
          await saveAnswer(true);
        } else if (err instanceof IdleTimeoutError) {
          abort.abort(err);
          await saveAnswer(true);
          send(errorEvent("timeout"));
        } else {
          const code = classifyOllamaError(err, await isUp());
          await saveAnswer(true);
          send(errorEvent(code, err instanceof Error ? err.message : String(err)));
        }
      } finally {
        req.signal.removeEventListener("abort", onClientGone);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // すでに閉じている
          }
        }
      }
    },
    // ブラウザ側の切断（request.signal が発火しない版の Next.js でも検知する）
    cancel() {
      closed = true;
      abort.abort(new Error("client disconnected"));
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

"use client";
// チャットの送受信。/api/chat の NDJSON（ChatEvent）を受けて表示用の発言を組み立てる
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, t } from "@/lib/i18n";
import { readNdjson } from "@/lib/ndjson";
import type { ChatEvent, ChatMessage, Session, SessionSummary } from "@/lib/types";

const HEALTH_INTERVAL_MS = 3000;

// 画面だけで使う発言の形：送信直後の画像はサーバーに保存される前なので、ローカルのプレビューで見せる
export type UiMessage = ChatMessage & { previews?: { name: string; url: string }[] };

export function useChat(
  sessionId: string | null,
  opts: { model: string; onSessionCreated(s: SessionSummary): void; onDone(): void },
) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [warn, setWarn] = useState(false);
  const [ollamaDown, setOllamaDown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optsRef = useRef(opts);
  const sessionIdRef = useRef(sessionId);
  const createdIdRef = useRef<string | null>(null); // 自分の送信で作られたセッション ID（これでは読み直さない）
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0); // 表示中のセッションが変わったら古いストリームの結果を捨てる

  useEffect(() => {
    optsRef.current = opts;
  });

  // セッションが外から変わったときだけ読み直す
  useEffect(() => {
    sessionIdRef.current = sessionId;
    if (sessionId !== null && sessionId === createdIdRef.current) return;
    genRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    createdIdRef.current = null;
    // 表示中のセッションの切り替え
    setMessages([]);
    setStreaming(false);
    setWarn(false);
    setError(null);
    if (sessionId === null) return;
    const gen = genRef.current;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Session>) : null))
      .then((s) => {
        if (s && gen === genRef.current) setMessages(s.messages);
      })
      .catch(() => {});
  }, [sessionId]);

  // 再起動中は /api/health を確認し、復帰したら入力を再開できるようにする
  useEffect(() => {
    if (!ollamaDown) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (res.ok && ((await res.json()) as { ollamaUp: boolean }).ollamaUp) setOllamaDown(false);
      } catch {
        // まだ戻っていない
      }
    }, HEALTH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ollamaDown]);

  // 最後の（応答中の）発言を書き換える
  const updateLast = (gen: number, fn: (m: UiMessage) => UiMessage) => {
    if (gen !== genRef.current) return;
    setMessages((ms) => (ms.length === 0 ? ms : [...ms.slice(0, -1), fn(ms[ms.length - 1])]));
  };

  const consume = useCallback(async (res: Response, gen: number) => {
    let finished = false;
    const finish = () => {
      if (gen !== genRef.current) return;
      finished = true;
      setStreaming(false);
      abortRef.current = null;
      optsRef.current.onDone();
    };
    try {
      for await (const ev of readNdjson<ChatEvent>(res.body!)) {
        if (gen !== genRef.current) return;
        switch (ev.type) {
          case "session":
            createdIdRef.current = ev.session.id;
            optsRef.current.onSessionCreated(ev.session);
            break;
          case "thinking":
            updateLast(gen, (m) => ({ ...m, thinking: (m.thinking ?? "") + ev.text }));
            break;
          case "content":
            updateLast(gen, (m) => ({ ...m, content: m.content + ev.text }));
            break;
          case "done":
            setWarn(ev.warn);
            finish();
            break;
          case "error":
            updateLast(gen, (m) => ({ ...m, interrupted: true }));
            if (ev.code === "ollama_down" || ev.code === "too_heavy") setOllamaDown(true);
            else setError(ev.message);
            finish();
            break;
        }
      }
    } catch {
      // [停止] や切断。下で中断として扱う
    }
    if (!finished && gen === genRef.current) {
      updateLast(gen, (m) => ({ ...m, interrupted: true }));
      finish();
    }
  }, []);

  // 受け付けられたら true（応答は裏で流れ続ける）。送れなかったら false（入力欄の文を残す）
  const send = useCallback(
    async (content: string, files: File[]): Promise<boolean> => {
      if (abortRef.current) return false;
      const gen = genRef.current;
      const now = new Date().toISOString();
      const user: UiMessage = { role: "user", content, createdAt: now };
      if (files.length > 0) user.previews = files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
      const assistant: UiMessage = { role: "assistant", content: "", createdAt: now };
      setMessages((ms) => [...ms, user, assistant]);
      setStreaming(true);
      setError(null);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const form = new FormData();
      const sid = sessionIdRef.current ?? createdIdRef.current;
      if (sid) form.append("sessionId", sid);
      form.append("model", optsRef.current.model);
      form.append("content", content);
      for (const f of files) form.append("images", f);

      const rollback = () => {
        if (gen !== genRef.current) return;
        setMessages((ms) => ms.slice(0, -2));
        setStreaming(false);
        abortRef.current = null;
      };

      let res: Response;
      try {
        res = await fetch("/api/chat", { method: "POST", body: form, signal: ctrl.signal });
      } catch (e) {
        rollback();
        setError(t("chat.failed", { detail: e instanceof Error ? e.message : String(e) }));
        return false;
      }
      if (!res.ok || !res.body) {
        rollback();
        let body: { error?: string; message?: string } = {};
        try {
          body = await res.json();
        } catch {
          // 本文なし
        }
        if (body.error === "ollama_down") setOllamaDown(true);
        else setError(errorText(body.error, body.message ?? t("chat.failed", { detail: `HTTP ${res.status}` })));
        return false;
      }
      void consume(res, gen);
      return true;
    },
    [consume],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, send, stop, streaming, warn, ollamaDown, error };
}

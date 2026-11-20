"use client";
// チャット欄：発言一覧・警告・バナー・入力欄
import { useEffect, useRef } from "react";
import { useChat } from "@/hooks/useChat";
import { t } from "@/lib/i18n";
import type { ModelEntry, SessionSummary } from "@/lib/types";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import { OllamaDownBanner } from "./OllamaDownBanner";
import styles from "./Chat.module.css";

export function ChatView(props: {
  sessionId: string | null;
  model: string;
  models: ModelEntry[];
  ollamaUp: boolean;
  locked: boolean; // ダウンロード中
  onSessionCreated(s: SessionSummary): void;
  onDone(): void;
  onRequestDownload(model: string): void;
}) {
  const chat = useChat(props.sessionId, {
    model: props.model,
    onSessionCreated: props.onSessionCreated,
    onDone: props.onDone,
  });
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [chat.messages]);

  const entry = props.models.find((m) => m.name === props.model);
  const restarting = chat.ollamaDown || !props.ollamaUp;
  // 削除済みモデルの過去セッションは閲覧のみ。Ollama が止まっている間は有無が分からないので判定しない（spec 11-12）
  const readOnly = !restarting && props.models.length > 0 && props.sessionId !== null && !entry?.installed;
  // 新しいチャットで未ダウンロードのモデル（起動時の自動ダウンロードを中止した場合など）は、ダウンロードを案内する
  const needDownload =
    !restarting && props.models.length > 0 && props.sessionId === null && !!props.model && !entry?.installed;
  const canAttach = !!entry?.capabilities.includes("vision");

  return (
    <div className={styles.chat}>
      {restarting && <OllamaDownBanner />}
      <div className={styles.messages}>
        {chat.messages.length === 0 && <p className={styles.placeholder}>{t("chat.empty")}</p>}
        {chat.messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            sessionId={props.sessionId}
            streaming={chat.streaming && i === chat.messages.length - 1}
          />
        ))}
        <div ref={bottom} />
      </div>
      {chat.warn && <p className={styles.warn}>{t("chat.contextWarn")}</p>}
      {chat.error && (
        <p role="alert" className={styles.error}>
          {chat.error}
        </p>
      )}
      {readOnly && <p className={styles.readOnly}>{t("session.modelDeleted")}</p>}
      {needDownload && (
        <p className={styles.readOnly}>
          {t("chat.needDownload", { name: props.model })}{" "}
          <button
            type="button"
            className={styles.inlineButton}
            disabled={props.locked}
            onClick={() => props.onRequestDownload(props.model)}
          >
            {t("download.start")}
          </button>
        </p>
      )}
      <Composer
        disabled={props.locked || readOnly || restarting || needDownload}
        canAttach={canAttach}
        streaming={chat.streaming}
        onSend={chat.send}
        onStop={chat.stop}
      />
    </div>
  );
}

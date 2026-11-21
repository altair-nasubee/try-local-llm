"use client";
import { memo } from "react";
import type { UiMessage } from "@/hooks/useChat";
import { t } from "@/lib/i18n";
import { MarkdownView } from "./MarkdownView";
import { ThinkingBlock } from "./ThinkingBlock";
import styles from "./Chat.module.css";

// 応答中は最後の発言だけが変わるので、ほかの発言は描き直さない
export const MessageBubble = memo(function MessageBubble({
  message,
  sessionId,
  streaming,
}: {
  message: UiMessage;
  sessionId: string | null;
  streaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>
          <div className={styles.speaker}>{t("chat.you")}</div>
          {(message.images?.length || message.previews?.length) && (
            <div className={styles.images}>
              {/* eslint-disable @next/next/no-img-element -- API・blob: の画像をそのまま出す */}
              {sessionId &&
                message.images?.map((f) => (
                  <img key={f} src={`/api/sessions/${sessionId}/images/${f}`} alt={f} className={styles.image} />
                ))}
              {!message.images?.length &&
                message.previews?.map((p) => <img key={p.url} src={p.url} alt={p.name} className={styles.image} />)}
              {/* eslint-enable @next/next/no-img-element */}
            </div>
          )}
          {message.content && <div className={styles.userText}>{message.content}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.assistantRow}>
      <div className={styles.speaker}>{t("chat.assistant")}</div>
      {message.thinking && <ThinkingBlock text={message.thinking} />}
      <MarkdownView text={message.content} streaming={streaming} />
      {streaming && !message.content && <span className={styles.cursor} aria-hidden="true" />}
      {message.interrupted && <span className={styles.interrupted}>{t("chat.interrupted")}</span>}
    </div>
  );
});

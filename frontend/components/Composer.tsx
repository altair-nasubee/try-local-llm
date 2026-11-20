"use client";
// 入力欄。画像は 📎 ボタン・ドラッグ＆ドロップ・貼り付けの 3 通りで添付できる
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { type Attachment, AttachmentTray } from "./AttachmentTray";
import { Icon } from "./Icon";
import styles from "./Chat.module.css";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 4;

export function Composer(props: {
  disabled: boolean;
  canAttach: boolean; // vision 対応モデルのときだけ
  streaming: boolean;
  onSend(content: string, files: File[]): Promise<boolean> | boolean;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<Attachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  // 画面を離れるときにプレビューの URL を解放する
  useEffect(() => () => attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.url)), []);

  const attachEnabled = props.canAttach && !props.disabled;

  function addFiles(files: File[]) {
    if (!attachEnabled || files.length === 0) return;
    let message: string | null = null;
    const next = [...attachments];
    for (const file of files) {
      if (!TYPES.includes(file.type)) {
        message = t("chat.attachType", { name: file.name });
        continue;
      }
      if (file.size > MAX_BYTES) {
        message = t("chat.attachSize", { name: file.name });
        continue;
      }
      if (next.length >= MAX_FILES) {
        message = t("chat.attachCount");
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setAttachments(next);
    setError(message);
  }

  function remove(index: number) {
    URL.revokeObjectURL(attachments[index].url);
    setAttachments(attachments.filter((_, i) => i !== index));
    setError(null);
  }

  const canSend = !props.disabled && !props.streaming && !sending && (text.trim() !== "" || attachments.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      const ok = await props.onSend(text, attachments.map((a) => a.file));
      if (ok) {
        // プレビューは送信後の発言の表示に使うので、ここでは解放しない
        setText("");
        setAttachments([]);
        setError(null);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={t("chat.composer")}
      className={styles.composer}
      onDragOver={(e) => {
        if (attachEnabled) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(Array.from(e.dataTransfer?.files ?? []));
      }}
    >
      <AttachmentTray items={attachments} onRemove={remove} />
      {error && (
        <p role="alert" className={styles.composerError}>
          {error}
        </p>
      )}
      <div className={styles.composerRow}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("chat.attach")}
          title={t("chat.attach")}
          disabled={!attachEnabled}
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="clip" />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <textarea
          className={styles.textarea}
          value={text}
          rows={2}
          placeholder={t("chat.inputPlaceholder")}
          aria-label={t("chat.inputPlaceholder")}
          disabled={props.disabled}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            // 変換中（IME）の Enter は確定なので送信しない。Shift+Enter は改行
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            void send();
          }}
        />
        {props.streaming ? (
          <button type="button" className={styles.stopButton} onClick={props.onStop}>
            {t("chat.stop")}
          </button>
        ) : (
          <button type="button" className={styles.sendButton} disabled={!canSend} onClick={() => void send()}>
            {t("chat.send")}
          </button>
        )}
      </div>
    </div>
  );
}

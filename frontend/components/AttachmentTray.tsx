"use client";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";
import styles from "./Chat.module.css";

export type Attachment = { file: File; url: string };

// 送信前の添付画像のサムネイルと ✕
export function AttachmentTray({ items, onRemove }: { items: Attachment[]; onRemove(index: number): void }) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.tray}>
      {items.map((a, i) => (
        <li key={a.url + i} className={styles.thumb}>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: の URL は next/image で扱えない */}
          <img src={a.url} alt={a.file.name} />
          <button
            type="button"
            className={styles.thumbRemove}
            aria-label={t("chat.removeAttachment", { name: a.file.name })}
            onClick={() => onRemove(i)}
          >
            <Icon name="close" size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

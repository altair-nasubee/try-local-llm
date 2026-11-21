"use client";
import { useState } from "react";
import { t } from "@/lib/i18n";
import styles from "./Chat.module.css";

// コードブロック。children は色分け済みの中身、raw はコピー用の元の文字列
export function CodeBlock({ language, raw, children }: { language?: string; raw: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボードが使えない環境では何もしない
    }
  }

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{language ?? ""}</span>
        <button type="button" className={styles.copyButton} onClick={() => void copy()}>
          {copied ? t("chat.copied") : t("chat.copy")}
        </button>
      </div>
      <pre className={styles.pre}>
        <code className={language ? `hljs language-${language}` : "hljs"}>{children ?? raw}</code>
      </pre>
    </div>
  );
}

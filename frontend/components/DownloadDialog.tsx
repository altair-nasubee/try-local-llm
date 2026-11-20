"use client";
import { useId } from "react";
import { formatGb, formatGbFixed, percent } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { DownloadState, ModelEntry } from "@/lib/types";
import styles from "./Dialog.module.css";

// ダウンロードの確認・進捗・エラー。実行中とエラーはサーバーの状態から出す（リロード後も同じ表示になる）
export function DownloadDialog(props: {
  confirm: ModelEntry | null;
  state: DownloadState;
  startError: string | null;
  starting?: boolean;
  onStart(): void;
  onClose(): void;
  onAbort(): void;
}) {
  const titleId = useId();
  const { state, confirm } = props;

  let content: React.ReactNode = null;
  if (state.status === "running") {
    const p = percent(state.completed, state.total);
    content = (
      <>
        <p id={titleId} className={styles.title}>
          {t("download.running")}
        </p>
        <p className={styles.body}>{state.model}</p>
        <div
          role="progressbar"
          aria-labelledby={titleId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p}
          className={styles.track}
        >
          <div className={styles.bar} style={{ width: `${p}%` }} />
        </div>
        <p className={styles.progressText}>
          {t("download.progress", {
            percent: p,
            done: formatGbFixed(state.completed),
            total: formatGbFixed(state.total),
          })}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={props.onAbort}>
            {t("download.abort")}
          </button>
        </div>
      </>
    );
  } else if (state.status === "error") {
    content = (
      <>
        <p id={titleId} className={styles.title}>
          {t("download.failed")}（{state.model}）
        </p>
        <p role="alert" className={styles.error}>
          {state.message}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={props.onClose}>
            {t("common.close")}
          </button>
        </div>
      </>
    );
  } else if (confirm) {
    content = (
      <>
        <p id={titleId} className={styles.title}>
          {t("download.confirmTitle", { name: confirm.name })}
        </p>
        <p className={styles.body}>
          {confirm.sizeBytes === null ? t("model.sizeUnknown") : t("model.size", { size: formatGb(confirm.sizeBytes) })}
          {confirm.tier === "slow" && <span className={styles.warn}>⚠ {t("model.slow")}</span>}
        </p>
        {props.startError && (
          <p role="alert" className={styles.error}>
            {props.startError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={props.onClose} disabled={props.starting}>
            {t("common.cancel")}
          </button>
          <button type="button" className={styles.primary} onClick={props.onStart} disabled={props.starting}>
            {t("download.start")}
          </button>
        </div>
      </>
    );
  }

  if (!content) return null;
  return (
    <div className={styles.overlay}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.dialog}>
        {content}
      </div>
    </div>
  );
}

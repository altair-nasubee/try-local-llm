"use client";
import { useId } from "react";
import { t } from "@/lib/i18n";
import styles from "./Dialog.module.css";

// 削除などの確認ダイアログ
export function ConfirmDialog(props: {
  title: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm(): void;
  onCancel(): void;
}) {
  const titleId = useId();
  return (
    <div className={styles.overlay}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={styles.dialog}>
        <p id={titleId} className={styles.title}>
          {props.title}
        </p>
        {props.error && (
          <p role="alert" className={styles.error}>
            {props.error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={props.onCancel} disabled={props.busy}>
            {t("common.cancel")}
          </button>
          <button type="button" className={styles.danger} onClick={props.onConfirm} disabled={props.busy}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

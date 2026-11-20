"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";
import styles from "./ModelPicker.module.css";

// （！）ボタン。押すと説明を出し、外側クリックか Esc で閉じる
export function InfoPopover({ label, text, disabled }: { label: string; text: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={styles.popoverWrap}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        <Icon name="info" />
      </button>
      {open && (
        <span id={id} role="note" className={styles.popover}>
          {text}
        </span>
      )}
    </span>
  );
}

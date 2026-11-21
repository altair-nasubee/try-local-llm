"use client";
import { t } from "@/lib/i18n";
import type { SessionSummary } from "@/lib/types";
import { Icon } from "./Icon";
import styles from "./SessionList.module.css";

export function SessionList(props: {
  list: SessionSummary[];
  currentId: string | null;
  disabled: boolean;
  onNew(): void;
  onOpen(s: SessionSummary): void;
  onDeleteRequest(s: SessionSummary): void;
}) {
  return (
    <aside className={styles.aside}>
      <button type="button" className={styles.newChat} onClick={props.onNew} disabled={props.disabled}>
        <Icon name="plus" />
        {t("chat.newChat")}
      </button>
      <nav aria-label={t("session.list")} className={styles.nav}>
        {props.list.length === 0 && <p className={styles.empty}>{t("session.empty")}</p>}
        <ul className={styles.list}>
          {props.list.map((s) => {
            const current = s.id === props.currentId;
            return (
              <li key={s.id} className={current ? styles.itemCurrent : styles.item}>
                <button
                  type="button"
                  className={styles.open}
                  aria-label={t("session.open", { title: s.title })}
                  aria-current={current ? "true" : undefined}
                  disabled={props.disabled}
                  onClick={() => props.onOpen(s)}
                  title={`${s.title}（${s.model}）`}
                >
                  {s.title}
                </button>
                <button
                  type="button"
                  className={styles.delete}
                  aria-label={t("session.deleteOne", { title: s.title })}
                  disabled={props.disabled}
                  onClick={() => props.onDeleteRequest(s)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

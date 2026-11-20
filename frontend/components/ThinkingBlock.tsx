import { t } from "@/lib/i18n";
import styles from "./Chat.module.css";

// 思考過程。折りたたんで表示し、クリックで展開する
export function ThinkingBlock({ text }: { text: string }) {
  return (
    <details className={styles.thinking}>
      <summary>{t("chat.thinking")}</summary>
      <div className={styles.thinkingText}>{text}</div>
    </details>
  );
}

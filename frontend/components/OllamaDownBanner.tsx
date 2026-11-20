import { t } from "@/lib/i18n";
import styles from "./Chat.module.css";

// Ollama の停止・再起動中の表示（spec 7.3）
export function OllamaDownBanner() {
  return (
    <div role="status" className={styles.banner}>
      {t("ollama.restarting")}
    </div>
  );
}

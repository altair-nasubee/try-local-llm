import { t } from "@/lib/i18n";

// 画面本体は Task 9 で作る
export default function Home() {
  return (
    <main>
      <h1>{t("app.title")}</h1>
    </main>
  );
}

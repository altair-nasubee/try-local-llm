import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { getTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: t("app.title"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const theme = getTheme();
  return (
    <html lang="ja" data-theme={theme === "system" ? undefined : theme}>
      <body>{children}</body>
    </html>
  );
}

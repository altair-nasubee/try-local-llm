// 画面の文言は messages/<言語>.json から読む。将来の英語版は en.json を足し、ここで切り替える
import ja from "@/messages/ja.json";

export type MessageKey = keyof typeof ja;

const messages: Record<MessageKey, string> = ja;

// "{name}" の形の変数を置換する
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = messages[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

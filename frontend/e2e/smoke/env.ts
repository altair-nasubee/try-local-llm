// スモーク（本番の画面）用：リポジトリの .env を読む。scripts/start.sh と同じく、シェルとして実行せずに値だけ読む
import { readFileSync } from "node:fs";
import path from "node:path";

export function envValue(name: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(__dirname, "../../../.env"), "utf8");
  } catch {
    return undefined;
  }
  const line = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith(`${name}=`))
    .pop();
  const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  return value ? value : undefined;
}

// compose は BIND_ADDRESS:PORT だけで待ち受ける（scripts/start.sh と同じ決め方）
const bind = envValue("BIND_ADDRESS") ?? "127.0.0.1";
const host = bind === "127.0.0.1" || bind === "0.0.0.0" ? "localhost" : bind;
export const BASE_URL = `http://${host}:${envValue("PORT") ?? "3000"}`;
export const SESSION_LIMIT = Number(envValue("SESSION_LIMIT") ?? "10");

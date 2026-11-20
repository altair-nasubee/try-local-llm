// E2E の共通処理
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const APP = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export const MOCK = process.env.E2E_MOCK_URL ?? "http://localhost:11500";
// scripts/e2e.sh --local のときは、frontend のデータフォルダを直接操作する
const LOCAL_DATA_DIR = process.env.E2E_DATA_DIR;

const COMPOSE = ["compose", "-f", "../compose.yaml", "-f", "../compose.e2e.yaml", "-p", "local-llm-chat-e2e"];
const DISCOVERY_FIXTURE = path.join(__dirname, "fixtures/cache/discovery.json");

// 偽 Ollama の操作（/__mock/*）
export async function mock(name: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${MOCK}/__mock/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`mock ${name}: ${res.status}`);
  return res.json();
}

export type ChatScript = {
  thinking?: string;
  content: string;
  chunkDelayMs?: number;
  dropAfterChunks?: number;
  promptEvalCount?: number;
  failWith?: string;
};
export const script = (s: ChatScript) => mock("script", s);
export const lastChat = () =>
  mock("last-chat") as Promise<{ model: string; messages: { role: string; content: string; images: number }[] }>;

// 各 spec の beforeEach で呼ぶ：偽 Ollama・ダウンロード状態・保存データを初期状態に戻す
export async function resetAll(opts: { discovery?: boolean } = {}) {
  await mock("reset");
  await fetch(`${APP}/api/models/download`, { method: "DELETE" });
  if (LOCAL_DATA_DIR) {
    rmSync(path.join(LOCAL_DATA_DIR, "sessions"), { recursive: true, force: true });
    rmSync(path.join(LOCAL_DATA_DIR, "cache"), { recursive: true, force: true });
    mkdirSync(path.join(LOCAL_DATA_DIR, "cache"), { recursive: true });
    if (opts.discovery) copyFileSync(DISCOVERY_FIXTURE, path.join(LOCAL_DATA_DIR, "cache/discovery.json"));
    return;
  }
  // コンテナの node ユーザーで作り直す
  execFileSync("docker", [
    ...COMPOSE,
    "exec",
    "-T",
    "frontend",
    "sh",
    "-c",
    "rm -rf /app/data/sessions /app/data/cache && mkdir -p /app/data/cache",
  ]);
  if (opts.discovery) {
    execFileSync("docker", [...COMPOSE, "cp", "e2e/fixtures/cache/discovery.json", "frontend:/app/data/cache/discovery.json"]);
  }
}

export const picker = (page: Page) => page.getByRole("combobox", { name: "モデル" });
export const input = (page: Page) => page.getByRole("textbox", { name: "メッセージを入力…" });
export const banner = (page: Page) => page.getByText("モデルが重すぎて停止しました。再起動中です");

export async function openApp(page: Page) {
  await page.goto("/");
  await expect(picker(page)).toHaveValue("gemma4:e4b");
}

// 送信して応答の完了（[送信] ボタンが戻る）まで待つ
export async function send(page: Page, text: string, opts: { wait?: boolean } = {}) {
  await input(page).fill(text);
  await page.getByRole("button", { name: "送信" }).click();
  if (opts.wait !== false) await expect(page.getByRole("button", { name: "送信" })).toBeVisible();
}

// API で直接セッションを作る（一覧の件数の確認用）
export async function createSessionViaApi(content: string, model = "gemma4:e4b"): Promise<string> {
  const form = new FormData();
  form.append("model", model);
  form.append("content", content);
  const res = await fetch(`${APP}/api/chat`, { method: "POST", body: form });
  const text = await res.text();
  const first = JSON.parse(text.split("\n")[0]) as { type: string; session?: { id: string } };
  if (first.type !== "session" || !first.session) throw new Error(`session not created: ${text}`);
  return first.session.id;
}

// 先頭バイトだけ PNG の、指定サイズの画像データ
export function pngBuffer(size: number): Buffer {
  const b = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return b;
}

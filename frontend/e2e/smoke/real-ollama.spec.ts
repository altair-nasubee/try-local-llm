// 実 Ollama（GPU）での最小限の確認。scripts/start.sh で起動してから npm run test:smoke
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BASE_URL, SESSION_LIMIT } from "./env";

const picker = (page: import("@playwright/test").Page) => page.getByRole("combobox", { name: "モデル" });

// 本番の画面で実際に送信するので、利用者の会話を消さないようにする：
// - 会話を作ると上限を超えた古い会話が自動で消えるため、上限に達していたら何も送らずに止める
// - テストで作った会話は、テストのたびに消す
type Summary = { id: string };
const listSessions = async (): Promise<Summary[]> => (await fetch(`${BASE_URL}/api/sessions`)).json();
let existing = new Set<string>();

test.beforeAll(async () => {
  const list = await listSessions();
  if (list.length >= SESSION_LIMIT) {
    throw new Error(
      `保存済みの会話が上限（${SESSION_LIMIT} 件）に達しています。このまま流すと古い会話が自動で消えるため中止しました。` +
        "画面から不要な会話を 1 件以上消してから、もう一度実行してください",
    );
  }
  existing = new Set(list.map((s) => s.id));
});

test.afterEach(async () => {
  for (const s of await listSessions()) {
    if (!existing.has(s.id)) await fetch(`${BASE_URL}/api/sessions/${s.id}`, { method: "DELETE" });
  }
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(picker(page)).toHaveValue("gemma4:e4b");
  await expect(picker(page).locator("option", { hasText: "gemma4:e4b" })).toContainText("すぐ使える");
});

test("gemma4:e4b に「1+1は？」→ 60 秒以内に応答が完了する", async ({ page }) => {
  await page.getByRole("textbox", { name: "メッセージを入力…" }).fill("1+1は？数字だけで答えて");
  await page.getByRole("button", { name: "送信" }).click();
  // 初回はモデルの読み込み（実機で約 40 秒。ディスクの速さで変わる）が入るため、最初の出力までは別に待つ。
  // 「60 秒以内に応答が完了」は、出力が始まってからの時間で測る
  const chat = page.getByRole("region", { name: "ローカル LLM チャット" });
  await expect(chat.getByText("考え中…（クリックで展開）").or(chat.getByText("2", { exact: true }))).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByRole("button", { name: "送信" })).toBeVisible({ timeout: 60_000 });
  await expect(chat.getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByText("（中断）")).toHaveCount(0);
});

test("sample.png を添付して応答が返る", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "../fixtures/sample.png"));
  await page.getByRole("textbox", { name: "メッセージを入力…" }).fill("この画像の色を一言で答えて");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.getByRole("button", { name: "送信" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("（中断）")).toHaveCount(0);
});

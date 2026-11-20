// 実 Ollama（GPU）での最小限の確認。scripts/start.sh で起動してから npm run test:smoke
import path from "node:path";
import { expect, test } from "@playwright/test";

const picker = (page: import("@playwright/test").Page) => page.getByRole("combobox", { name: "モデル" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(picker(page)).toHaveValue("gemma4:e4b");
  await expect(picker(page).locator("option", { hasText: "gemma4:e4b" })).toContainText("すぐ使える");
});

test("gemma4:e4b に「1+1は？」→ 60 秒以内に応答が完了する", async ({ page }) => {
  await page.getByRole("textbox", { name: "メッセージを入力…" }).fill("1+1は？数字だけで答えて");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.getByRole("button", { name: "送信" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("2").last()).toBeVisible();
  await expect(page.getByText("（中断）")).toHaveCount(0);
});

test("sample.png を添付して応答が返る", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "../fixtures/sample.png"));
  await page.getByRole("textbox", { name: "メッセージを入力…" }).fill("この画像の色を一言で答えて");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.getByRole("button", { name: "送信" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("（中断）")).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { mock, openApp, picker, resetAll } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetAll();
  await openApp(page);
});

test("未DLモデル（tiny-dl:1b）選択→ダイアログ→ダウンロード→進捗→完了で一覧更新・選択状態", async ({ page }) => {
  await mock("pull", { totalBytes: 5e7, stepMs: 150 });
  await picker(page).selectOption("tiny-dl:1b");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("tiny-dl:1b はダウンロードされていません");
  await dialog.getByRole("button", { name: "ダウンロード" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
  await expect(picker(page)).toHaveValue("tiny-dl:1b");
  await expect(picker(page).locator("option", { hasText: "tiny-dl:1b" })).toContainText("✅ すぐ使える");
});

test("slow-dl:8b は一覧とダイアログに『遅くなります』が付く", async ({ page }) => {
  await expect(picker(page).locator("option", { hasText: "slow-dl:8b" })).toContainText("遅くなります");
  await picker(page).selectOption("slow-dl:8b");
  await expect(page.getByRole("dialog")).toContainText("遅くなります");
  await expect(page.getByRole("dialog")).toContainText("サイズ：約8GB");
});

test("ダウンロード中は [中止] 以外が押せず、[中止] で解除", async ({ page }) => {
  await mock("pull", { totalBytes: 5e7, stepMs: 1000 });
  await picker(page).selectOption("tiny-dl:1b");
  await page.getByRole("button", { name: "ダウンロード" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "新しいチャット" })).toBeDisabled();
  await expect(picker(page)).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "メッセージを入力…" })).toBeDisabled();
  await page.getByRole("button", { name: "中止" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(picker(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "新しいチャット" })).toBeEnabled();
});

test("ダウンロード中にリロードしても進捗ダイアログが再表示される", async ({ page }) => {
  await mock("pull", { totalBytes: 5e7, stepMs: 1000 });
  await picker(page).selectOption("tiny-dl:1b");
  await page.getByRole("button", { name: "ダウンロード" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(picker(page)).toBeDisabled();
  await page.getByRole("button", { name: "中止" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("pull 失敗（failAt）でエラー文が出て操作禁止が解除される", async ({ page }) => {
  await mock("pull", { totalBytes: 5e7, stepMs: 100, failAt: 2e7 });
  await picker(page).selectOption("tiny-dl:1b");
  await page.getByRole("button", { name: "ダウンロード" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("unexpected EOF", { timeout: 15_000 });
  await expect(picker(page)).toBeDisabled();
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(picker(page)).toBeEnabled();
});

test("選択中モデルを削除→確認→デフォルトモデルに切替。デフォルトはゴミ箱 disabled", async ({ page }) => {
  await expect(page.getByRole("button", { name: "モデルを削除" })).toBeDisabled();
  await picker(page).selectOption("text-only:1b");
  await page.getByRole("button", { name: "モデルを削除" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("text-only:1b を削除しますか？（約1GB解放）");
  await dialog.getByRole("button", { name: "削除する" }).click();
  await expect(picker(page)).toHaveValue("gemma4:e4b");
  await expect(picker(page).locator("option", { hasText: "text-only:1b" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "モデルを削除" })).toBeDisabled();
});

test("（！）で models.yaml の説明が出る", async ({ page }) => {
  await page.getByRole("button", { name: "一覧にないモデルを使うには" }).click();
  await expect(page.getByText(/models\.yaml にモデルの種類を追記してください/)).toBeVisible();
});

test("discovered の gemma4:e2b は出て、excluded サイズの gemma4:31b は出ない", async ({ page }) => {
  await resetAll({ discovery: true });
  await page.reload();
  await expect(picker(page).locator("option", { hasText: "gemma4:e2b" })).toHaveCount(1);
  await expect(picker(page).locator("option", { hasText: "gemma4:31b" })).toHaveCount(0);
});

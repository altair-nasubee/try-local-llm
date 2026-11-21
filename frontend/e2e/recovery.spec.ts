import { expect, test } from "@playwright/test";
import { banner, input, mock, picker, resetAll, script, send } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});
test.afterEach(async () => {
  await mock("up");
});

test("dropAfterChunks で応答中に偽サーバーごと停止 → バナー表示、途中応答は（中断）で残る、/__mock/up でバナーが消え送信できる", async ({
  page,
}) => {
  await page.goto("/");
  await expect(picker(page)).toHaveValue("gemma4:e4b");
  await script({ content: "途中まで書いて止まる応答", chunkDelayMs: 100, dropAfterChunks: 2 });
  await send(page, "重い質問", { wait: false });
  await expect(banner(page)).toBeVisible();
  await expect(page.getByText("（中断）")).toBeVisible();
  await expect(page.getByText("途中まで書")).toBeVisible();
  await expect(input(page)).toBeDisabled();
  await mock("up");
  await expect(banner(page)).toBeHidden({ timeout: 15_000 });
  await send(page, "もう一度");
  await expect(page.getByText("OK", { exact: true })).toBeVisible();
});

test("偽サーバーが down のまま画面を開いても表示され、削除済み表示やダウンロードダイアログは出ず、up 後にモデル一覧が出る", async ({
  page,
}) => {
  await mock("down");
  await page.goto("/");
  await expect(picker(page)).toHaveValue("gemma4:e4b");
  await expect(banner(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("このモデルは削除されています")).toHaveCount(0);
  await expect(picker(page).locator("option", { hasText: "未ダウンロード" })).toHaveCount(0);
  await mock("up");
  await expect(picker(page).locator("option", { hasText: "gemma4:e4b" })).toContainText("✅ すぐ使える", {
    timeout: 15_000,
  });
  await expect(banner(page)).toBeHidden();
});

test("failWith でモデルの実行プロセス停止を再現 → バナー表示 → 自動で消え、再送できる", async ({ page }) => {
  await page.goto("/");
  await expect(picker(page)).toHaveValue("gemma4:e4b");
  await script({ content: "", failWith: "model runner has unexpectedly stopped, this may be due to resource limitations" });
  await send(page, "重い質問", { wait: false });
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toBeHidden({ timeout: 15_000 });
  await send(page, "再送");
  await expect(page.getByText("OK", { exact: true })).toBeVisible();
});

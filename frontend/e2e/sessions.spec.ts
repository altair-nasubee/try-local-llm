import { expect, test } from "@playwright/test";
import { APP, createSessionViaApi, input, openApp, resetAll, send } from "./helpers";

const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "セッション" });
const sessionButtons = (page: import("@playwright/test").Page) => nav(page).getByRole("button", { name: / を開く$/ });

test.beforeEach(async ({ page }) => {
  await resetAll();
  await openApp(page);
});

test("リロード後もセッション一覧と会話が残る", async ({ page }) => {
  await send(page, "保存テスト");
  await expect(nav(page).getByRole("button", { name: "保存テスト を開く" })).toBeVisible();
  await page.reload();
  // 開いた直後は新しいチャット
  await expect(page.getByText("質問を入力して送信してください")).toBeVisible();
  await nav(page).getByRole("button", { name: "保存テスト を開く" }).click();
  await expect(page.getByText("保存テスト", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("OK", { exact: true })).toBeVisible();
});

test("11 件目作成で最古が消える", async ({ page }) => {
  for (let i = 1; i <= 11; i++) await createSessionViaApi(`質問${i}`);
  await page.reload();
  await expect(sessionButtons(page)).toHaveCount(10);
  await expect(nav(page).getByRole("button", { name: "質問1 を開く" })).toHaveCount(0);
  await expect(nav(page).getByRole("button", { name: "質問11 を開く" })).toBeVisible();
});

test("古いセッションを開いて続けると一覧の先頭に上がり、次の作成で消されない", async ({ page }) => {
  for (let i = 1; i <= 10; i++) await createSessionViaApi(`質問${i}`);
  await page.reload();
  await nav(page).getByRole("button", { name: "質問1 を開く" }).click();
  await expect(page.getByText("OK", { exact: true })).toBeVisible();
  await send(page, "続き");
  await expect(sessionButtons(page).first()).toHaveAccessibleName("質問1 を開く");
  await createSessionViaApi("質問11");
  await page.reload();
  await expect(nav(page).getByRole("button", { name: "質問1 を開く" })).toBeVisible();
  await expect(nav(page).getByRole("button", { name: "質問2 を開く" })).toHaveCount(0);
});

test("一覧のゴミ箱→確認でセッションが消える", async ({ page }) => {
  await createSessionViaApi("消すセッション");
  await page.reload();
  await nav(page).getByRole("button", { name: "消すセッション を削除" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "削除する" }).click();
  await expect(nav(page).getByRole("button", { name: "消すセッション を開く" })).toHaveCount(0);
});

test("削除済みモデルのセッションは入力欄 disabled と説明文", async ({ page }) => {
  await createSessionViaApi("古いモデルの会話", "text-only:1b");
  const res = await fetch(`${APP}/api/models/${encodeURIComponent("text-only:1b")}`, { method: "DELETE" });
  expect(res.status).toBe(204);
  await page.reload();
  await nav(page).getByRole("button", { name: "古いモデルの会話 を開く" }).click();
  await expect(page.getByText("このモデルは削除されています")).toBeVisible();
  await expect(input(page)).toBeDisabled();
});

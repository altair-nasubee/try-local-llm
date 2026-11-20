import { expect, test } from "@playwright/test";
import { input, openApp, picker, resetAll, script, send } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetAll();
  await openApp(page);
});

test("送信すると応答が逐次表示され、完了後にプルダウンが 🔒 になる", async ({ page }) => {
  await script({ content: "こんにちは、これはテストの応答です。", chunkDelayMs: 150 });
  await send(page, "やあ", { wait: false });
  await expect(page.getByRole("main").getByText("やあ", { exact: true })).toBeVisible();
  // 途中まで表示されている（[停止] が出ている間に最初のチャンクが見える）
  await expect(page.getByText("こんにちは")).toBeVisible();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await expect(page.getByText("こんにちは、これはテストの応答です。")).toBeVisible();
  await expect(page.getByRole("button", { name: "送信" })).toBeVisible();
  await expect(picker(page)).toBeDisabled();
  await expect(page.getByRole("img", { name: "このチャットではモデルを変更できません" })).toBeVisible();
});

test("思考過程が『考え中…（クリックで展開）』で折りたたまれ、クリックで開く", async ({ page }) => {
  await script({ thinking: "まず問題を整理します", content: "答えは 2 です" });
  await send(page, "1+1は？");
  await expect(page.getByText("答えは 2 です")).toBeVisible();
  const summary = page.getByText("考え中…（クリックで展開）");
  await expect(summary).toBeVisible();
  await expect(page.getByText("まず問題を整理します")).toBeHidden();
  await summary.click();
  await expect(page.getByText("まず問題を整理します")).toBeVisible();
});

test("表・チェックボックス・言語付きコードブロック（コピーボタン）が整形表示される", async ({ page }) => {
  await script({
    content: "| 名前 | 値 |\n|---|---|\n| a | 1 |\n\n- [x] 済み\n- [ ] まだ\n\n```ts\nconst x: number = 1;\n```\n",
    chunkDelayMs: 5,
  });
  await send(page, "表を出して");
  await expect(page.locator("table")).toBeVisible();
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(page.locator("code.language-ts .hljs-keyword").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "コピー" })).toBeVisible();
});

test("mermaid ブロックは完了後に svg になり、壊れた mermaid はコードのまま", async ({ page }) => {
  await script({
    content: "```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\nthis is not mermaid ???\n```\n",
    chunkDelayMs: 5,
  });
  await send(page, "図");
  await expect(page.locator('svg[id^="mermaid-"]')).toHaveCount(1);
  await expect(page.locator("pre code").filter({ hasText: "this is not mermaid ???" })).toBeVisible();
});

test("<script>alert(1)</script> を含む応答で dialog が発生しない", async ({ page }) => {
  let dialog = false;
  page.on("dialog", async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await script({ content: "安全確認<script>alert(1)</script><img src=x onerror=alert(2)>終わり", chunkDelayMs: 5 });
  await send(page, "q");
  await expect(page.getByText(/終わり/)).toBeVisible();
  await page.waitForTimeout(500);
  expect(dialog).toBe(false);
  await expect(page.locator(".markdown script, main script")).toHaveCount(0);
});

test("[停止] で応答が止まり（中断）が付く", async ({ page }) => {
  await script({ content: "とても長い応答がゆっくり続きます。".repeat(5), chunkDelayMs: 200 });
  await send(page, "長く", { wait: false });
  await expect(page.getByText("とても長い")).toBeVisible();
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.getByText("（中断）")).toBeVisible();
  await expect(page.getByRole("button", { name: "送信" })).toBeVisible();
});

test("chunkDelayMs が IDLE_TIMEOUT_SEC を超えると打ち切り文言が出る", async ({ page }) => {
  await script({ content: "ab", chunkDelayMs: 5000 });
  await send(page, "遅い", { wait: false });
  await expect(page.getByRole("alert").filter({ hasText: "打ち切りました" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("（中断）")).toBeVisible();
  await expect(input(page)).toBeEnabled();
});

test("promptEvalCount が NUM_CTX×0.8 以上で長さ警告が出て、送信は可能", async ({ page }) => {
  await script({ content: "長い会話", promptEvalCount: 7000 });
  await send(page, "q");
  await expect(page.getByText("会話が長くなりました。新しいチャットをおすすめします")).toBeVisible();
  await input(page).fill("続き");
  await expect(page.getByRole("button", { name: "送信" })).toBeEnabled();
});

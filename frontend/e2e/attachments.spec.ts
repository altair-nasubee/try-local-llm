import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { lastChat, openApp, picker, pngBuffer, resetAll, send } from "./helpers";

const SAMPLE_PNG = path.join(__dirname, "fixtures/sample.png");
const SAMPLE_GIF = path.join(__dirname, "fixtures/sample.gif");
const fileInput = (page: Page) => page.locator('input[type="file"]');
// Next.js のルートアナウンサーも role="alert" を持つため、入力欄の中のものだけを見る
const alert = (page: Page) => page.getByRole("group", { name: "メッセージ入力" }).getByRole("alert");
const tray = (page: Page) => page.getByRole("group", { name: "メッセージ入力" }).getByRole("img");

// ドラッグ＆ドロップ・貼り付けで渡すファイル
async function dispatchFile(page: Page, kind: "drop" | "paste", name: string) {
  const bytes = [...readFileSync(SAMPLE_PNG)];
  const target = kind === "drop" ? page.getByRole("group", { name: "メッセージ入力" }) : page.getByRole("textbox");
  await target.evaluate(
    (el, { kind, name, bytes }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type: "image/png" }));
      const ev =
        kind === "drop"
          ? new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })
          : new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
    },
    { kind, name, bytes },
  );
}

test.beforeEach(async ({ page }) => {
  await resetAll();
  await openApp(page);
});

test("PNG を📎・ドラッグ＆ドロップ・貼り付けで添付し、送信後も画像が表示される", async ({ page }) => {
  await fileInput(page).setInputFiles(SAMPLE_PNG);
  await dispatchFile(page, "drop", "dropped.png");
  await dispatchFile(page, "paste", "pasted.png");
  await expect(tray(page)).toHaveCount(3);
  await send(page, "この画像を説明して");
  await expect(tray(page)).toHaveCount(0);
  expect((await lastChat()).messages.at(-1)?.images).toBe(3);
  // 保存された画像をサーバーから読み直しても表示される
  await page.reload();
  await page.getByRole("button", { name: "この画像を説明して を開く" }).click();
  for (const name of ["img-1.png", "img-2.png", "img-3.png"]) {
    const img = page.getByRole("img", { name });
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(8);
  }
});

test("GIF・10MB 超・5 枚目は拒否される", async ({ page }) => {
  await fileInput(page).setInputFiles(SAMPLE_GIF);
  await expect(alert(page)).toContainText("PNG・JPEG・WebP");
  await expect(tray(page)).toHaveCount(0);

  await fileInput(page).setInputFiles({ name: "big.png", mimeType: "image/png", buffer: pngBuffer(10 * 1024 * 1024 + 1) });
  await expect(alert(page)).toContainText("10MB");
  await expect(tray(page)).toHaveCount(0);

  await fileInput(page).setInputFiles(
    [1, 2, 3, 4, 5].map((i) => ({ name: `${i}.png`, mimeType: "image/png", buffer: readFileSync(SAMPLE_PNG) })),
  );
  await expect(tray(page)).toHaveCount(4);
  await expect(alert(page)).toContainText("4 枚");
});

test("9MB の PNG 4 枚を一度に送っても受け付けられる", async ({ page }) => {
  await fileInput(page).setInputFiles(
    [1, 2, 3, 4].map((i) => ({ name: `nine-${i}.png`, mimeType: "image/png", buffer: pngBuffer(9 * 1024 * 1024) })),
  );
  await expect(tray(page)).toHaveCount(4);
  await send(page, "大きい画像");
  await expect(page.getByText("OK", { exact: true })).toBeVisible();
  expect((await lastChat()).messages.at(-1)?.images).toBe(4);
});

test("text-only:1b では📎が disabled", async ({ page }) => {
  await picker(page).selectOption("text-only:1b");
  await expect(page.getByRole("button", { name: "画像を添付" })).toBeDisabled();
});

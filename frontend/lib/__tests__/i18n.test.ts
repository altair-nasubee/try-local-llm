import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";

describe("t", () => {
  it("変数を置換する", () => {
    expect(t("download.confirmTitle", { name: "x" })).toBe("x はダウンロードされていません");
  });

  it("同じ変数が複数あってもすべて置換する", () => {
    expect(t("download.progress", { percent: 62, done: "11.2", total: "18" })).toBe("62%（11.2/18GB）");
  });

  it("変数を渡さなければそのまま返す", () => {
    expect(t("model.slow")).toBe("遅くなります");
  });
});

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { errorText, t } from "@/lib/i18n";

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

describe("errorText", () => {
  // app/api の apiError(…, "<code>") をすべて集める（新しいコードを足したときに文言の漏れを防ぐ）
  function apiErrorCodes(): string[] {
    const codes = new Set<string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__") walk(p);
        } else if (e.name === "route.ts") {
          for (const m of readFileSync(p, "utf8").matchAll(/apiError\(\d+, "([a-z_]+)"/g)) codes.add(m[1]);
        }
      }
    };
    walk(path.join(__dirname, "../../app/api"));
    return [...codes];
  }

  it("API が返すすべてのエラーコードに日本語の文言がある", () => {
    const codes = apiErrorCodes();
    expect(codes).toContain("ollama_down");
    const missing = codes.filter((c) => errorText(c, "MISSING") === "MISSING");
    expect(missing).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { hasOpenFence } from "@/lib/markdown";

describe("hasOpenFence", () => {
  it("閉じていないフェンスがあれば true", () => {
    expect(hasOpenFence("a\n```mermaid\ngraph TD")).toBe(true);
  });

  it("閉じていれば false", () => {
    expect(hasOpenFence("```mermaid\ngraph TD\n```\n")).toBe(false);
    expect(hasOpenFence("text only")).toBe(false);
  });

  it("2 つ目が開いたままなら true", () => {
    expect(hasOpenFence("```js\nx\n```\n\n```mermaid\ngraph")).toBe(true);
  });

  it("行の途中の ``` は数えない", () => {
    expect(hasOpenFence("インラインの ``` は無視")).toBe(false);
  });
});

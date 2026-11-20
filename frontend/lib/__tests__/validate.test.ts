import { describe, expect, it } from "vitest";
import { isValidFamily, isValidImageFile, isValidModelName, isValidSessionId } from "@/lib/validate";

describe("isValidModelName", () => {
  it.each(["gemma4:e4b", "llama3.1:8b", "library/qwen3:8b", "hf.co/User/Repo-GGUF:Q4_K_M", "a/b/c:d"])(
    "%s を通す",
    (name) => expect(isValidModelName(name)).toBe(true),
  );

  it.each([
    "gemma4", // タグなし
    "../x:1",
    "a/../b:1",
    "a/b/c/d:1", // / は 3 段まで
    ".hidden:1",
    "a:..",
    "a:-x",
    "a b:1",
    "",
    "a:1/",
  ])("%s を拒否する", (name) => expect(isValidModelName(name)).toBe(false));
});

describe("isValidSessionId", () => {
  it("形式どおりの ID を通す", () => expect(isValidSessionId("20261120-153000-a1b2c3")).toBe(true));
  it.each(["20261120-153000-A1B2C3", "20261120-153000-a1b2c", "../20261120-153000-a1b2c3", "x"])(
    "%s を拒否する",
    (id) => expect(isValidSessionId(id)).toBe(false),
  );
});

describe("isValidImageFile", () => {
  it.each(["img-1.png", "img-12.jpg", "img-3.webp"])("%s を通す", (f) => expect(isValidImageFile(f)).toBe(true));
  it.each(["img-1.gif", "img-.png", "../img-1.png", "img-1.png/x", "img-1.jpeg"])("%s を拒否する", (f) =>
    expect(isValidImageFile(f)).toBe(false),
  );
});

describe("isValidFamily", () => {
  it.each(["gemma4", "llama3.1", "qwen3-coder"])("%s を通す", (f) => expect(isValidFamily(f)).toBe(true));
  it.each(["../x", "a/b", "", ".x", "a:b"])("%s を拒否する", (f) => expect(isValidFamily(f)).toBe(false));
});

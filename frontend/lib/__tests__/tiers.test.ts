import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { classifyTier } from "@/lib/tiers";

const cfg = getConfig({ TIER_COMFORT_MAX_GB: "7", TIER_EXCLUDE_MIN_GB: "20" });

describe("classifyTier", () => {
  it("7GB 以下は comfort", () => {
    expect(classifyTier(6.6e9, cfg)).toBe("comfort");
    expect(classifyTier(7e9, cfg)).toBe("comfort");
  });

  it("7GB を超え 20GB 未満は slow", () => {
    expect(classifyTier(8e9, cfg)).toBe("slow");
    expect(classifyTier(19.99e9, cfg)).toBe("slow");
  });

  it("20GB 以上は excluded", () => {
    expect(classifyTier(20e9, cfg)).toBe("excluded");
  });

  it("サイズ不明は slow（comfort 扱いにしない）", () => {
    expect(classifyTier(null, cfg)).toBe("slow");
  });

  it(".env のしきい値に従う", () => {
    const small = getConfig({ TIER_COMFORT_MAX_GB: "4", TIER_EXCLUDE_MIN_GB: "10" });
    expect(classifyTier(5e9, small)).toBe("slow");
    expect(classifyTier(10e9, small)).toBe("excluded");
  });
});

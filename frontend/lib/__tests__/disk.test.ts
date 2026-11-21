import { statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { freeBytes } from "@/lib/disk";

describe("freeBytes", () => {
  it("statfs の bavail * bsize を返す", async () => {
    const s = statfsSync(tmpdir());
    const expected = s.bavail * s.bsize;
    const got = await freeBytes(tmpdir());
    // 計測の間にほかのプロセスが書き込むことがあるため、1% の差は許す
    expect(Math.abs(got - expected)).toBeLessThan(expected * 0.01 + 1);
    expect(got).toBeGreaterThan(0);
  });

  it("存在しないパスは例外", async () => {
    await expect(freeBytes("/no/such/dir/xyz")).rejects.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const refreshDiscovery = vi.fn();
vi.mock("@/lib/discovery", () => ({ refreshDiscovery }));

afterEach(() => {
  vi.unstubAllEnvs();
  refreshDiscovery.mockReset();
});

describe("instrumentation register", () => {
  it("検索の完了を待たずに終わる", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("DISCOVERY_ENABLED", "true");
    refreshDiscovery.mockReturnValue(new Promise(() => {})); // 終わらない検索
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
    expect(refreshDiscovery).toHaveBeenCalledTimes(1);
  });

  it("DISCOVERY_ENABLED=false なら検索しない", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("DISCOVERY_ENABLED", "false");
    const { register } = await import("@/instrumentation");
    await register();
    expect(refreshDiscovery).not.toHaveBeenCalled();
  });

  it("Edge ランタイムでは何もしない", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("DISCOVERY_ENABLED", "true");
    const { register } = await import("@/instrumentation");
    await register();
    expect(refreshDiscovery).not.toHaveBeenCalled();
  });
});

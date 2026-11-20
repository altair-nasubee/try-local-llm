import { defineConfig, devices } from "@playwright/test";

// E2E（偽 Ollama）。scripts/e2e.sh から動かす（npm run test:e2e）
export default defineConfig({
  testDir: "e2e",
  testIgnore: "smoke/**",
  // 偽 Ollama とサーバー側のダウンロード状態は全テストで 1 つを共有するため、並列に動かさない
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

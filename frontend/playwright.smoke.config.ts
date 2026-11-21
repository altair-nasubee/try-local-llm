import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/smoke/env";

// スモーク（実 Ollama・GPU）。scripts/start.sh で起動した本番の画面に対して動かす
export default defineConfig({
  testDir: "e2e/smoke",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  use: { baseURL: BASE_URL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

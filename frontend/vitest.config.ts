import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // 既定は node。Route Handler のテストで FormData・ReadableStream・fs を Node 本来の実装で動かすため。
    // コンポーネントとフックのテストはファイル先頭に `// @vitest-environment jsdom` を書く
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**"],
      thresholds: { lines: 80 },
    },
  },
});

import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";

describe("getConfig", () => {
  it("既定値を返す", () => {
    const c = getConfig({});
    expect(c.defaultModel).toBe("gemma4:e4b");
    expect(c.numCtx).toBe(8192);
    expect(c.idleTimeoutSec).toBe(180);
    expect(c.contextWarnRatio).toBe(0.8);
    expect(c.tierComfortMaxGb).toBe(7);
    expect(c.tierExcludeMinGb).toBe(20);
    expect(c.discoveryTtlHours).toBe(24);
    expect(c.discoveryEnabled).toBe(true);
    expect(c.sessionLimit).toBe(10);
    expect(c.ollamaUrl).toBe("http://ollama:11434");
    expect(c.dataDir).toBe("/app/data");
    expect(c.modelsYamlPath).toBe("/app/models.yaml");
  });

  it("環境変数の値を使う", () => {
    const c = getConfig({
      DEFAULT_MODEL: "qwen3:8b",
      NUM_CTX: "4096",
      CONTEXT_WARN_RATIO: "0.5",
      OLLAMA_URL: "http://localhost:11500",
      DATA_DIR: "/tmp/x",
      MODELS_YAML_PATH: "/tmp/models.yaml",
    });
    expect(c.defaultModel).toBe("qwen3:8b");
    expect(c.numCtx).toBe(4096);
    expect(c.contextWarnRatio).toBe(0.5);
    expect(c.ollamaUrl).toBe("http://localhost:11500");
    expect(c.dataDir).toBe("/tmp/x");
    expect(c.modelsYamlPath).toBe("/tmp/models.yaml");
  });

  it("数値でない値は既定値に戻す", () => {
    expect(getConfig({ NUM_CTX: "abc" }).numCtx).toBe(8192);
    expect(getConfig({ SESSION_LIMIT: "" }).sessionLimit).toBe(10);
    expect(getConfig({ SESSION_LIMIT: "-3" }).sessionLimit).toBe(10);
  });

  it('DISCOVERY_ENABLED="false" を false と読む', () => {
    expect(getConfig({ DISCOVERY_ENABLED: "false" }).discoveryEnabled).toBe(false);
  });

  it("空の DEFAULT_MODEL は既定値に戻す", () => {
    expect(getConfig({ DEFAULT_MODEL: "" }).defaultModel).toBe("gemma4:e4b");
  });

  it("タグを省いた DEFAULT_MODEL には :latest を補う（Ollama は gemma4 を gemma4:latest として一覧に出すため）", () => {
    expect(getConfig({ DEFAULT_MODEL: "gemma4" }).defaultModel).toBe("gemma4:latest");
    expect(getConfig({ DEFAULT_MODEL: "hf.co/User/Repo" }).defaultModel).toBe("hf.co/User/Repo:latest");
    expect(getConfig({ DEFAULT_MODEL: "hf.co/User/Repo:Q4_K_M" }).defaultModel).toBe("hf.co/User/Repo:Q4_K_M");
    expect(getConfig({ DEFAULT_MODEL: " qwen3:8b " }).defaultModel).toBe("qwen3:8b");
  });
});

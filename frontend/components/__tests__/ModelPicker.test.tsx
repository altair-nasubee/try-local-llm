// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "@/components/ModelPicker";
import type { ModelEntry } from "@/lib/types";

const models: ModelEntry[] = [
  { name: "gemma4:e4b", sizeBytes: 6.6e9, tier: "comfort", installed: true, capabilities: [], source: "yaml" },
  { name: "gemma4:12b", sizeBytes: 8e9, tier: "slow", installed: true, capabilities: [], source: "yaml" },
  { name: "gemma4:26b", sizeBytes: 18e9, tier: "slow", installed: false, capabilities: [], source: "yaml" },
];

function setup(over: Partial<Parameters<typeof ModelPicker>[0]> = {}) {
  const props = {
    models,
    selectedModel: "gemma4:12b",
    defaultModel: "gemma4:e4b",
    ollamaUp: true,
    conversationLocked: false,
    disabled: false,
    onSelect: vi.fn(),
    onDeleteRequest: vi.fn(),
    ...over,
  };
  render(<ModelPicker {...props} />);
  return props;
}

describe("ModelPicker", () => {
  it("各モデルに状態と注記を付けて並べる", () => {
    setup();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "gemma4:e4b ✅ すぐ使える",
      "gemma4:12b ✅ すぐ使える ⚠ 遅くなります",
      "gemma4:26b ⬇ 未ダウンロード ⚠ 遅くなります",
    ]);
  });

  it("選ぶと onSelect を呼ぶ", async () => {
    const p = setup();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "モデル" }), "gemma4:26b");
    expect(p.onSelect).toHaveBeenCalledWith("gemma4:26b");
  });

  it("デフォルトモデル選択中はゴミ箱が disabled", () => {
    setup({ selectedModel: "gemma4:e4b" });
    expect(screen.getByRole("button", { name: "モデルを削除" })).toBeDisabled();
  });

  it("ダウンロード済みモデルを選んでいるとゴミ箱が押せ、onDeleteRequest を呼ぶ", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "モデルを削除" }));
    expect(p.onDeleteRequest).toHaveBeenCalledWith("gemma4:12b");
  });

  it("未ダウンロードのモデルを選んでいるときはゴミ箱を出さない", () => {
    setup({ selectedModel: "gemma4:26b" });
    expect(screen.queryByRole("button", { name: "モデルを削除" })).toBeNull();
  });

  it("会話中（currentSession にメッセージあり）はプルダウンが disabled で 🔒 表示", () => {
    setup({ conversationLocked: true });
    expect(screen.getByRole("combobox", { name: "モデル" })).toBeDisabled();
    expect(screen.getByRole("img", { name: "このチャットではモデルを変更できません" })).toBeInTheDocument();
  });

  it("（！）を押すと models.yaml の説明文が出る", async () => {
    setup();
    expect(screen.queryByText(/models\.yaml にモデルの種類を追記/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "一覧にないモデルを使うには" }));
    expect(screen.getByText(/models\.yaml にモデルの種類を追記/)).toBeInTheDocument();
  });

  it("disabled（ダウンロード中）はプルダウンもゴミ箱も押せない", () => {
    setup({ disabled: true });
    expect(screen.getByRole("combobox", { name: "モデル" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "モデルを削除" })).toBeDisabled();
  });

  it("一覧に無いモデル（削除済みセッションのモデル）も選択中として表示する", () => {
    setup({ selectedModel: "old:1b", conversationLocked: true });
    expect(screen.getByRole("combobox", { name: "モデル" })).toHaveValue("old:1b");
  });

  it("Ollama 停止中は「未ダウンロード」「すぐ使える」を付けない（有無が分からないため）", () => {
    setup({ ollamaUp: false, models: models.map((m) => ({ ...m, installed: false })) });
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["gemma4:e4b", "gemma4:12b ⚠ 遅くなります", "gemma4:26b ⚠ 遅くなります"]);
  });
});

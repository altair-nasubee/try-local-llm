// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DownloadDialog } from "@/components/DownloadDialog";
import type { ModelEntry } from "@/lib/types";

const big: ModelEntry = { name: "gemma4:26b", sizeBytes: 18e9, tier: "slow", installed: false, capabilities: [], source: "yaml" };

function setup(over: Partial<Parameters<typeof DownloadDialog>[0]> = {}) {
  const props = {
    confirm: null,
    state: { status: "idle" as const },
    startError: null,
    onStart: vi.fn(),
    onClose: vi.fn(),
    onAbort: vi.fn(),
    ...over,
  };
  const r = render(<DownloadDialog {...props} />);
  return { props, ...r };
}

describe("DownloadDialog", () => {
  it("何もなければ表示しない", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("確認：モデル名・サイズ・遅くなります注記と、キャンセル／ダウンロード", async () => {
    const { props } = setup({ confirm: big });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("gemma4:26b はダウンロードされていません");
    expect(dialog).toHaveTextContent("サイズ：約18GB");
    expect(dialog).toHaveTextContent("遅くなります");
    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));
    expect(props.onStart).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("快適なモデルには遅くなります注記を出さない", () => {
    setup({ confirm: { ...big, name: "x:1b", sizeBytes: 1e9, tier: "comfort" } });
    expect(screen.getByRole("dialog")).not.toHaveTextContent("遅くなります");
  });

  it("開始できなかった理由を確認ダイアログに出す", () => {
    setup({ confirm: big, startError: "ディスクの空き容量が足りません" });
    expect(screen.getByRole("alert")).toHaveTextContent("ディスクの空き容量が足りません");
  });

  it("実行中：進捗バーと割合・GB、[中止] だけ", async () => {
    const { props } = setup({
      state: { status: "running", model: "gemma4:26b", completed: 11.2e9, total: 18e9, startedAt: "t" },
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("ダウンロード中…");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByRole("dialog")).toHaveTextContent("62%（11.2/18.0GB）");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["中止"]);
    await userEvent.click(screen.getByRole("button", { name: "中止" }));
    expect(props.onAbort).toHaveBeenCalled();
  });

  it("総量がまだ 0 なら 0%", () => {
    setup({ state: { status: "running", model: "a:1b", completed: 0, total: 0, startedAt: "t" } });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("エラー：エラー文と [閉じる]", async () => {
    const { props } = setup({ state: { status: "error", model: "gemma4:26b", message: "connection reset" } });
    expect(screen.getByRole("alert")).toHaveTextContent("connection reset");
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});

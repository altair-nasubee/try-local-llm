// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import type { DownloadState, ModelEntry, ModelsResponse, SessionSummary } from "@/lib/types";
import { jsonRes, mockFetch } from "@/test-utils/fetch-mock";

const entry = (name: string, sizeGb: number, installed: boolean): ModelEntry => ({
  name,
  sizeBytes: sizeGb * 1e9,
  tier: sizeGb <= 7 ? "comfort" : "slow",
  installed,
  capabilities: installed ? ["completion"] : [],
  source: "yaml",
});

let models: ModelsResponse;
let sessions: SessionSummary[];
let download: DownloadState;

function server(extra: Record<string, unknown> = {}) {
  return mockFetch({
    "GET /api/models": () => jsonRes(models),
    "GET /api/sessions": () => jsonRes(sessions),
    "GET /api/models/download": () => jsonRes(download),
    "DELETE /api/models/download": () => {
      download = { status: "idle" };
      return jsonRes(download);
    },
    ...extra,
  });
}

const picker = () => screen.getByRole("combobox", { name: "モデル" });
const sessionItems = () => within(screen.getByRole("navigation")).queryAllByRole("button", { name: /を開く$/ });

beforeEach(() => {
  models = {
    defaultModel: "gemma4:e4b",
    ollamaUp: true,
    models: [entry("gemma4:e4b", 6.6, true), entry("gemma4:12b", 8, true), entry("gemma4:26b", 18, false)],
  };
  sessions = [
    { id: "20261120-100000-aaaaaa", title: "Dockerの質問", model: "gemma4:12b", updatedAt: "2026-11-20T10:00:00Z" },
    { id: "20261120-090000-bbbbbb", title: "翻訳テスト", model: "gemma4:e4b", updatedAt: "2026-11-20T09:00:00Z" },
  ];
  download = { status: "idle" };
});
afterEach(() => vi.unstubAllGlobals());

describe("AppShell", () => {
  it("アプリを開いた直後は新しいチャット（空）＋デフォルトモデル。過去のセッションは一覧から開く", async () => {
    server();
    render(<AppShell />);
    await waitFor(() => expect(picker()).toHaveValue("gemma4:e4b"));
    expect(picker()).toBeEnabled();
    await waitFor(() => expect(sessionItems()).toHaveLength(2));
    expect(sessionItems().some((b) => b.getAttribute("aria-current") === "true")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Dockerの質問 を開く" }));
    expect(screen.getByRole("button", { name: "Dockerの質問 を開く" })).toHaveAttribute("aria-current", "true");
    expect(picker()).toHaveValue("gemma4:12b");
    expect(picker()).toBeDisabled(); // 会話中はモデルを変えられない

    await userEvent.click(screen.getByRole("button", { name: "新しいチャット" }));
    expect(sessionItems().some((b) => b.getAttribute("aria-current") === "true")).toBe(false);
    expect(picker()).toBeEnabled();
  });

  it("未DLモデルを選ぶと DownloadDialog（サイズと遅くなります注記付き）が開く", async () => {
    server();
    render(<AppShell />);
    await waitFor(() => expect(picker()).toHaveValue("gemma4:e4b"));
    await userEvent.selectOptions(picker(), "gemma4:26b");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("gemma4:26b はダウンロードされていません");
    expect(dialog).toHaveTextContent("サイズ：約18GB");
    expect(dialog).toHaveTextContent("遅くなります");
    // キャンセルすると選択は元のまま
    await userEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(picker()).toHaveValue("gemma4:e4b");
  });

  it("[ダウンロード] で開始し、完了したらそのモデルを選択状態にする", async () => {
    server({
      "POST /api/models/download": () => {
        download = { status: "done", model: "gemma4:26b" };
        models.models[2] = entry("gemma4:26b", 18, true);
        return jsonRes({ status: "running", model: "gemma4:26b", completed: 0, total: 18e9, startedAt: "t" }, 202);
      },
    });
    render(<AppShell />);
    await waitFor(() => expect(picker()).toHaveValue("gemma4:e4b"));
    await userEvent.selectOptions(picker(), "gemma4:26b");
    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));
    await waitFor(() => expect(picker()).toHaveValue("gemma4:26b"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("POST が 507（空き容量不足）・409 を返したら、ダイアログにその理由を出し、ダウンロードは始まらない", async () => {
    let status = 507;
    server({
      "POST /api/models/download": () =>
        jsonRes({ error: status === 507 ? "disk" : "busy", message: status === 507 ? "空きが足りません" : "ダウンロード中…" }, status),
    });
    render(<AppShell />);
    await waitFor(() => expect(picker()).toHaveValue("gemma4:e4b"));
    await userEvent.selectOptions(picker(), "gemma4:26b");
    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("空きが足りません");
    expect(screen.queryByRole("progressbar")).toBeNull();
    status = 409;
    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ダウンロード中…"));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("locked 中は [中止] 以外のボタンが disabled", async () => {
    download = { status: "running", model: "gemma4:26b", completed: 1e9, total: 18e9, startedAt: "t" };
    server();
    render(<AppShell />);
    await screen.findByRole("progressbar");
    await waitFor(() => expect(sessionItems()).toHaveLength(2));
    const enabled = screen.getAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled.map((b) => b.textContent)).toEqual(["中止"]);
    expect(picker()).toBeDisabled();
  });

  it("DownloadState が error ならダイアログにエラー文を出し、閉じると locked が解除される", async () => {
    download = { status: "error", model: "gemma4:26b", message: "connection reset" };
    server();
    render(<AppShell />);
    expect(await screen.findByRole("alert")).toHaveTextContent("connection reset");
    expect(picker()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(picker()).toBeEnabled();
    expect(screen.getByRole("button", { name: "新しいチャット" })).toBeEnabled();
  });

  it("ollamaUp:false のときは選択中モデルが未インストール扱いでも DownloadDialog を開かない", async () => {
    models = { ...models, ollamaUp: false, models: models.models.map((m) => ({ ...m, installed: false })) };
    server();
    render(<AppShell />);
    await waitFor(() => expect(picker()).toHaveValue("gemma4:e4b"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.selectOptions(picker(), "gemma4:26b");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("削除確認で [削除する] → 選択中モデルならデフォルトモデルに切り替わり、会話中だったなら新しいチャットになる", async () => {
    const m = server({
      "DELETE /api/models/gemma4%3A12b": () => {
        models.models[1] = entry("gemma4:12b", 8, false);
        return new Response(null, { status: 204 });
      },
    });
    render(<AppShell />);
    await waitFor(() => expect(sessionItems()).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Dockerの質問 を開く" }));
    expect(picker()).toHaveValue("gemma4:12b");

    await userEvent.click(screen.getByRole("button", { name: "モデルを削除" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("gemma4:12b を削除しますか？（約8GB解放）");
    await userEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(picker()).toHaveValue("gemma4:e4b"));
    expect(sessionItems().some((b) => b.getAttribute("aria-current") === "true")).toBe(false);
    expect(picker()).toBeEnabled();
    // URL はエンコードして送る
    expect(m.fetch.mock.calls.some((c) => String(c[0]) === "/api/models/gemma4%3A12b")).toBe(true);
  });

  it("削除確認でキャンセルすると何もしない", async () => {
    const m = server();
    render(<AppShell />);
    await waitFor(() => expect(picker()).toHaveValue("gemma4:e4b"));
    await userEvent.selectOptions(picker(), "gemma4:12b");
    await userEvent.click(screen.getByRole("button", { name: "モデルを削除" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(m.calls.some((c) => c.method === "DELETE" && c.path.startsWith("/api/models/gemma4"))).toBe(false);
  });

  it("表示中のセッションを一覧から削除すると新しいチャット（空）になる", async () => {
    server({
      "DELETE /api/sessions/20261120-100000-aaaaaa": () => {
        sessions = sessions.slice(1);
        return new Response(null, { status: 204 });
      },
    });
    render(<AppShell />);
    await waitFor(() => expect(sessionItems()).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Dockerの質問 を開く" }));
    await userEvent.click(screen.getByRole("button", { name: "Dockerの質問 を削除" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("「Dockerの質問」を削除しますか？");
    await userEvent.click(within(dialog).getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(sessionItems()).toHaveLength(1));
    expect(sessionItems().some((b) => b.getAttribute("aria-current") === "true")).toBe(false);
    expect(picker()).toHaveValue("gemma4:12b"); // モデルは選んだまま（インストール済み）
    expect(picker()).toBeEnabled();
  });
});

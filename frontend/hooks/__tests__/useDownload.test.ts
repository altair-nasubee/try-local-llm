// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDownload } from "@/hooks/useDownload";
import type { DownloadState } from "@/lib/types";
import { jsonRes, mockFetch } from "@/test-utils/fetch-mock";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const running: DownloadState = { status: "running", model: "gemma4:26b", completed: 1e9, total: 18e9, startedAt: "t" };

describe("useDownload", () => {
  it("useDownload: 初回取得が running なら進捗ダイアログを開いた状態で始まる", async () => {
    mockFetch({ "GET /api/models/download": running });
    const { result } = renderHook(() => useDownload({ onDone: vi.fn() }));
    await waitFor(() => expect(result.current.state).toEqual(running));
  });

  it("running 中は 1 秒ごとにポーリングする", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = mockFetch({ "GET /api/models/download": running });
    renderHook(() => useDownload({ onDone: vi.fn() }));
    await waitFor(() => expect(m.calls.length).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(m.calls.length).toBe(2);
  });

  it("idle 中は 5 秒ごとにポーリングする", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = mockFetch({ "GET /api/models/download": { status: "idle" } });
    renderHook(() => useDownload({ onDone: vi.fn() }));
    await waitFor(() => expect(m.calls.length).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(m.calls.length).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(m.calls.length).toBe(2);
  });

  it("done を受け取ったら onDone(model) を 1 回呼び、DELETE で idle に戻す", async () => {
    const onDone = vi.fn();
    const m = mockFetch({
      "GET /api/models/download": { status: "done", model: "gemma4:26b" },
      "DELETE /api/models/download": { status: "idle" },
    });
    const { result } = renderHook(() => useDownload({ onDone }));
    await waitFor(() => expect(result.current.state).toEqual({ status: "idle" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("gemma4:26b");
    expect(m.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("start は POST し、その後の状態を反映する", async () => {
    let state: DownloadState = { status: "idle" };
    const m = mockFetch({
      "GET /api/models/download": () => jsonRes(state),
      "POST /api/models/download": () => {
        state = running;
        return jsonRes(running, 202);
      },
    });
    const { result } = renderHook(() => useDownload({ onDone: vi.fn() }));
    await waitFor(() => expect(m.calls.length).toBe(1));
    await act(() => result.current.start("gemma4:26b"));
    expect(result.current.state).toEqual(running);
    const post = m.calls.find((c) => c.method === "POST")!;
    expect(JSON.parse(post.init!.body as string)).toEqual({ model: "gemma4:26b" });
  });

  it("start が 507 を返したら、その理由で例外にし、状態は変えない", async () => {
    mockFetch({
      "GET /api/models/download": { status: "idle" },
      "POST /api/models/download": () => jsonRes({ error: "disk", message: "空き容量が足りません" }, 507),
    });
    const { result } = renderHook(() => useDownload({ onDone: vi.fn() }));
    await waitFor(() => expect(result.current.state).toEqual({ status: "idle" }));
    await act(async () => {
      await expect(result.current.start("gemma4:26b")).rejects.toThrow("空き容量が足りません");
    });
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("start が文言なしのエラーを返したら、ダウンロード用の日本語の文言にする（チャット用の文言やコードを出さない）", async () => {
    mockFetch({
      "GET /api/models/download": { status: "idle" },
      "POST /api/models/download": () => jsonRes({ error: "ollama_down" }, 503),
    });
    const { result } = renderHook(() => useDownload({ onDone: vi.fn() }));
    await waitFor(() => expect(result.current.state).toEqual({ status: "idle" }));
    let message = "";
    await act(async () => {
      message = await result.current.start("gemma4:26b").then(
        () => "",
        (e: Error) => e.message,
      );
    });
    expect(message).toMatch(/Ollama/);
    expect(message).not.toMatch(/ollama_down|応答の生成/);
  });

  it("cancel は DELETE して idle にする", async () => {
    let state: DownloadState = running;
    mockFetch({
      "GET /api/models/download": () => jsonRes(state),
      "DELETE /api/models/download": () => {
        state = { status: "idle" };
        return jsonRes(state);
      },
    });
    const { result } = renderHook(() => useDownload({ onDone: vi.fn() }));
    await waitFor(() => expect(result.current.state.status).toBe("running"));
    await act(() => result.current.cancel());
    expect(result.current.state).toEqual({ status: "idle" });
  });
});

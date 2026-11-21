// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "@/hooks/useChat";
import { jsonRes, mockFetch } from "@/test-utils/fetch-mock";

const SID = "20260101-000000-aaaaaa";
const OTHER = "20260101-000000-bbbbbb";

const ndjson = (events: unknown[]) =>
  new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
    headers: { "content-type": "application/x-ndjson" },
  });

beforeEach(() => {
  let n = 0;
  // jsdom には無い
  URL.createObjectURL = vi.fn(() => `blob:sent-${++n}`);
  URL.revokeObjectURL = vi.fn();
  mockFetch({
    "POST /api/chat": () =>
      ndjson([
        { type: "session", session: { id: SID, title: "q", model: "m:1b", updatedAt: "t" } },
        { type: "content", text: "a" },
        { type: "done", contextTokens: 1, contextLimit: 8192, warn: false },
      ]),
    [`GET /api/sessions/${OTHER}`]: () => jsonRes({ id: OTHER, title: "o", model: "m:1b", createdAt: "t", updatedAt: "t", messages: [] }),
  });
});
afterEach(() => vi.unstubAllGlobals());

const opts = { model: "m:1b", onSessionCreated: vi.fn(), onDone: vi.fn() };
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", { type: "image/png" });

describe("useChat の画像プレビュー", () => {
  it("別の会話に切り替えたら、送信時に作ったプレビューの URL を解放する", async () => {
    const { result, rerender } = renderHook(({ sid }) => useChat(sid, opts), {
      initialProps: { sid: null as string | null },
    });
    await act(async () => {
      await result.current.send("q", [png()]);
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // 表示中は解放しない
    rerender({ sid: OTHER });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sent-1");
  });

  it("画面を閉じたら（アンマウント）プレビューの URL を解放する", async () => {
    const { result, unmount } = renderHook(() => useChat(null, opts));
    await act(async () => {
      await result.current.send("q", [png()]);
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sent-1");
  });
});

describe("useChat の停止理由", () => {
  it("モデルが重すぎて止まったら、バナーが消えた後も読めるよう理由と対処を error に残す", async () => {
    mockFetch({
      "POST /api/chat": () =>
        ndjson([
          { type: "session", session: { id: SID, title: "q", model: "m:1b", updatedAt: "t" } },
          { type: "error", code: "too_heavy", message: "モデルが重すぎて停止しました。再起動中です" },
        ]),
    });
    const { result } = renderHook(() => useChat(null, opts));
    await act(async () => {
      await result.current.send("q", []);
    });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.ollamaDown).toBe(true);
    expect(result.current.error).toMatch(/重すぎ/);
    expect(result.current.error).toMatch(/軽いモデル/);
  });
});

describe("useChat の長さの警告", () => {
  it("過去の会話を開いたとき、長ければ警告を出す", async () => {
    mockFetch({
      [`GET /api/sessions/${OTHER}`]: () =>
        jsonRes({ id: OTHER, title: "o", model: "m:1b", createdAt: "t", updatedAt: "t", messages: [], contextWarn: true }),
    });
    const { result } = renderHook(() => useChat(OTHER, opts));
    await waitFor(() => expect(result.current.warn).toBe(true));
  });
});

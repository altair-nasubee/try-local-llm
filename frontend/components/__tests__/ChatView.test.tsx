// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, ModelEntry, Session } from "@/lib/types";
import { jsonRes, mockFetch } from "@/test-utils/fetch-mock";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), parse: vi.fn(async () => ({})), render: vi.fn(async () => ({ svg: "<svg></svg>" })) },
}));

const { ChatView } = await import("@/components/ChatView");

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const models: ModelEntry[] = [
  { name: "gemma4:e4b", sizeBytes: 6.6e9, tier: "comfort", installed: true, capabilities: ["completion", "vision", "thinking"], source: "yaml" },
  { name: "qwen3:8b", sizeBytes: 5e9, tier: "comfort", installed: true, capabilities: ["completion"], source: "discovered" },
];

// 外から 1 行ずつ流せる NDJSON の応答
function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, { headers: { "content-type": "application/x-ndjson" } }),
    push: (e: ChatEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n")),
    close: () => controller.close(),
    // 本物の fetch は abort すると本文の読み取りが失敗する
    error: (e: unknown) => controller.error(e),
  };
}

const ndjson = (events: ChatEvent[]) =>
  new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
    headers: { "content-type": "application/x-ndjson" },
  });

const session = (over: Partial<Session> = {}): Session => ({
  id: "20261120-100000-aaaaaa",
  title: "過去",
  model: "gemma4:e4b",
  createdAt: "2026-11-20T10:00:00Z",
  updatedAt: "2026-11-20T10:00:00Z",
  messages: [],
  ...over,
});

function setup(over: Partial<Parameters<typeof ChatView>[0]> = {}) {
  const props = {
    sessionId: null as string | null,
    model: "gemma4:e4b",
    models,
    ollamaUp: true,
    locked: false,
    onSessionCreated: vi.fn(),
    onDone: vi.fn(),
    onRequestDownload: vi.fn(),
    ...over,
  };
  const r = render(<ChatView {...props} />);
  return { props, ...r };
}

const input = () => screen.getByRole("textbox");
async function send(text: string) {
  await userEvent.type(input(), text);
  await userEvent.click(screen.getByRole("button", { name: "送信" }));
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => vi.unstubAllGlobals());

describe("ChatView", () => {
  it("送信すると応答を流れるように表示し、done で onDone を呼ぶ", async () => {
    const s = controlledStream();
    const m = mockFetch({ "POST /api/chat": () => s.response });
    const { props } = setup();
    await send("こんにちは");
    expect(screen.getByText("こんにちは")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    act(() => s.push({ type: "content", text: "やあ" }));
    await screen.findByText("やあ");
    act(() => {
      s.push({ type: "content", text: "、元気？" });
      s.push({ type: "done", contextTokens: 10, contextLimit: 8192, warn: false });
      s.close();
    });
    await screen.findByText("やあ、元気？");
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument();
    const body = m.calls[0].init!.body as FormData;
    expect(body.get("model")).toBe("gemma4:e4b");
    expect(body.get("content")).toBe("こんにちは");
    expect(body.get("sessionId")).toBeNull();
  });

  it("thinking があると『考え中…（クリックで展開）』で折りたたまれている", async () => {
    mockFetch({
      "POST /api/chat": () =>
        ndjson([
          { type: "thinking", text: "まず考える" },
          { type: "content", text: "答え" },
          { type: "done", contextTokens: 1, contextLimit: 8192, warn: false },
        ]),
    });
    setup();
    await send("q");
    await screen.findByText("答え");
    const summary = screen.getByText("考え中…（クリックで展開）");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    await userEvent.click(summary);
    expect(details.open).toBe(true);
    expect(details).toHaveTextContent("まず考える");
  });

  it("done.warn=true で警告文を表示し、送信は可能なまま", async () => {
    mockFetch({
      "POST /api/chat": () =>
        ndjson([
          { type: "content", text: "長い" },
          { type: "done", contextTokens: 7000, contextLimit: 8192, warn: true },
        ]),
    });
    setup();
    await send("q");
    expect(await screen.findByText("会話が長くなりました。新しいチャットをおすすめします")).toBeInTheDocument();
    await userEvent.type(input(), "続き");
    expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
  });

  it("error timeout を受けると打ち切りの文言を表示し、入力を再開できる", async () => {
    mockFetch({
      "POST /api/chat": () =>
        ndjson([
          { type: "content", text: "途中" },
          { type: "error", code: "timeout", message: "180 秒たっても応答がないため打ち切りました。もう一度送信してください" },
        ]),
    });
    setup();
    await send("q");
    expect(await screen.findByRole("alert")).toHaveTextContent("打ち切りました");
    expect(screen.getByText("（中断）")).toBeInTheDocument();
    expect(input()).toBeEnabled();
    await userEvent.type(input(), "再送");
    expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
  });

  it("新規送信で session イベントを受けても、ストリーミング中の表示が消えない", async () => {
    const s = controlledStream();
    const m = mockFetch({ "POST /api/chat": () => s.response });
    const { props, rerender } = setup();
    await send("最初の質問");
    act(() => {
      s.push({ type: "session", session: { id: "20261120-110000-newone", title: "最初の質問", model: "gemma4:e4b", updatedAt: "t" } });
      s.push({ type: "content", text: "書いている途中" });
    });
    await screen.findByText("書いている途中");
    expect(props.onSessionCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "20261120-110000-newone" }));
    // AppShell が currentSessionId を更新して渡し直す
    rerender(<ChatView {...props} sessionId="20261120-110000-newone" />);
    expect(screen.getByText("書いている途中")).toBeInTheDocument();
    expect(screen.getByText("最初の質問")).toBeInTheDocument();
    expect(m.calls.some((c) => c.path.startsWith("/api/sessions/"))).toBe(false);
    act(() => {
      s.push({ type: "done", contextTokens: 1, contextLimit: 8192, warn: false });
      s.close();
    });
  });

  it("2 回目の送信には sessionId を付ける", async () => {
    let n = 0;
    const m = mockFetch({
      "POST /api/chat": () =>
        n++ === 0
          ? ndjson([
              { type: "session", session: { id: "20261120-110000-newone", title: "q", model: "gemma4:e4b", updatedAt: "t" } },
              { type: "content", text: "a" },
              { type: "done", contextTokens: 1, contextLimit: 8192, warn: false },
            ])
          : ndjson([{ type: "done", contextTokens: 1, contextLimit: 8192, warn: false }]),
    });
    const { props, rerender } = setup();
    await send("q");
    await waitFor(() => expect(props.onSessionCreated).toHaveBeenCalled());
    rerender(<ChatView {...props} sessionId="20261120-110000-newone" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument());
    await send("q2");
    await waitFor(() => expect(m.calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect((m.calls[1].init!.body as FormData).get("sessionId")).toBe("20261120-110000-newone");
  });

  it("[停止] で fetch を中断し、（中断）を付ける", async () => {
    let aborted = false;
    mockFetch({
      "POST /api/chat": (init: RequestInit | undefined) => {
        const s = controlledStream();
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          s.error(new DOMException("aborted", "AbortError"));
        });
        setTimeout(() => s.push({ type: "content", text: "書きかけ" }), 0);
        return s.response;
      },
    });
    const { props } = setup();
    await send("q");
    await screen.findByText("書きかけ");
    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(aborted).toBe(true);
    expect(await screen.findByText("（中断）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument();
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
  });

  it("過去のセッションを開くと発言を読み込み、interrupted のメッセージに（中断）が付く", async () => {
    mockFetch({
      "GET /api/sessions/20261120-100000-aaaaaa": session({
        messages: [
          { role: "user", content: "質問", createdAt: "t", images: ["img-1.png"] },
          { role: "assistant", content: "途中まで", thinking: "考えた", interrupted: true, createdAt: "t" },
        ],
      }),
    });
    setup({ sessionId: "20261120-100000-aaaaaa" });
    expect(await screen.findByText("途中まで")).toBeInTheDocument();
    expect(screen.getByText("（中断）")).toBeInTheDocument();
    expect(screen.getByText("考え中…（クリックで展開）")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "img-1.png" })).toHaveAttribute(
      "src",
      "/api/sessions/20261120-100000-aaaaaa/images/img-1.png",
    );
  });

  it("セッションのモデルが installed に無いと入力欄 disabled と『このモデルは削除されています』", async () => {
    mockFetch({ "GET /api/sessions/20261120-100000-aaaaaa": session({ model: "gemma4:12b" }) });
    setup({ sessionId: "20261120-100000-aaaaaa", model: "gemma4:12b" });
    expect(await screen.findByText("このモデルは削除されています")).toBeInTheDocument();
    expect(input()).toBeDisabled();
  });

  it("ollamaUp:false のときは installed に無くても『削除されています』を出さない", async () => {
    mockFetch({
      "GET /api/sessions/20261120-100000-aaaaaa": session({ model: "gemma4:12b" }),
      "GET /api/health": { ollamaUp: false },
    });
    setup({
      sessionId: "20261120-100000-aaaaaa",
      model: "gemma4:12b",
      ollamaUp: false,
      models: models.map((m) => ({ ...m, installed: false })),
    });
    expect(await screen.findByText("モデルが重すぎて停止しました。再起動中です")).toBeInTheDocument();
    expect(screen.queryByText("このモデルは削除されています")).toBeNull();
  });

  it("vision 非対応モデルでは 📎 が disabled", () => {
    setup({ model: "qwen3:8b" });
    expect(screen.getByRole("button", { name: "画像を添付" })).toBeDisabled();
  });

  it("ollama_down を受けるとバナー表示、health が up でバナーが消える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let up = false;
    mockFetch({
      "POST /api/chat": () =>
        ndjson([
          { type: "content", text: "途中" },
          { type: "error", code: "ollama_down", message: "モデルが重すぎて停止しました。再起動中です" },
        ]),
      "GET /api/health": () => jsonRes({ ollamaUp: up }),
    });
    setup();
    await send("q");
    expect(await screen.findByText("モデルが重すぎて停止しました。再起動中です")).toBeInTheDocument();
    expect(input()).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByText("モデルが重すぎて停止しました。再起動中です")).toBeInTheDocument();
    up = true;
    await act(() => vi.advanceTimersByTimeAsync(3000));
    await waitFor(() => expect(screen.queryByText("モデルが重すぎて停止しました。再起動中です")).toBeNull());
    expect(input()).toBeEnabled();
  });

  it("too_heavy を受けるとバナー表示、health が up なら次の確認で消える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch({
      "POST /api/chat": () => ndjson([{ type: "error", code: "too_heavy", message: "モデルが重すぎて停止しました。再起動中です" }]),
      "GET /api/health": { ollamaUp: true },
    });
    setup();
    await send("q");
    expect(await screen.findByText("モデルが重すぎて停止しました。再起動中です")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    await waitFor(() => expect(screen.queryByText("モデルが重すぎて停止しました。再起動中です")).toBeNull());
  });

  it("送信前に 503 ollama_down なら、送った発言を取り消して入力を残し、バナーを出す", async () => {
    mockFetch({
      "POST /api/chat": () => jsonRes({ error: "ollama_down", message: "モデルが重すぎて停止しました。再起動中です" }, 503),
      "GET /api/health": { ollamaUp: false },
    });
    setup();
    await send("消えないで");
    expect(await screen.findByText("モデルが重すぎて停止しました。再起動中です")).toBeInTheDocument();
    expect(input()).toHaveValue("消えないで");
    expect(screen.queryAllByText("消えないで", { ignore: "textarea" })).toHaveLength(0); // 発言一覧には出ない
  });

  it("ダウンロード中（locked）は入力できない", () => {
    setup({ locked: true });
    expect(input()).toBeDisabled();
  });

  it("新しいチャットで未ダウンロードのモデルなら、入力できずダウンロードを案内する", async () => {
    const { props } = setup({
      model: "gemma4:e4b",
      models: models.map((m) => (m.name === "gemma4:e4b" ? { ...m, installed: false } : m)),
    });
    expect(input()).toBeDisabled();
    expect(screen.getByText(/gemma4:e4b はまだダウンロードされていません/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));
    expect(props.onRequestDownload).toHaveBeenCalledWith("gemma4:e4b");
  });

  it("送信前のエラーはコードではなく日本語の説明で出す", async () => {
    mockFetch({ "POST /api/chat": () => jsonRes({ error: "model_not_installed" }, 409) });
    setup();
    await send("q");
    expect(await screen.findByRole("alert")).toHaveTextContent("このモデルはダウンロードされていません");
    expect(screen.getByRole("alert")).not.toHaveTextContent("model_not_installed");
  });
});

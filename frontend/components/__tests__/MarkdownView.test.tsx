// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const { MarkdownView } = await import("@/components/MarkdownView");

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockResolvedValue({ diagramType: "flowchart" });
  mermaid.render.mockReset().mockResolvedValue({ svg: '<svg data-testid="diagram"><g></g></svg>' });
});

describe("MarkdownView", () => {
  it("表・チェックボックスが table / input[type=checkbox] で描画される", () => {
    const { container } = render(
      <MarkdownView text={"| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n"} streaming={false} />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it("見出し・太字・リンク・引用を整形する", () => {
    const { container } = render(
      <MarkdownView text={"# 見出し\n\n**太字** [リンク](https://example.com)\n\n> 引用\n"} streaming={false} />,
    );
    expect(container.querySelector("h1")).toHaveTextContent("見出し");
    expect(container.querySelector("strong")).toHaveTextContent("太字");
    expect(container.querySelector("a")).toHaveAttribute("href", "https://example.com");
    expect(container.querySelector("blockquote")).toHaveTextContent("引用");
  });

  it("<script> を含む応答で script 要素が生成されない", () => {
    const { container } = render(
      <MarkdownView text={'こんにちは<script>window.__x = 1</script><img src=x onerror="alert(1)">'} streaming={false} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("Markdown の画像は読み込まず、別タブで開くリンクとして出す（会話の内容が外部に送られないように）", () => {
    const { container } = render(
      <MarkdownView text={"![猫の写真](https://tracker.example/p.png?q=secret)"} streaming={false} />,
    );
    expect(container.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: /猫の写真/ });
    expect(link).toHaveAttribute("href", "https://tracker.example/p.png?q=secret");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("コードブロックは言語ごとに色分けし、コピーボタンを付ける", () => {
    const { container } = render(<MarkdownView text={"```js\nconst a = 1;\n```\n"} streaming={false} />);
    expect(container.querySelector("code.hljs, code .hljs-keyword")).not.toBeNull();
    expect(screen.getByRole("button", { name: "コピー" })).toBeInTheDocument();
  });

  it("閉じた mermaid は図として描画する", async () => {
    render(<MarkdownView text={"```mermaid\ngraph TD; A-->B\n```\n"} streaming={false} />);
    await waitFor(() => expect(screen.getByTestId("diagram")).toBeInTheDocument());
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), "graph TD; A-->B");
  });

  it("ストリーミング中の未完 mermaid は pre/code で表示", () => {
    const { container } = render(<MarkdownView text={"図です\n```mermaid\ngraph TD; A-->"} streaming={true} />);
    expect(container.querySelector("pre code")).toHaveTextContent("graph TD; A-->");
    expect(mermaid.parse).not.toHaveBeenCalled();
  });

  it("ストリーミング中でも閉じた mermaid は図にする", async () => {
    render(<MarkdownView text={"```mermaid\ngraph TD; A-->B\n```\n\n続きの文"} streaming={true} />);
    await waitFor(() => expect(screen.getByTestId("diagram")).toBeInTheDocument());
  });

  it("mermaid.parse が例外でもコードとして表示し、例外を投げない", async () => {
    mermaid.parse.mockRejectedValue(new Error("Parse error on line 1"));
    const { container } = render(<MarkdownView text={"```mermaid\ngraph ???\n```\n"} streaming={false} />);
    await waitFor(() => expect(mermaid.parse).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("pre code")).toHaveTextContent("graph ???"));
    expect(screen.queryByTestId("diagram")).toBeNull();
  });

  it("同じ本文で描き直しても、図を作り直さない（ストリーミング中のちらつき防止）", async () => {
    const text = "```mermaid\ngraph TD; A-->B\n```\n\n続き";
    const { rerender } = render(<MarkdownView text={text} streaming={true} />);
    await waitFor(() => expect(screen.getByTestId("diagram")).toBeInTheDocument());
    rerender(<MarkdownView text={text + "の文"} streaming={true} />);
    rerender(<MarkdownView text={text + "の文章"} streaming={true} />);
    expect(screen.getByTestId("diagram")).toBeInTheDocument();
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });
});

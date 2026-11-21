// @vitest-environment jsdom
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Composer } from "@/components/Composer";

beforeAll(() => {
  // jsdom には無い
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (name = "a.png", size = 100) => {
  const bytes = new Uint8Array(size);
  bytes.set(PNG);
  return new File([bytes], name, { type: "image/png" });
};

function setup(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    disabled: false,
    canAttach: true,
    streaming: false,
    onSend: vi.fn(async () => true),
    onStop: vi.fn(),
    ...over,
  };
  render(<Composer {...props} />);
  return props;
}

const input = () => screen.getByRole("textbox");
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

describe("Composer", () => {
  it("入力して送信すると onSend を呼び、入力欄を空にする", async () => {
    const p = setup();
    await userEvent.type(input(), "こんにちは");
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(p.onSend).toHaveBeenCalledWith("こんにちは", []);
    expect(input()).toHaveValue("");
  });

  it("Enter で送信、Shift+Enter は改行", async () => {
    const p = setup();
    await userEvent.type(input(), "1行目{Shift>}{Enter}{/Shift}2行目{Enter}");
    expect(p.onSend).toHaveBeenCalledWith("1行目\n2行目", []);
  });

  it("変換中（IME）の Enter では送信しない", () => {
    const p = setup();
    fireEvent.change(input(), { target: { value: "にほんご" } });
    const ev = createEvent.keyDown(input(), { key: "Enter" });
    Object.defineProperty(ev, "isComposing", { value: true });
    fireEvent(input(), ev);
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("送れなかったら（onSend が false）入力を残す", async () => {
    setup({ onSend: vi.fn(async () => false) });
    await userEvent.type(input(), "残す");
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(input()).toHaveValue("残す");
  });

  it("空のままでは送信できない", () => {
    setup();
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });

  it("応答中は送信ボタンの代わりに [停止] を出す", async () => {
    const p = setup({ streaming: true });
    expect(screen.queryByRole("button", { name: "送信" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(p.onStop).toHaveBeenCalled();
  });

  it("vision 非対応モデルでは 📎 が disabled", () => {
    setup({ canAttach: false });
    expect(screen.getByRole("button", { name: "画像を添付" })).toBeDisabled();
  });

  it("📎 で選んだ画像をサムネイルで出し、✕ で外せる。画像だけでも送れる", async () => {
    const p = setup();
    await userEvent.upload(fileInput(), png("photo1.png"));
    expect(screen.getByRole("img", { name: "photo1.png" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "photo1.png を外す" }));
    expect(screen.queryByRole("img", { name: "photo1.png" })).toBeNull();
    await userEvent.upload(fileInput(), png("photo2.png"));
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(p.onSend).toHaveBeenCalledWith("", [expect.objectContaining({ name: "photo2.png" })]);
    expect(screen.queryByRole("img", { name: "photo2.png" })).toBeNull();
  });

  it("送信できたら、入力欄のプレビューの URL を解放する（送信後の表示には別の URL を使う）", async () => {
    vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:tray-1");
    setup();
    await userEvent.upload(fileInput(), png("a.png"));
    vi.mocked(URL.revokeObjectURL).mockClear();
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tray-1");
  });

  it("画像に対応していないモデルに切り替えたら、添付を外して理由を表示する", async () => {
    const props = { disabled: false, canAttach: true, streaming: false, onSend: vi.fn(async () => true), onStop: vi.fn() };
    const { rerender } = render(<Composer {...props} />);
    await userEvent.upload(fileInput(), png("a.png"));
    rerender(<Composer {...props} canAttach={false} />);
    expect(screen.queryByRole("img", { name: "a.png" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("画像に対応していない");
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  });

  it("PNG/JPEG/WebP 以外・10MB 超・5 枚目は追加されずエラー文言を表示", async () => {
    setup();
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], "a.gif", { type: "image/gif" });
    // accept 属性を無視して渡す（ドラッグ＆ドロップと同じ経路のチェックを確かめる）
    await userEvent.upload(fileInput(), gif, { applyAccept: false });
    expect(screen.getByRole("alert")).toHaveTextContent("PNG・JPEG・WebP");
    expect(screen.queryAllByRole("img")).toHaveLength(0);

    await userEvent.upload(fileInput(), png("big.png", 10 * 1024 * 1024 + 1));
    expect(screen.getByRole("alert")).toHaveTextContent("10MB");
    expect(screen.queryAllByRole("img")).toHaveLength(0);

    await userEvent.upload(fileInput(), [png("1.png"), png("2.png"), png("3.png"), png("4.png"), png("5.png")]);
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByRole("alert")).toHaveTextContent("4 枚");
  });

  it("ドラッグ＆ドロップで添付できる", () => {
    setup();
    fireEvent.drop(screen.getByRole("group"), { dataTransfer: { files: [png("dropped.png")], types: ["Files"] } });
    expect(screen.getByRole("img", { name: "dropped.png" })).toBeInTheDocument();
  });

  it("クリップボードからの貼り付けで添付できる", () => {
    setup();
    const file = png("pasted.png");
    fireEvent.paste(input(), {
      clipboardData: { files: [file], items: [{ kind: "file", getAsFile: () => file }], types: ["Files"] },
    });
    expect(screen.getByRole("img", { name: "pasted.png" })).toBeInTheDocument();
  });

  it("vision 非対応ならドロップ・貼り付けでも添付しない", () => {
    setup({ canAttach: false });
    fireEvent.drop(screen.getByRole("group"), { dataTransfer: { files: [png("dropped.png")], types: ["Files"] } });
    expect(screen.queryByRole("img", { name: "dropped.png" })).toBeNull();
  });

  it("disabled のときは入力も送信もできない", () => {
    setup({ disabled: true });
    expect(input()).toBeDisabled();
    expect(screen.getByRole("button", { name: "画像を添付" })).toBeDisabled();
  });
});

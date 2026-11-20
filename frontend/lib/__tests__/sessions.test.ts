import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  prune,
  saveImage,
  saveSession,
  validateImage,
} from "@/lib/sessions";
import type { Session } from "@/lib/types";

let dir: string;
const sessionsDir = () => path.join(dir, "sessions");

// 先頭バイトが正しい画像
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

function makeSession(id: string, updatedAt: string): Session {
  return { id, title: id, model: "gemma4:e4b", createdAt: updatedAt, updatedAt, messages: [] };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sessions-"));
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("SESSION_LIMIT", "10");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("createSession", () => {
  it("ID の形式は YYYYMMDD-HHmmss-6 桁、ファイルに保存される", async () => {
    const s = await createSession("gemma4:e4b", "こんにちは");
    expect(s.id).toMatch(/^\d{8}-\d{6}-[a-z0-9]{6}$/);
    expect(s).toMatchObject({ model: "gemma4:e4b", title: "こんにちは", messages: [] });
    const saved = JSON.parse(readFileSync(path.join(sessionsDir(), s.id, "session.json"), "utf8"));
    expect(saved).toEqual(s);
  });

  it("title は先頭 20 文字＋…", async () => {
    const s = await createSession("m:1", "あいうえおかきくけこさしすせそたちつてとなにぬ");
    expect(s.title).toBe("あいうえおかきくけこさしすせそたちつてと…");
  });

  it("title は空白を詰め、20 文字ちょうどなら…を付けない", async () => {
    expect((await createSession("m:1", "  Docker  の\n\n質問  ")).title).toBe("Docker の 質問");
    expect((await createSession("m:1", "12345678901234567890")).title).toBe("12345678901234567890");
  });

  it("絵文字（サロゲートペア）を途中で切らない", async () => {
    const s = await createSession("m:1", "😀".repeat(25));
    expect(s.title).toBe("😀".repeat(20) + "…");
  });

  it("本文が空で画像だけのセッションは title が『画像の質問』", async () => {
    expect((await createSession("m:1", "   ")).title).toBe("画像の質問");
  });
});

describe("saveSession / getSession / listSessions", () => {
  it("保存したセッションを読み戻せる", async () => {
    const s = makeSession("20261120-100000-aaaaaa", "2026-11-20T10:00:00.000Z");
    s.messages.push({ role: "user", content: "hi", createdAt: s.createdAt });
    await saveSession(s);
    await expect(getSession(s.id)).resolves.toEqual(s);
    // 一時ファイルが残らない
    expect(readdirSync(path.join(sessionsDir(), s.id))).toEqual(["session.json"]);
  });

  it("無いセッション・形式違反の ID は null", async () => {
    await expect(getSession("20261120-100000-zzzzzz")).resolves.toBeNull();
    await expect(getSession("../etc")).resolves.toBeNull();
  });

  it("listSessions は updatedAt の新しい順に概要を返す", async () => {
    await saveSession(makeSession("20261120-100000-aaaaaa", "2026-11-20T10:00:00.000Z"));
    await saveSession(makeSession("20261120-110000-bbbbbb", "2026-11-20T12:00:00.000Z"));
    await saveSession(makeSession("20261120-120000-cccccc", "2026-11-20T11:00:00.000Z"));
    const list = await listSessions();
    expect(list.map((s) => s.id)).toEqual(["20261120-110000-bbbbbb", "20261120-120000-cccccc", "20261120-100000-aaaaaa"]);
    expect(list[0]).toEqual({
      id: "20261120-110000-bbbbbb",
      title: "20261120-110000-bbbbbb",
      model: "gemma4:e4b",
      updatedAt: "2026-11-20T12:00:00.000Z",
    });
  });

  it("壊れた session.json は listSessions で無視する", async () => {
    await saveSession(makeSession("20261120-100000-aaaaaa", "2026-11-20T10:00:00.000Z"));
    mkdirSync(path.join(sessionsDir(), "20261120-100001-broken"), { recursive: true });
    writeFileSync(path.join(sessionsDir(), "20261120-100001-broken", "session.json"), "{oops");
    mkdirSync(path.join(sessionsDir(), "not-a-session"), { recursive: true });
    expect((await listSessions()).map((s) => s.id)).toEqual(["20261120-100000-aaaaaa"]);
  });

  it("フォルダが無ければ空", async () => {
    await expect(listSessions()).resolves.toEqual([]);
  });
});

describe("prune", () => {
  async function seed(n: number) {
    for (let i = 0; i < n; i++) {
      const hh = String(i).padStart(2, "0");
      await saveSession(makeSession(`20261120-${hh}0000-aaaa${hh}`, `2026-11-20T${hh}:00:00.000Z`));
    }
  }

  it("11 件目の保存で最も古い updatedAt のセッションが消える", async () => {
    await seed(10);
    await saveSession(makeSession("20261121-000000-newone", "2026-11-21T00:00:00.000Z"));
    const ids = (await listSessions()).map((s) => s.id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain("20261120-000000-aaaa00");
    expect(ids).toContain("20261121-000000-newone");
    expect(existsSync(path.join(sessionsDir(), "20261120-000000-aaaa00"))).toBe(false);
  });

  // saveSession を通さずに書く（途中で prune させない）
  function seedFiles(n: number) {
    for (let i = 0; i < n; i++) {
      const hh = String(i).padStart(2, "0");
      const s = makeSession(`20261120-${hh}0000-aaaa${hh}`, `2026-11-20T${hh}:00:00.000Z`);
      mkdirSync(path.join(sessionsDir(), s.id), { recursive: true });
      writeFileSync(path.join(sessionsDir(), s.id, "session.json"), JSON.stringify(s));
    }
  }

  it("keepId のセッションは古くても消えない", async () => {
    seedFiles(11);
    await prune("20261120-000000-aaaa00");
    const ids = (await listSessions()).map((s) => s.id);
    expect(ids).toHaveLength(10);
    expect(ids).toContain("20261120-000000-aaaa00");
    expect(ids).not.toContain("20261120-010000-aaaa01");
  });

  it("SESSION_LIMIT に従う", async () => {
    vi.stubEnv("SESSION_LIMIT", "3");
    await seed(5);
    expect((await listSessions()).map((s) => s.id)).toEqual([
      "20261120-040000-aaaa04",
      "20261120-030000-aaaa03",
      "20261120-020000-aaaa02",
    ]);
  });
});

describe("deleteSession", () => {
  it("deleteSession は画像ごとフォルダを消す", async () => {
    const s = await createSession("m:1", "x");
    await saveImage(s.id, { name: "a.png", type: "image/png", bytes: PNG });
    await deleteSession(s.id);
    expect(existsSync(path.join(sessionsDir(), s.id))).toBe(false);
  });

  it("形式違反の ID では何も消さない", async () => {
    mkdirSync(path.join(dir, "keep"), { recursive: true });
    await expect(deleteSession("../keep")).rejects.toThrow();
    expect(existsSync(path.join(dir, "keep"))).toBe(true);
  });
});

describe("saveImage", () => {
  it("img-<n>.<ext> の名前で連番に保存する", async () => {
    const s = await createSession("m:1", "x");
    expect(await saveImage(s.id, { name: "a.png", type: "image/png", bytes: PNG })).toBe("img-1.png");
    expect(await saveImage(s.id, { name: "b.jpeg", type: "image/jpeg", bytes: JPEG })).toBe("img-2.jpg");
    expect(await saveImage(s.id, { name: "c.webp", type: "image/webp", bytes: WEBP })).toBe("img-3.webp");
    expect(readFileSync(path.join(sessionsDir(), s.id, "img-1.png"))).toEqual(Buffer.from(PNG));
  });
});

describe("validateImage", () => {
  it("PNG / JPEG / WebP を通す", () => {
    expect(validateImage({ type: "image/png", bytes: PNG })).toEqual({ ok: true });
    expect(validateImage({ type: "image/jpeg", bytes: JPEG })).toEqual({ ok: true });
    expect(validateImage({ type: "image/webp", bytes: WEBP })).toEqual({ ok: true });
  });

  it("validateImage: gif は type、10MB+1 byte は size", () => {
    expect(validateImage({ type: "image/gif", bytes: new Uint8Array([0x47, 0x49, 0x46]) })).toEqual({
      ok: false,
      reason: "type",
    });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(validateImage({ type: "image/png", bytes: big })).toEqual({ ok: false, reason: "size" });
    const exact = new Uint8Array(10 * 1024 * 1024);
    exact.set(PNG);
    expect(validateImage({ type: "image/png", bytes: exact })).toEqual({ ok: true });
  });

  it("中身が宣言した形式と違えば type", () => {
    expect(validateImage({ type: "image/png", bytes: new TextEncoder().encode("<html>") })).toEqual({
      ok: false,
      reason: "type",
    });
  });
});

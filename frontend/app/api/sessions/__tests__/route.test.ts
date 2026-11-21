import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getImage } from "@/app/api/sessions/[id]/images/[file]/route";
import { DELETE as deleteOne, GET as getOne } from "@/app/api/sessions/[id]/route";
import { GET as list } from "@/app/api/sessions/route";
import { createSession, getSession, saveImage, saveSession } from "@/lib/sessions";

let dir: string;
let busy = false;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);

// Next.js は params をデコード済みで渡す
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const req = (method = "GET") => new Request("http://localhost/api/sessions/x", { method });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sessions-route-"));
  vi.stubEnv("DATA_DIR", dir);
  busy = false;
  globalThis.__downloadManager = {
    state: () => ({ status: "idle" }),
    isBusy: () => busy,
    start: vi.fn(),
    cancel: vi.fn(),
    fail: vi.fn(),
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  globalThis.__downloadManager = undefined;
});

describe("GET /api/sessions", () => {
  it("概要の一覧を返す", async () => {
    const s = await createSession("gemma4:e4b", "質問");
    const res = await list();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([{ id: s.id, title: "質問", model: "gemma4:e4b", updatedAt: s.updatedAt }]);
  });
});

describe("/api/sessions/:id", () => {
  it("GET はセッションを返し、無ければ 404", async () => {
    const s = await createSession("gemma4:e4b", "質問");
    const res = await getOne(req(), ctx({ id: s.id }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ...s, contextWarn: false });
    expect((await getOne(req(), ctx({ id: "20200101-000000-zzzzzz" }))).status).toBe(404);
  });

  it("GET は会話が長ければ contextWarn:true を付ける（開き直しても長さの警告を出すため）", async () => {
    vi.stubEnv("NUM_CTX", "8192");
    vi.stubEnv("CONTEXT_WARN_RATIO", "0.8");
    const s = await createSession("gemma4:e4b", "質問");
    await saveSession({ ...s, lastContextTokens: 7000 });
    const res = await getOne(req(), ctx({ id: s.id }));
    await expect(res.json()).resolves.toMatchObject({ id: s.id, contextWarn: true });
  });

  it("セッション ID が形式違反（例 ../etc）なら GET/DELETE とも 400", async () => {
    expect((await getOne(req(), ctx({ id: "../etc" }))).status).toBe(400);
    expect((await deleteOne(req("DELETE"), ctx({ id: "../etc" }))).status).toBe(400);
  });

  it("DELETE で消え、204", async () => {
    const s = await createSession("gemma4:e4b", "質問");
    const res = await deleteOne(req("DELETE"), ctx({ id: s.id }));
    expect(res.status).toBe(204);
    await expect(getSession(s.id)).resolves.toBeNull();
  });

  it("ダウンロード中の DELETE は 409", async () => {
    const s = await createSession("gemma4:e4b", "質問");
    busy = true;
    const res = await deleteOne(req("DELETE"), ctx({ id: s.id }));
    expect(res.status).toBe(409);
    await expect(getSession(s.id)).resolves.not.toBeNull();
  });
});

describe("GET /api/sessions/:id/images/:file", () => {
  it("保存した画像を content-type 付きで返す", async () => {
    const s = await createSession("gemma4:e4b", "");
    const file = await saveImage(s.id, { name: "a.png", type: "image/png", bytes: PNG });
    await saveSession({ ...s, messages: [{ role: "user", content: "", images: [file], createdAt: s.createdAt }] });
    const res = await getImage(req(), ctx({ id: s.id, file }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("images の file に ../ を含むと 400", async () => {
    const s = await createSession("gemma4:e4b", "");
    expect((await getImage(req(), ctx({ id: s.id, file: "../session.json" }))).status).toBe(400);
    expect((await getImage(req(), ctx({ id: s.id, file: "session.json" }))).status).toBe(400);
    expect((await getImage(req(), ctx({ id: "../x", file: "img-1.png" }))).status).toBe(400);
  });

  it("無い画像は 404", async () => {
    const s = await createSession("gemma4:e4b", "");
    expect((await getImage(req(), ctx({ id: s.id, file: "img-9.png" }))).status).toBe(404);
  });
});

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());

function req(method: string, headers: Record<string, string>) {
  return new NextRequest("http://localhost:3000/api/sessions/x", { method, headers });
}
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy（localhost 限定の意図を守る）", () => {
  it("localhost・127.0.0.1 への通常のリクエストは通す", () => {
    expect(passed(proxy(req("GET", { host: "localhost:3000" })))).toBe(true);
    expect(passed(proxy(req("GET", { host: "127.0.0.1:3000" })))).toBe(true);
    expect(passed(proxy(req("DELETE", { host: "localhost:3000", origin: "http://localhost:3000" })))).toBe(true);
  });

  it("Origin の無い変更系（curl など）は通す", () => {
    expect(passed(proxy(req("POST", { host: "localhost:3000" })))).toBe(true);
  });

  it("ほかのサイトからの変更系リクエスト（CSRF）は 403", () => {
    const res = proxy(req("POST", { host: "localhost:3000", origin: "https://evil.example.com" }));
    expect(res.status).toBe(403);
    expect(proxy(req("DELETE", { host: "localhost:3000", origin: "null" })).status).toBe(403);
  });

  it("知らないドメイン名の Host（DNS リバインディング）は 403", () => {
    expect(proxy(req("GET", { host: "evil.example.com:3000" })).status).toBe(403);
  });

  it("IP アドレス直指定は通す（将来の LAN からのアクセスのため）", () => {
    expect(passed(proxy(req("GET", { host: "192.168.1.10:3000" })))).toBe(true);
    expect(passed(proxy(req("GET", { host: "[::1]:3000" })))).toBe(true);
  });

  it("ALLOWED_HOSTS に書いたドメイン名は通す", () => {
    vi.stubEnv("ALLOWED_HOSTS", "chat.example.com, other.example");
    expect(passed(proxy(req("GET", { host: "chat.example.com" })))).toBe(true);
    expect(passed(proxy(req("POST", { host: "chat.example.com", origin: "https://chat.example.com" })))).toBe(true);
  });
});

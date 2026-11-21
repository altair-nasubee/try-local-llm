// 画面テスト用の偽 fetch。"METHOD /path" ごとに応答（またはその関数）を決める
import { vi } from "vitest";

export type Handler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

export const jsonRes = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export function mockFetch(routes: Record<string, Handler | unknown>) {
  const calls: { method: string; path: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    calls.push({ method, path, init });
    const route = routes[`${method} ${path}`];
    if (route === undefined) return jsonRes({ error: "not_mocked" }, 500);
    return typeof route === "function" ? (route as Handler)(init, url) : jsonRes(route);
  });
  vi.stubGlobal("fetch", fn);
  return { fetch: fn, calls, routes };
}

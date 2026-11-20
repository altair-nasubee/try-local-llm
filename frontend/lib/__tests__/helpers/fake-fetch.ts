// テスト用の偽 fetch。"METHOD /path" ごとに応答を決める
import { vi } from "vitest";

export type FakeRoute = (req: { body: unknown; url: URL; init?: RequestInit }) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function fakeFetch(routes: Record<string, FakeRoute>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) throw new TypeError(`fetch failed: ${method} ${url.pathname}`);
    return route({ body, url, init });
  });
  return { fetch: fn, calls };
}

// 接続できない Ollama
export function downFetch() {
  return vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
}

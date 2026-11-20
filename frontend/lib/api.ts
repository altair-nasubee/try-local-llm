// Route Handler 共通の応答

export const NO_STORE = { "cache-control": "no-store" };

// エラー応答：{ error: <コード>, message?: <画面に出せる説明> }
export function apiError(status: number, error: string, message?: string): Response {
  return Response.json(message === undefined ? { error } : { error, message }, { status, headers: NO_STORE });
}

export function ok(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// 本文の JSON を読む。壊れていれば undefined
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}


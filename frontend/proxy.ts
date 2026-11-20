import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// すべてのリクエストが最初に通る場所。画面からの操作はすべて /api/* を通るため、ここ 1 か所で守れる。
// 今回は認証をしない（spec 8.1）。将来、他端末からのアクセスや外部公開をするときは、認証はここに追加する。
//
// その代わり「この PC からだけ使う」意図を守るため、次の 2 つを断る：
// - ほかのサイトを開いたブラウザから送られる変更系リクエスト（CSRF。Origin が Host と違う）
// - 知らないドメイン名の Host（DNS リバインディングで localhost の API を読まれるのを防ぐ）
//   IP アドレス直指定は通す（将来の LAN からのアクセスのため）。ドメイン名で使うときは ALLOWED_HOSTS に書く

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostname(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

function hostAllowed(host: string): boolean {
  const name = hostname(host).toLowerCase();
  if (LOOPBACK.has(name)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.startsWith("[")) return true;
  const allowed = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(name);
}

function forbidden(): NextResponse {
  return new NextResponse("Forbidden", { status: 403 });
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!hostAllowed(host)) return forbidden();

  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== null) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        // "null" など
      }
      if (originHost !== host) return forbidden();
    }
  }
  return NextResponse.next();
}

export const config = {
  // 静的ファイルは対象外にする
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

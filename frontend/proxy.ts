import { NextResponse } from "next/server";

// 認証の差し込み口。今回は何もせず素通しする。
// 将来、他端末からのアクセスや外部公開をするときは、認証はここに追加する
// （画面からの操作はすべて /api/* を通るため、ここ 1 か所で守れる）
// 認証を足すときは引数 request: NextRequest を受け取り、Cookie やヘッダーを確かめる
export function proxy() {
  return NextResponse.next();
}

export const config = {
  // 静的ファイルは対象外にする
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

#!/usr/bin/env bash
# アプリを起動してブラウザを開く。すでに起動していればブラウザだけ開く
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$LLM_APP_ROOT"

# appendWindowsPath=false のため Windows のコマンドは絶対パスで呼ぶ（テストでは差し替える）
WIN_CMD="${WIN_CMD:-/mnt/c/Windows/System32/cmd.exe}"
WAIT_SEC=120

require_docker

if [ ! -f .env ]; then
  cp .env.example .env
  info ".env.example から .env を作りました"
fi

# .env は source しない（中身をシェルとして実行しないため）
PORT="$(grep -E '^PORT=' .env | tail -n 1 | cut -d= -f2- | tr -d '[:space:]"'"'" || true)"
PORT="${PORT:-3000}"
URL="http://localhost:$PORT"

open_browser() {
  if [ -x "$WIN_CMD" ] && "$WIN_CMD" /c start "$URL" >/dev/null 2>&1; then
    ok "ブラウザで $URL を開きました"
  else
    info "ブラウザで $URL を開いてください"
  fi
}

if docker compose ps --status running --services 2>/dev/null | grep -qx frontend; then
  ok "すでに起動しています"
  open_browser
  exit 0
fi

if ss -ltn 2>/dev/null | awk 'NR > 1 { print $4 }' | grep -Eq "[:.]$PORT\$"; then
  fail "ポート $PORT が使用中です" ".env の PORT を別の番号に変えるか、ポート $PORT を使っているアプリを終了してください"
fi

require_gpu_in_docker

# data/ は up.sh が作る（Docker に root 所有で作らせない）
"$LLM_SCRIPTS_DIR/up.sh"

info "画面の起動を待っています（最大 ${WAIT_SEC} 秒）"
elapsed=0
while [ "$elapsed" -le "$WAIT_SEC" ]; do
  # 起動途中は接続エラーになるのが普通なので、curl のエラーは出さない
  if curl -fs -o /dev/null --max-time 2 "$URL/api/health" 2>/dev/null; then
    [ "$elapsed" -gt 0 ] && printf '\n'
    ok "起動しました（${elapsed} 秒）"
    open_browser
    exit 0
  fi
  printf '\r  %d 秒経過…' "$elapsed"
  sleep 2
  elapsed=$((elapsed + 2))
done
printf '\n'
fail "${WAIT_SEC} 秒たっても画面が応答しません" "docker compose logs frontend でエラーを確認してください"

#!/usr/bin/env bash
# アプリを止める。モデルと会話の履歴は消さない（データを消すのは reset.sh だけ）
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$LLM_APP_ROOT"

# 誤操作でデータを消さないよう、引数（-v など）は受け付けない
if [ "$#" -gt 0 ]; then
  fail "stop.sh は引数を受け付けません" "データを消したいときは scripts/reset.sh を使ってください"
fi

# LocalLLM-start.bat が起動した常駐プロセス（WSL を動かし続けるもの）を終わらせる。
# Docker が使えずに止まった場合でも WSL が止まれるよう、最初に行う
pkill -f '^local-llm-chat-keepalive' || true

require_docker
docker compose stop
docker compose down
ok "停止しました（モデルと会話の履歴は残っています）"

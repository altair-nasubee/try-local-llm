#!/usr/bin/env bash
# E2E テスト：偽 Ollama と frontend を起動して Playwright を流し、最後に片付ける。
# 本番のデータ・volume・ポートには触れない（プロジェクト名 local-llm-chat-e2e・ポート 3100）。
#
#   scripts/e2e.sh [playwright の引数…]          Docker（compose.e2e.yaml）で動かす
#   scripts/e2e.sh --local [playwright の引数…]  Docker を使わず、偽 Ollama と next start をこの PC で直接動かす
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$LLM_APP_ROOT"

E2E_PROJECT="${LLM_COMPOSE_PROJECT}-e2e"
APP_URL="http://localhost:3100"

wait_for_health() {
  local _
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null --max-time 2 "$APP_URL/api/health"; then
      return 0
    fi
    sleep 2
  done
  fail "E2E 用の画面が起動しません" "ログを確認してください"
}

if [ "${1:-}" = "--local" ]; then
  shift
  tmp="$(mktemp -d)"
  pids=()
  # setsid で起動したプロセスグループごと終わらせる（npx の先の next-server まで止めるため）
  # shellcheck disable=SC2317,SC2329 # trap から呼ぶ（版によって番号が違う）
  cleanup_local() {
    local pid
    for pid in "${pids[@]}"; do kill -- "-$pid" 2>/dev/null || true; done
    rm -rf "$tmp"
  }
  trap cleanup_local EXIT
  info "偽 Ollama（:11500）と frontend（:3100）をこの PC で起動します"
  if ss -ltn 2>/dev/null | awk 'NR > 1 { print $4 }' | grep -Eq '[:.](3100|11500)$'; then
    fail "ポート 3100 か 11500 が使用中です" "前回の E2E のプロセスが残っていないか確認してください（ss -ltnp）"
  fi
  # 操作用の /__mock/* を LAN に出さないよう、127.0.0.1 だけで待ち受ける
  PORT=11500 HOST=127.0.0.1 setsid node e2e/mock-ollama/server.mjs >"$tmp/mock.log" 2>&1 &
  pids+=("$!")
  (cd frontend && npm run build >"$tmp/build.log" 2>&1) || fail "frontend のビルドに失敗しました" "$tmp/build.log を確認してください"
  mkdir -p "$tmp/data"
  # 中の $E2E_TMP と $LLM_APP_ROOT は子の bash で展開する
  # shellcheck disable=SC2016
  E2E_TMP="$tmp" setsid bash -c '
    cd frontend
    exec env OLLAMA_URL=http://localhost:11500 DATA_DIR="$E2E_TMP/data" MODELS_YAML_PATH="$LLM_APP_ROOT/e2e/models.e2e.yaml" \
      IDLE_TIMEOUT_SEC=3 DISCOVERY_ENABLED=false DEFAULT_MODEL=gemma4:e4b NUM_CTX=8192 CONTEXT_WARN_RATIO=0.8 \
      TIER_COMFORT_MAX_GB=7 TIER_EXCLUDE_MIN_GB=20 SESSION_LIMIT=10 \
      npx next start -p 3100
  ' >"$tmp/next.log" 2>&1 &
  pids+=("$!")
  wait_for_health
  (cd frontend && E2E_DATA_DIR="$tmp/data" npx playwright test "$@")
  exit
fi

require_docker
ensure_builder
compose() { docker compose -f compose.yaml -f compose.e2e.yaml -p "$E2E_PROJECT" "$@"; }
# 成否にかかわらず片付ける（-f を省くと e2e-data が消えない）
trap 'compose down -v >/dev/null 2>&1 || true' EXIT
compose up -d --build
wait_for_health
(cd frontend && npx playwright test "$@")

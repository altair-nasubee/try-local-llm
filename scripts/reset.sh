#!/usr/bin/env bash
# このアプリが作ったものを全部消し、初回起動前と同じ状態に戻す（spec 8.5）。
# 使い方：scripts/reset.sh [--dry-run] [--with-images]
#   --dry-run     消す対象を表示するだけ
#   --with-images Ollama の公式イメージも消す（ほかで使っている可能性があるため既定では残す）
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$LLM_APP_ROOT"

DRY_RUN=0
WITH_IMAGES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --with-images) WITH_IMAGES=1 ;;
    *) fail "知らない引数です：$arg" "使い方：scripts/reset.sh [--dry-run] [--with-images]" ;;
  esac
done

require_docker

VOLUME="${LLM_COMPOSE_PROJECT}_ollama-models"
CUDA_CACHE_VOLUME="${LLM_COMPOSE_PROJECT}_ollama-cuda-cache"
E2E_PROJECT="${LLM_COMPOSE_PROJECT}-e2e"

# "6.6GB" → バイト数
to_bytes() {
  awk -v s="$1" 'BEGIN {
    n = s + 0; u = s; sub(/^[0-9.]+/, "", u)
    m = 1
    if (u == "kB" || u == "KB") m = 1e3; else if (u == "MB") m = 1e6; else if (u == "GB") m = 1e9; else if (u == "TB") m = 1e12
    printf "%.0f", n * m
  }'
}

df_v="$(docker system df -v 2>/dev/null || true)"
size_of() { printf '%s\n' "$df_v" | awk -v v="$1" '$1 == v { print $NF; exit }'; }
volume_size="$(size_of "$VOLUME")"
cuda_cache_size="$(size_of "$CUDA_CACHE_VOLUME")"
data_bytes=0
for d in data/sessions data/cache data/tmp; do
  if [ -d "$d" ]; then
    data_bytes=$((data_bytes + $(du -sb "$d" | cut -f1)))
  fi
done
total_bytes=$((data_bytes + $(to_bytes "${volume_size:-0B}") + $(to_bytes "${cuda_cache_size:-0B}")))
ollama_image="$(docker compose config --images 2>/dev/null | grep '^ollama/ollama' | head -n 1 || true)"

echo "次のものを消します："
echo "  - コンテナ：ollama / frontend（止まらないものは強制停止）"
echo "  - ダウンロード済みモデル：volume $VOLUME（${volume_size:-なし}）"
echo "  - GPU の部品のキャッシュ：volume $CUDA_CACHE_VOLUME（${cuda_cache_size:-なし}）"
echo "  - ネットワーク・frontend のイメージ・専用ビルダー $LLM_BUILDER（ビルドキャッシュごと）"
echo "  - 会話の履歴と添付画像・モデル検索の保存結果：data/sessions・data/cache・data/tmp（$(numfmt --to=si --suffix=B "$data_bytes")）"
echo "  - E2E テストの残り（プロジェクト $E2E_PROJECT）"
if [ "$WITH_IMAGES" = 1 ] && [ -n "$ollama_image" ]; then
  echo "  - Ollama のイメージ：$ollama_image"
fi
echo "  合計：約 $(numfmt --to=si --suffix=B "$total_bytes")"
echo "消さないもの：.env・models.yaml・ソースコード・Docker 本体・ほかのプロジェクト$([ "$WITH_IMAGES" = 1 ] || echo "・Ollama のイメージ（消すときは --with-images）")"

if [ "$DRY_RUN" = 1 ]; then
  info "--dry-run のため、何も消していません"
  exit 0
fi

answer=""
read -r -p "消してよければ RESET と入力してください: " answer || true
if [ "$answer" != "RESET" ]; then
  fail "中止しました（何も消していません）" "消すときは RESET と大文字で入力してください"
fi

docker compose --project-directory "$LLM_APP_ROOT" kill || true
docker compose --project-directory "$LLM_APP_ROOT" down -v --rmi local --remove-orphans
for d in data/sessions data/cache data/tmp; do
  if [ -d "$d" ]; then
    find "$d" -mindepth 1 -delete
  fi
done
docker buildx rm -f "$LLM_BUILDER" >/dev/null 2>&1 || true
pkill -f '^local-llm-chat-keepalive' || true
# E2E 用ファイルも読ませないと、そこでだけ定義した volume が消えない
if [ -f compose.e2e.yaml ]; then
  docker compose -f compose.yaml -f compose.e2e.yaml -p "$E2E_PROJECT" down -v --rmi all --remove-orphans || true
fi
if [ "$WITH_IMAGES" = 1 ] && [ -n "$ollama_image" ]; then
  docker image rm "$ollama_image" || true
fi

ok "消しました：コンテナ・ダウンロード済みモデル・イメージ・ビルドキャッシュ・会話の履歴・検索結果"
info "次は scripts/start.sh（または LocalLLM-start.bat）で、初回と同じように起動できます"

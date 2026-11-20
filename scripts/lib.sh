#!/usr/bin/env bash
# 各スクリプトの共通処理。先頭で次のように読み込む：
#   # shellcheck source=lib.sh
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#
# LLM_APP_ROOT：アプリのルート（既定はこのリポジトリ）。テストでは一時ディレクトリを指定する
# LLM_SCRIPTS_DIR：このファイルのあるフォルダ。ほかのスクリプトは "$LLM_SCRIPTS_DIR/up.sh" のように呼ぶ

LLM_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LLM_APP_ROOT="${LLM_APP_ROOT:-$(cd "$LLM_SCRIPTS_DIR/.." && pwd)}"
export LLM_APP_ROOT LLM_SCRIPTS_DIR

# compose のプロジェクト名と専用ビルダー名（reset.sh がこの名前で対象を絞る）
LLM_COMPOSE_PROJECT="local-llm-chat"
LLM_BUILDER="local-llm-chat"

info() { printf '• %s\n' "$*"; }
ok() { printf '✔ %s\n' "$*"; }

# fail <原因> <対処>：2 行を出して終了する
fail() {
  printf '✖ %s\n' "$1" >&2
  if [ -n "${2:-}" ]; then
    printf '→ %s\n' "$2" >&2
  fi
  exit 1
}

# Docker が使える状態かを確かめる。デーモンが止まっていれば、パスワードを求めずに起動を試す
require_docker() {
  command -v docker >/dev/null 2>&1 ||
    fail "Docker が見つかりません" "sudo bash scripts/setup.sh を実行してください"

  local out
  if out="$(docker info 2>&1)"; then
    return 0
  fi
  if printf '%s' "$out" | grep -qi 'permission denied'; then
    fail "Docker を使う権限がありません" "PowerShell で wsl --shutdown を実行し、WSL を開き直してください"
  fi

  sudo -n systemctl start docker >/dev/null 2>&1 || true
  docker info >/dev/null 2>&1 ||
    fail "Docker が停止しています" "sudo systemctl start docker を実行してください"
}

# コンテナから GPU が見えるかを確かめる
require_gpu_in_docker() {
  docker run --rm --gpus all ubuntu nvidia-smi -L >/dev/null 2>&1 ||
    fail "コンテナから GPU が見えません" "sudo bash scripts/setup.sh を実行して NVIDIA Container Toolkit を導入してください"
}

# このアプリ専用の buildx ビルダーを用意する。
# 専用にするのは、reset.sh が docker buildx rm でこのアプリのビルドキャッシュだけを消せるようにするため
ensure_builder() {
  if ! docker buildx inspect "$LLM_BUILDER" >/dev/null 2>&1; then
    docker buildx create --name "$LLM_BUILDER" --driver docker-container >/dev/null ||
      fail "ビルダー $LLM_BUILDER を作れませんでした" "docker buildx version で buildx が入っているか確認してください"
  fi
  export BUILDX_BUILDER="$LLM_BUILDER"
}

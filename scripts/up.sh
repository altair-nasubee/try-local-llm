#!/usr/bin/env bash
# 専用ビルダーでビルドして、コンテナを起動する（開発・start.sh 共通）
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$LLM_APP_ROOT"

require_docker

if [ ! -f .env ]; then
  cp .env.example .env
  info ".env.example から .env を作りました"
fi

ensure_builder
# Docker が root 所有で作らないよう、先に作っておく
mkdir -p data
docker compose up -d --build

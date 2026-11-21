#!/usr/bin/env bash
# スクリプトのテスト：shellcheck → bats
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

command -v shellcheck >/dev/null 2>&1 || {
  echo "✖ shellcheck が見つかりません" >&2
  echo "→ sudo apt install -y shellcheck を実行してください" >&2
  exit 1
}
[ -x scripts/tests/bats/bin/bats ] || {
  echo "✖ bats が見つかりません" >&2
  echo "→ git submodule update --init --recursive を実行してください" >&2
  exit 1
}

shellcheck scripts/*.sh scripts/tests/run.sh scripts/tests/stubs/*
scripts/tests/bats/bin/bats scripts/tests/*.bats

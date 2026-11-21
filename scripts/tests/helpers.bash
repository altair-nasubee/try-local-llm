# bats の共通準備。各 .bats の先頭で `load helpers` する
load "test_helper/bats-support/load"
load "test_helper/bats-assert/load"

SCRIPTS="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
REPO="$(cd "$SCRIPTS/.." && pwd)"

# 一時ディレクトリをアプリのルートにし、外部コマンドはスタブにする（本物の data/ や Docker に触れない）
setup_app_root() {
  LLM_APP_ROOT="$(mktemp -d)"
  export LLM_APP_ROOT
  cp "$REPO/.env.example" "$LLM_APP_ROOT/"
  mkdir -p "$LLM_APP_ROOT/data/sessions/x" "$LLM_APP_ROOT/data/cache"
  echo '{}' >"$LLM_APP_ROOT/data/sessions/x/session.json"
  echo '{}' >"$LLM_APP_ROOT/data/cache/discovery.json"
  touch "$LLM_APP_ROOT/data/.gitkeep"

  export DOCKER_CALLS="$LLM_APP_ROOT/docker_calls"
  export STUB_CALLS="$LLM_APP_ROOT/stub_calls"
  : >"$DOCKER_CALLS"
  : >"$STUB_CALLS"
  export PATH="$BATS_TEST_DIRNAME/stubs:$PATH"
  export WIN_CMD="$BATS_TEST_DIRNAME/stubs/cmd.exe"
  export WIN_POWERSHELL="$BATS_TEST_DIRNAME/stubs/powershell.exe"
  unset STUB_FRONTEND_RUNNING STUB_PORT_BUSY STUB_CURL_FAIL STUB_CURL_FAIL_TIMES
}

teardown_app_root() {
  rm -rf "$LLM_APP_ROOT"
}

#!/usr/bin/env bats

load helpers

setup() { setup_app_root; }
teardown() { teardown_app_root; }

@test "stop.sh は down に -v を付けない" {
  run "$SCRIPTS/stop.sh"
  assert_success
  grep -q "compose down" "$DOCKER_CALLS"
  ! grep -q -- "-v" "$DOCKER_CALLS"
}

@test "stop.sh は引数を受け付けない" {
  run "$SCRIPTS/stop.sh" -v
  assert_failure
  ! grep -q "compose" "$DOCKER_CALLS"
}

@test "stop.sh は常駐プロセスを終わらせる（見つからなくても成功）" {
  run "$SCRIPTS/stop.sh"
  assert_success
  grep -q "pkill -f ^local-llm-chat-keepalive" "$STUB_CALLS"
}

@test "stop.sh はデータを消さない" {
  run "$SCRIPTS/stop.sh"
  assert_success
  [ -f "$LLM_APP_ROOT/data/sessions/x/session.json" ]
}

@test "stop.sh は Docker が使えなくても常駐プロセスを終わらせる（WSL を止められるように）" {
  # docker の無い PATH（必要なコマンドとスタブの pkill だけ）で動かす
  local bin="$LLM_APP_ROOT/bin"
  mkdir -p "$bin"
  ln -s "$(command -v dirname)" "$bin/dirname"
  ln -s "$BATS_TEST_DIRNAME/stubs/pkill" "$bin/pkill"
  ln -s "$(command -v bash)" "$bin/bash" # スタブの #!/usr/bin/env bash 用
  run env PATH="$bin" "$(command -v bash)" "$SCRIPTS/stop.sh"
  assert_failure
  assert_output --partial "Docker が見つかりません"
  grep -q "pkill -f ^local-llm-chat-keepalive" "$STUB_CALLS"
}

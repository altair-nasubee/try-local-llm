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

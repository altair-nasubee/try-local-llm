#!/usr/bin/env bats

load helpers

setup() { setup_app_root; }
teardown() { teardown_app_root; }

@test "start.sh は起動して health を待ち、ブラウザを開く" {
  run "$SCRIPTS/start.sh"
  assert_success
  grep -q "compose up -d --build" "$DOCKER_CALLS"
  grep -q "http://localhost:3000/api/health" "$STUB_CALLS"
  grep -q "cmd.exe /c start http://localhost:3000" "$STUB_CALLS"
  [ -f "$LLM_APP_ROOT/.env" ]
}

@test "start.sh は frontend 起動済みなら up.sh を呼ばずブラウザだけ開く" {
  export STUB_FRONTEND_RUNNING=1
  run "$SCRIPTS/start.sh"
  assert_success
  ! grep -q "compose up" "$DOCKER_CALLS"
  grep -q "cmd.exe /c start http://localhost:3000" "$STUB_CALLS"
}

@test "start.sh はポート 3000 使用中なら原因と対処の 2 行を出して失敗" {
  export STUB_PORT_BUSY=1
  run "$SCRIPTS/start.sh"
  assert_failure
  assert_line --partial "✖ ポート 3000 が使用中です"
  assert_line --regexp "^→ "
  ! grep -q "compose up" "$DOCKER_CALLS"
}

@test "start.sh は .env の PORT を使う（.env を source しない）" {
  printf 'PORT=8080\nX=$(touch %s/sourced)\n' "$LLM_APP_ROOT" >"$LLM_APP_ROOT/.env"
  run "$SCRIPTS/start.sh"
  assert_success
  grep -q "cmd.exe /c start http://localhost:8080" "$STUB_CALLS"
  [ ! -e "$LLM_APP_ROOT/sourced" ]
}

@test "start.sh は既存の .env を上書きしない" {
  echo "DEFAULT_MODEL=qwen3:8b" >"$LLM_APP_ROOT/.env"
  run "$SCRIPTS/start.sh"
  assert_success
  run cat "$LLM_APP_ROOT/.env"
  assert_output "DEFAULT_MODEL=qwen3:8b"
}

@test "start.sh は data/ を自分で作る（Docker に root 所有で作らせない）" {
  rm -rf "$LLM_APP_ROOT/data"
  run "$SCRIPTS/start.sh"
  assert_success
  [ -d "$LLM_APP_ROOT/data" ]
}

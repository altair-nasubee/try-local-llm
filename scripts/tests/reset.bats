#!/usr/bin/env bats

load helpers

setup() { setup_app_root; }
teardown() { teardown_app_root; }

@test "reset.sh は RESET 以外の入力で何も消さない" {
  run bash -c "echo yes | '$SCRIPTS/reset.sh'"
  assert_failure
  [ ! -s "$DOCKER_CALLS" ] || ! grep -q "down" "$DOCKER_CALLS"
  [ -f "$LLM_APP_ROOT/data/sessions/x/session.json" ]
}

@test "reset.sh は入力が無い（EOF）ときも何も消さない" {
  run bash -c "'$SCRIPTS/reset.sh' </dev/null"
  assert_failure
  ! grep -q "down" "$DOCKER_CALLS"
}

@test "reset.sh --dry-run は消す対象を表示し docker を変更系で呼ばない" {
  run "$SCRIPTS/reset.sh" --dry-run
  assert_success
  assert_output --partial "local-llm-chat_ollama-models"
  assert_output --partial "6.6GB"
  ! grep -qE "compose .*(down|kill)|buildx rm|image rm|volume rm" "$DOCKER_CALLS"
  [ -f "$LLM_APP_ROOT/data/sessions/x/session.json" ]
}

@test "reset.sh は RESET でコンテナ・volume・ビルダー・E2E の残りを消す" {
  touch "$LLM_APP_ROOT/compose.e2e.yaml"
  run bash -c "echo RESET | '$SCRIPTS/reset.sh'"
  assert_success
  grep -q "compose --project-directory $LLM_APP_ROOT kill" "$DOCKER_CALLS"
  grep -q "compose --project-directory $LLM_APP_ROOT down -v --rmi local --remove-orphans" "$DOCKER_CALLS"
  grep -q "buildx rm -f local-llm-chat" "$DOCKER_CALLS"
  grep -q "compose -f compose.yaml -f compose.e2e.yaml -p local-llm-chat-e2e down -v --rmi all" "$DOCKER_CALLS"
  grep -q "pkill -f ^local-llm-chat-keepalive" "$STUB_CALLS"
  assert_output --partial "start"
}

@test "reset.sh は --with-images が無ければ ollama イメージを消さない" {
  run bash -c "echo RESET | '$SCRIPTS/reset.sh'"
  assert_success
  ! grep -q "image rm ollama/ollama" "$DOCKER_CALLS"
}

@test "reset.sh --with-images は compose.yaml のタグの ollama イメージを消す" {
  run bash -c "echo RESET | '$SCRIPTS/reset.sh' --with-images"
  assert_success
  grep -q "image rm ollama/ollama:0.40.16" "$DOCKER_CALLS"
}

@test "reset.sh を LLM_APP_ROOT=一時ディレクトリで実行すると、そこの data/ だけが消える" {
  run bash -c "echo RESET | '$SCRIPTS/reset.sh'"
  assert_success
  [ ! -e "$LLM_APP_ROOT/data/sessions/x" ]
  [ ! -e "$LLM_APP_ROOT/data/cache/discovery.json" ]
  [ -d "$LLM_APP_ROOT/data/sessions" ]
  [ -f "$LLM_APP_ROOT/data/.gitkeep" ]
  [ -f "$LLM_APP_ROOT/.env.example" ]
  [ -f "$REPO/data/.gitkeep" ]
}

@test "reset.sh は知らない引数を受け付けない" {
  run "$SCRIPTS/reset.sh" --force
  assert_failure
  ! grep -q "down" "$DOCKER_CALLS"
}

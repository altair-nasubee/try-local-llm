#!/usr/bin/env bats

load helpers

setup() { setup_app_root; }
teardown() { teardown_app_root; }

@test "lib.sh fail は ✖ と → の 2 行を出し exit 1" {
  run bash -c "source '$SCRIPTS/lib.sh'; fail '原因です' '対処です'; echo ここには来ない"
  assert_failure 1
  assert_line --index 0 "✖ 原因です"
  assert_line --index 1 "→ 対処です"
  refute_output --partial "ここには来ない"
}

@test "lib.sh は LLM_APP_ROOT を上書きしない（テストで一時ディレクトリを使えるように）" {
  run bash -c "source '$SCRIPTS/lib.sh'; echo \"\$LLM_APP_ROOT\""
  assert_output "$LLM_APP_ROOT"
}

@test "lib.sh は LLM_APP_ROOT が無ければリポジトリのルートを使う" {
  run env -u LLM_APP_ROOT bash -c "source '$SCRIPTS/lib.sh'; echo \"\$LLM_APP_ROOT\""
  assert_output "$REPO"
}

@test "require_docker は docker が無ければ setup.sh を案内して失敗" {
  run env PATH="/usr/bin:/bin" bash -c "source '$SCRIPTS/lib.sh'; require_docker"
  assert_failure
  assert_output --partial "Docker が見つかりません"
  assert_output --partial "setup.sh"
}

@test "ensure_builder は専用ビルダーを使う設定にする" {
  run bash -c "source '$SCRIPTS/lib.sh'; ensure_builder; echo \"\$BUILDX_BUILDER\""
  assert_success
  assert_output "local-llm-chat"
}

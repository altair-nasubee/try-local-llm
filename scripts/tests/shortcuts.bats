#!/usr/bin/env bats

load helpers

setup() {
  setup_app_root
  export STUB_DESKTOP="$LLM_APP_ROOT/Desktop"
  mkdir -p "$STUB_DESKTOP"
  export WSL_DISTRO_NAME=Ubuntu
}
teardown() { teardown_app_root; }

@test "install-windows-shortcuts.sh はデスクトップに 3 つの .bat を CRLF で作る" {
  run "$SCRIPTS/install-windows-shortcuts.sh"
  assert_success
  for name in start stop reset; do
    f="$STUB_DESKTOP/LocalLLM-$name.bat"
    [ -f "$f" ]
    grep -q "wsl.exe -d Ubuntu --cd $LLM_APP_ROOT bash scripts/$name.sh" "$f"
    # すべての行が CRLF
    [ "$(grep -c $'\r$' "$f")" -eq "$(wc -l <"$f")" ]
    # 英数字と記号だけ（文字化けしない）
    ! LC_ALL=C grep -q '[^ -~'$'\r'']' "$f"
  done
}

@test "LocalLLM-start.bat は成功したら常駐プロセスを見えないウィンドウで起動する" {
  run "$SCRIPTS/install-windows-shortcuts.sh"
  assert_success
  grep -q "Start-Process wsl.exe -WindowStyle Hidden -ArgumentList '-d','Ubuntu','--cd','$LLM_APP_ROOT','--exec','bash','scripts/keepalive.sh'" \
    "$STUB_DESKTOP/LocalLLM-start.bat"
  ! grep -q "keepalive" "$STUB_DESKTOP/LocalLLM-stop.bat"
}

@test "パスに空白があれば中止する" {
  mkdir -p "$LLM_APP_ROOT/with space"
  run env LLM_APP_ROOT="$LLM_APP_ROOT/with space" "$SCRIPTS/install-windows-shortcuts.sh"
  assert_failure
  assert_output --partial "空白"
}

@test "WSL の外では使えない" {
  run env -u WSL_DISTRO_NAME "$SCRIPTS/install-windows-shortcuts.sh"
  assert_failure
}

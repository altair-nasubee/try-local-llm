#!/usr/bin/env bash
# Windows のデスクトップに LocalLLM-start.bat / LocalLLM-stop.bat / LocalLLM-reset.bat を作る
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$LLM_APP_ROOT"

WIN_POWERSHELL="${WIN_POWERSHELL:-/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe}"

# %WSL_DISTRO_NAME% は Windows 側に無いので、生成時の値を埋め込む
DISTRO="${WSL_DISTRO_NAME:-}"
[ -n "$DISTRO" ] || fail "WSL の中で実行してください" "WSL の Ubuntu のターミナルから実行してください"
REPO="$LLM_APP_ROOT"
case "$REPO" in
  *" "*) fail "リポジトリのパスに空白が含まれています：$REPO" "空白を含まない場所にリポジトリを置いてから実行してください" ;;
esac
# .bat の文字化けを避けるため、英数字と記号だけにする
if ! printf '%s%s' "$REPO" "$DISTRO" | LC_ALL=C grep -q '^[A-Za-z0-9/._-]*$'; then
  fail "リポジトリのパスかディストリビューション名に英数字以外が含まれています" "英数字だけの場所にリポジトリを置いてから実行してください"
fi
[ -x "$WIN_POWERSHELL" ] || fail "Windows の PowerShell が見つかりません" "WSL から /mnt/c が見えるか確認してください"

# OneDrive に移したデスクトップにも対応するため、Windows に場所を聞く（日本語のユーザー名でも化けないよう UTF-8）
desktop_win="$("$WIN_POWERSHELL" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')" | tr -d '\r')"
[ -n "$desktop_win" ] || fail "デスクトップの場所が分かりません" "Windows にログインした状態で実行してください"
desktop="$(wslpath -u "$desktop_win")"
[ -d "$desktop" ] || fail "デスクトップのフォルダが見つかりません：$desktop" "Windows のデスクトップの場所を確認してください"

# CRLF で書く
write_bat() {
  local file="$1"
  shift
  printf '%s\r\n' "$@" >"$desktop/$file"
  ok "作成しました：$desktop_win\\$file"
}

WSL="wsl.exe -d $DISTRO --cd $REPO"

write_bat LocalLLM-start.bat \
  "@echo off" \
  "$WSL bash scripts/start.sh" \
  "if errorlevel 1 goto failed" \
  "rem Keep WSL running after this window is closed (stopped by LocalLLM-stop.bat)" \
  "powershell.exe -NoProfile -WindowStyle Hidden -Command \"Start-Process wsl.exe -WindowStyle Hidden -ArgumentList '-d','$DISTRO','--cd','$REPO','--exec','bash','scripts/keepalive.sh'\"" \
  "exit /b 0" \
  ":failed" \
  "pause"

write_bat LocalLLM-stop.bat \
  "@echo off" \
  "$WSL bash scripts/stop.sh" \
  "if errorlevel 1 pause"

# reset は RESET の入力が要るので、ウィンドウを残す
write_bat LocalLLM-reset.bat \
  "@echo off" \
  "$WSL bash scripts/reset.sh" \
  "pause"

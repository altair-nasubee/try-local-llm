#!/usr/bin/env bash
# WSL を動かし続けるための常駐プロセス（spec 11-17）。
# WSL は Windows 側の wsl.exe がすべて終わると、Docker が動いていても止まるため、
# LocalLLM-start.bat が見えないウィンドウでこれを起動する。stop.sh が終わらせる。
# 2 回目以降は既存があるので何もしない。
if pgrep -f '^local-llm-chat-keepalive' >/dev/null; then
  exit 0
fi
exec -a local-llm-chat-keepalive sleep infinity

# CLAUDE.md

Ollama（GPU）＋ Next.js のローカル LLM チャットアプリ。Docker Compose で `ollama` / `frontend` の 2 コンテナ構成。

## 最初に読むもの

- 要件：`docs/requirements.md`（仕様の正。迷ったらここに従う）
- 実装計画：`docs/superpowers/plans/2026-11-20-local-llm-chat.md`（タスク順・インターフェース・テスト）
- 仕様にない判断をしたら、要件定義の「11. 実装上の細かい判断」に追記する

## 守るルール

- ユーザーへの応答・コメント・ドキュメントは日本語。コード識別子は英語
- 画面の文言は `frontend/messages/ja.json` から `t(key)` で読む。コンポーネントに直書きしない
- 色は `frontend/app/globals.css` の CSS 変数経由。テーマは `"system" | "light" | "dark"`（今回は `system` 固定）
- ブラウザから Ollama を直接呼ばない。必ず `frontend/app/api/` の Route Handler を通す（将来の認証は `frontend/proxy.ts` に足す。Next.js 15 以前なら `middleware.ts`）
- Ollama のポートはホストに公開しない（E2E の偽 Ollama の操作用ポート `127.0.0.1:11500` だけは例外）。`frontend` は `${BIND_ADDRESS:-127.0.0.1}:${PORT:-3000}` で公開
- 共有型は `frontend/lib/types.ts` に集約。同じ型を別の場所で定義しない
- 応答の Markdown で HTML を描画しない（`rehype-raw` 禁止）
- API が受け取るセッション ID・画像ファイル名・モデル名は必ず形式チェックする（形式は実装計画の Global Constraints）
- TDD：失敗するテスト → 実装 → 通過、の順。タスクごとにコミット
- 画面の動作確認は偽 Ollama（`e2e/mock-ollama/`）を使う E2E で行う。実モデルの出力に依存するテストを E2E に書かない
- E2E は compose プロジェクト名 `local-llm-chat-e2e`・ポート 3100 で動かし、本番のデータ・volume・ポートに触れない
- スクリプトは `LLM_APP_ROOT` を基準に動く。スクリプトのテストでは必ず一時ディレクトリを指定する
- データを消す操作は `scripts/reset.sh`（`RESET` 入力が必要）だけ。`stop.sh` や他の処理に削除を足さない（例外：E2E が自分の一時 volume `local-llm-chat-e2e_*` を掃除する処理）

## コマンド

| 目的 | コマンド |
|---|---|
| 起動（ビルド込み・ブラウザなし） | `scripts/up.sh` |
| 起動（ブラウザも開く）／終了 | `scripts/start.sh` ／ `scripts/stop.sh` |
| 単体テスト | `cd frontend && npm test` |
| E2E（偽 Ollama・GPU 不要） | `cd frontend && npm run test:e2e`（Docker なし：`npm run test:e2e -- --local`） |
| スモーク（実 Ollama・GPU） | `cd frontend && npm run test:smoke` |
| スクリプトのテスト | `scripts/tests/run.sh` |
| ログ | `docker compose logs -f frontend` / `docker compose logs -f ollama` |
| Ollama の確認 | `docker compose exec ollama ollama list` |

- `docker compose up --build` を直接使わず `scripts/up.sh` を使う（専用の buildx ビルダー `local-llm-chat` でビルドし、`reset.sh` でキャッシュごと消せるようにするため）
- `sudo` が必要な操作（`scripts/setup.sh` など）は実行せず、ユーザーに依頼する

## フォルダ構成

- `frontend/`：Next.js（`app/api/` が Route Handler、`lib/` がサーバー処理と共有型、`components/`・`hooks/` が画面）
- `frontend/e2e/`：Playwright（`smoke/` は実 Ollama 用）。`e2e/mock-ollama/` は偽 Ollama、`compose.e2e.yaml` は E2E 用の上書き
- `scripts/`：起動・終了・リセット・E2E のスクリプト（`tests/` に bats）。`models.yaml` はモデル候補、`data/` は会話の保存先

## Git

- このリポジトリのコミット用メールは GitHub の非公開アドレス（`git config user.email` に設定済み）。変更しない
- コミット文は日本語可。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `.env` と `data/` の中身はコミットしない（`.gitignore` 済み。`data/.gitkeep` だけは例外）

## 環境メモ

- WSL2 Ubuntu（systemd 有効、`appendWindowsPath=false`）。Windows のコマンドは `/mnt/c/Windows/System32/cmd.exe` のように絶対パスで呼ぶ
- GPU：RTX 5070 Laptop（VRAM 8GB）。WSL のメモリ上限 32GB

# ローカル LLM チャット

自分の PC の GPU で動く LLM（[Ollama](https://ollama.com/)）と、ブラウザで使うチャット画面のセットです。
画面からモデルの選択・ダウンロード・削除ができ、会話は最新 10 件まで保存されます。

- 画面：`http://localhost:3000`（この PC からのみ）
- 構成：Docker Compose の 2 コンテナ（`ollama`：GPU で LLM を実行／`frontend`：Next.js の画面と API）
- 仕様：[docs/requirements.md](docs/requirements.md)

## 前提

- Windows + WSL2（Ubuntu、systemd 有効）。WSL の中で `nvidia-smi` が動くこと
- NVIDIA の GPU（開発環境は RTX 5070 Laptop・VRAM 8GB）
- Docker Desktop は使いません（WSL の Ubuntu に Docker Engine を直接入れます）

## はじめて使うとき

1. Docker Engine と NVIDIA Container Toolkit を入れる（管理者のパスワードを聞かれます）

   ```bash
   sudo bash scripts/setup.sh
   ```

2. PowerShell で `wsl --shutdown` を実行し、WSL を開き直す（`docker` を sudo なしで使えるようにするため）
3. 起動する

   ```bash
   scripts/start.sh
   ```

   初回はデフォルトモデル（`gemma4:e4b`、約 6.6GB）のダウンロードが自動で始まり、画面に進捗が出ます。

4. （任意）Windows のデスクトップにショートカットを作る

   ```bash
   scripts/install-windows-shortcuts.sh
   ```

   `LocalLLM-start.bat`（起動してブラウザを開く）・`LocalLLM-stop.bat`（止める）・`LocalLLM-reset.bat`（全部消す）ができます。

## スクリプト

| スクリプト | すること |
|---|---|
| `scripts/start.sh` | 起動して画面が応答するまで待ち、ブラウザを開く。起動済みならブラウザを開くだけ |
| `scripts/stop.sh` | 止める。**モデルと会話の履歴は消えません** |
| `scripts/reset.sh` | このアプリが作ったもの（コンテナ・ダウンロード済みモデル・会話の履歴・ビルドキャッシュ）を全部消す。`RESET` と入力したときだけ実行。`--dry-run` で対象の確認だけ、`--with-images` で Ollama の公式イメージも消す |
| `scripts/up.sh` | ビルドして起動する（ブラウザは開かない。開発用） |
| `scripts/setup.sh` | Docker Engine と NVIDIA Container Toolkit の導入（何度実行しても安全） |
| `scripts/install-windows-shortcuts.sh` | デスクトップに `.bat` を作る |

`LocalLLM-start.bat` で起動したときは、ウィンドウを閉じても WSL が止まらないよう、見えない常駐プロセスを 1 つ動かします（`stop` で終わります）。
端末から `scripts/start.sh` を直接使った場合は、WSL の端末をすべて閉じると、しばらくして WSL ごとアプリも止まります。

## 設定（`.env`）

初回の起動時に `.env.example` から `.env` が作られます。変えたら `scripts/stop.sh` → `scripts/start.sh` で反映されます。

| 項目 | 既定値 | 意味 |
|---|---|---|
| `DEFAULT_MODEL` | `gemma4:e4b` | 起動直後に選ばれるモデル。未ダウンロードなら起動時に自動でダウンロード。削除はできない |
| `OLLAMA_MEM_LIMIT` | `24g` | Ollama コンテナのメモリ上限。超えると Ollama の中だけが止まり、自動で再起動する |
| `IDLE_TIMEOUT_SEC` | `180` | 応答の文字がこの秒数届かなければ打ち切る（応答全体の時間では切らない） |
| `NUM_CTX` | `8192` | 会話の長さ（コンテキスト長）の上限 |
| `CONTEXT_WARN_RATIO` | `0.8` | 上限のこの割合を超えたら「新しいチャットをおすすめします」と出す |
| `TIER_COMFORT_MAX_GB` | `7` | この大きさ以下のモデルは「すぐ使える」（VRAM に収まる） |
| `TIER_EXCLUDE_MIN_GB` | `20` | この大きさ以上のモデルは一覧に出さない。その間は「遅くなります」と表示 |
| `DISCOVERY_TTL_HOURS` | `24` | モデル自動検索の結果を使い回す時間 |
| `DISCOVERY_ENABLED` | `true` | モデル自動検索をするか |
| `SESSION_LIMIT` | `10` | 保存する会話の数（古い順に自動で消える） |
| `BIND_ADDRESS` / `PORT` | `127.0.0.1` / `3000` | 画面の公開先。`127.0.0.1` はこの PC からのみ |

## モデルの候補（`models.yaml`）

```yaml
families: [gemma4, qwen3, llama3.1]   # 起動時に新しいサイズの版を ollama.com から探す種類
models:                               # 直接並べるモデル（sizeGb はダウンロード前の負荷の目安）
  - { name: "gemma4:e4b", sizeGb: 6.6 }
  - { name: "gemma4:12b", sizeGb: 8.0 }
```

- 一覧にないモデルを使いたいときは `families` に種類を書き足すと、次回の起動時に検索して一覧に加えます
- ターミナルで `docker compose exec ollama ollama pull <名前>` したモデルも一覧に出ます
- 検索結果は `data/cache/discovery.json` に保存されます

## 保存場所

- 会話と添付画像：`data/sessions/<セッションID>/`（Windows のエクスプローラーからも見られます）
- ダウンロードしたモデル：Docker の volume `local-llm-chat_ollama-models`

## 重いモデルを選んだとき

メモリが足りなくなると、止まるのは Ollama コンテナの中だけで、数秒で自動的に起動し直します。
画面には「モデルが重すぎて停止しました。再起動中です」と出て、復帰すると消えます。途中まで届いた応答は「（中断）」付きで残ります。

## 開発

| 目的 | コマンド |
|---|---|
| 単体テスト | `cd frontend && npm test`（カバレッジ：`npm test -- --coverage`） |
| E2E（偽 Ollama・GPU 不要） | `cd frontend && npm run test:e2e`（Docker なしで動かす：`npm run test:e2e -- --local`） |
| スモーク（実 Ollama・GPU） | `scripts/start.sh` の後に `cd frontend && npm run test:smoke` |
| スクリプトのテスト | `scripts/tests/run.sh`（初回は `git submodule update --init --recursive` と `sudo apt install -y shellcheck`） |
| ログ | `docker compose logs -f frontend` / `docker compose logs -f ollama` |

- E2E はプロジェクト名 `local-llm-chat-e2e`・ポート 3100 で動き、本番のデータ・volume・ポートには触れません
- 実装の決まりごとは [CLAUDE.md](CLAUDE.md)、実装計画は [docs/superpowers/plans/](docs/superpowers/plans/) にあります

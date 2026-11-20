# ローカルLLMチャットアプリ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker Compose 上の Ollama（GPU）と Next.js チャット画面で、モデルの検索・ダウンロード・削除・切り替え、画像添付、履歴保存ができるローカル LLM チャットアプリを作る。

**Architecture:** `ollama` コンテナはホストに公開せず、`frontend` コンテナ（Next.js App Router。画面＋Route Handlers）だけが内部ネットワーク経由で呼ぶ。ダウンロード管理などのサーバー状態は Next.js サーバープロセス内のシングルトン（`globalThis` に保持）で持ち、ブラウザはポーリングで状態を受け取る。チャットは Route Handler が Ollama `/api/chat` のストリームを NDJSON に変換して中継する。履歴は `./data/` 配下の JSON と画像ファイル。

**Tech Stack:** Docker Engine + NVIDIA Container Toolkit / Ollama 公式イメージ / Next.js（App Router, TypeScript, `output: "standalone"`）/ Node.js 22 / Vitest + Testing Library / react-markdown + remark-gfm + rehype-highlight / mermaid / yaml / bash

**Spec:** `docs/requirements.md`（v5）。各タスクの実装者は必ず該当章を読むこと。

## Global Constraints

- 文言はすべて `frontend/messages/ja.json` から `t(key)` で取得。コンポーネントに日本語を直書きしない（spec 8.3）
- 色はすべて `frontend/app/globals.css` の CSS 変数経由。テーマ型は `"system" | "light" | "dark"`、今回は `"system"` 固定（spec 8.2）
- ブラウザから Ollama を直接呼ばない。Ollama は compose 内部ネットワークのみ、ホストにポートを公開しない（spec 8.1）
- `frontend` のポート公開は `${BIND_ADDRESS:-127.0.0.1}:${PORT:-3000}:3000`（spec 8.1）
- compose のプロジェクト名は `local-llm-chat` 固定（reset.sh がこの名前で対象を絞る）。E2E は `local-llm-chat-e2e`・ポート 3100
- スクリプトはすべて `LLM_APP_ROOT`（既定：リポジトリのルート）を基準に動く。各スクリプトの先頭は `source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"`（呼び出し元のカレントディレクトリに依存しないため。`npm run test:e2e` は `frontend/` から `e2e.sh` を呼ぶ）。`lib.sh` は `LLM_APP_ROOT="${LLM_APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"` と `LLM_SCRIPTS_DIR`（`lib.sh` のあるフォルダ）を設定し、各スクリプトは `cd "$LLM_APP_ROOT"` してから処理する。ほかのスクリプトは `"$LLM_SCRIPTS_DIR/up.sh"` のように呼ぶ（`scripts/up.sh` と書くと、テストで `LLM_APP_ROOT` を一時ディレクトリにしたとき見つからない）。`source` する行の直前に `# shellcheck source=lib.sh` を書き、リポジトリのルートに `.shellcheckrc`（`source-path=SCRIPTDIR`）を置く（動的なパスの `source` は shellcheck が SC1091 を出し、終了コードが 1 になるため）
- Ollama コンテナの環境変数：`OLLAMA_MAX_LOADED_MODELS=1`・`OLLAMA_NUM_PARALLEL=1`（複数モデルの同時読み込みや並列処理でメモリが倍増し、メモリ上限に当たるのを防ぐ。利用者は 1 人のため）
- `.env` の項目と既定値：`DEFAULT_MODEL=gemma4:e4b` / `OLLAMA_MEM_LIMIT=24g` / `IDLE_TIMEOUT_SEC=180` / `NUM_CTX=8192` / `CONTEXT_WARN_RATIO=0.8` / `TIER_COMFORT_MAX_GB=7` / `TIER_EXCLUDE_MIN_GB=20` / `DISCOVERY_TTL_HOURS=24` / `DISCOVERY_ENABLED=true` / `SESSION_LIMIT=10` / `BIND_ADDRESS=127.0.0.1` / `PORT=3000`
  - `PORT` / `BIND_ADDRESS` はホスト側の公開先。`env_file` 経由でコンテナにも入るが、Next.js の standalone サーバーは `PORT` と `HOSTNAME` で待ち受け先を決めるため、compose の `frontend.environment` で `PORT: "3000"`・`HOSTNAME: "0.0.0.0"` を上書きする（`.env` の `PORT=8080` でコンテナ内まで 8080 になり、`8080:3000` の転送先が無くなるのを防ぐ）
  - `.env` に書かない内部用の変数（既定値のまま使い、テストで差し替える）：`OLLAMA_URL`（既定 `http://ollama:11434`）/ `DATA_DIR`（既定 `/app/data`）/ `MODELS_YAML_PATH`（既定 `/app/models.yaml`）
- 負荷区分：サイズ ≤ 7GB → `comfort`、7GB < サイズ < 20GB → `slow`、≥ 20GB → `excluded`（一覧に出さない）。1GB = 1e9 bytes
- 画像：PNG / JPEG / WebP、1 枚 10MB まで、1 回 4 枚まで
- 応答に含まれる HTML は描画しない（`rehype-raw` を使わない）
- `stop.sh` はデータを消すオプションを持たない。`reset.sh` は `RESET` 入力時のみ実行
- 各コミットの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- API の Route Handler はすべて `export const runtime = "nodejs"` と `export const dynamic = "force-dynamic"`（ストリーミングと `fs` を使い、応答をキャッシュさせないため）
- API が受け取る識別子は必ず形式チェックする：セッション ID は `/^\d{8}-\d{6}-[a-z0-9]{6}$/`、画像ファイル名は `/^img-\d+\.(png|jpg|webp)$/`、モデル名は `/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){0,2}:[A-Za-z0-9][A-Za-z0-9._-]*$/`。合わなければ 400（パスの書き換えでフォルダ外を読ませないため）。モデル名の各区切りは英数字で始める（`..` を通さない）。大文字と 3 段までの `/` を許すのは、ターミナルで入れた `hf.co/<user>/<repo>:<tag>` 形式のモデルも一覧・削除・チャットできるようにするため（spec 11-4）
- 本文サイズ：`/api/chat` は画像 4 枚×10MB を受け取るため、Next.js の本文サイズ上限（proxy を通るリクエストは既定 10MB）を `next.config.ts` で 50MB に上げる（設定名はインストールされた Next.js の版のドキュメントで確認する）
- Ollama が止まっている間（`ollamaUp: false`）は「未インストール」と判定しない。画面は削除済み表示・閲覧のみ・ダウンロードダイアログを出さず、再起動中のバナーだけを出す。API は 409（閲覧のみ）ではなく `ollama_down` を返す（Ollama 再起動中に全セッションが「削除されています」になるのを防ぐ）
- compose の `env_file` は `- { path: .env, required: false }`（`.env` の無い CI・初回でも `docker compose up` が失敗しないため）
- `lib/` と Route Handler はモジュールの読み込み時に設定ファイル・`/app/data`・Ollama に触れない（`getConfig()` や `loadYaml()` は関数の中で呼ぶ）。`next build` はページ情報の収集で Route Handler を読み込むため、Docker のビルド中（`/app/models.yaml` も Ollama も無い）に失敗する

## テストの全体像

| 層 | 道具 | 置き場所 | コマンド | GPU / 実 Ollama | 担当タスク |
|---|---|---|---|---|---|
| 単体・API | Vitest（+ Testing Library） | `frontend/**/__tests__/` | `cd frontend && npm test` | 不要（モック） | 各タスクで TDD |
| シェルスクリプト | bats-core + shellcheck | `scripts/tests/*.bats` | `scripts/tests/run.sh` | 不要（`docker` をスタブ） | Task 11 |
| E2E（画面の通し操作） | Playwright + 偽 Ollama サーバー | `frontend/e2e/*.spec.ts`、`e2e/mock-ollama/` | `cd frontend && npm run test:e2e` | 不要 | Task 12 |
| スモーク（実機） | Playwright | `frontend/e2e/smoke/*.spec.ts` | `cd frontend && npm run test:smoke` | 必要 | Task 12 |
| CI | GitHub Actions | `.github/workflows/test.yml` | push / PR で自動 | 不要（スモークは除外） | Task 13 |

- 各タスクの完了条件に「そのタスクの単体テストがすべて通る」ことを含める。タスクをまたぐ通し動作は E2E で確認する
- 偽 Ollama サーバーは、応答内容・ダウンロード進捗・接続断・停止/復帰を外から操作できる。実モデルの出力は毎回違うため、画面の動作確認はこれで行い、実モデルはスモークで最小限だけ確認する
- カバレッジ目標：`frontend/lib/` の行カバレッジ 80% 以上（`npm test -- --coverage`）

## Review Focus

1. **Ollama がチャット中に OOM で落ちる**（7.3）→ 途中までの応答が `interrupted: true` で保存され、画面は「再起動中」バナー → health 復帰で解除。Task 8 / Task 10 に単体テスト、Task 12 `recovery.spec.ts` に E2E
2. **ダウンロード中にブラウザをリロード**（6.2）→ 進捗ダイアログが再表示され、操作禁止が継続。Task 5 / Task 9 に単体テスト、Task 12 `models.spec.ts` に E2E
3. **削除済みモデルの過去セッションを開く**（6.5）→ 入力欄無効＋説明表示。Task 10 に単体テスト、Task 12 `sessions.spec.ts` に E2E
4. **ストリーミング途中の未完 mermaid フェンス／壊れた mermaid**（6.4）→ コードのまま表示、例外を出さない。Task 10 に単体テスト、Task 12 `chat.spec.ts` に E2E
5. **起動直後に Ollama がまだ応答しない**（デフォルトモデル自動 DL）→ 自動 DL はリトライし、画面の `/api/models` は Ollama 停止時も 200 で `ollamaUp: false` を返す。Task 3 / Task 5 に単体テスト、Task 12 `recovery.spec.ts` に E2E

---

## ファイル構成

```
.
├── compose.yaml
├── .env.example
├── models.yaml
├── scripts/
│   ├── setup.sh              # Docker Engine + NVIDIA Container Toolkit 導入（ユーザーが sudo で実行）
│   ├── lib.sh                # 共通関数（色付き出力、前提チェック、専用ビルダー）
│   ├── up.sh                 # 専用ビルダーでビルドして compose up（開発・start.sh 共通）
│   ├── start.sh / stop.sh / reset.sh
│   ├── install-windows-shortcuts.sh   # LocalLLM-start/stop/reset.bat をデスクトップに生成
│   ├── e2e.sh                # E2E 用 compose の起動・テスト・後片付け（Task 12）
│   └── tests/                # bats テスト・docker スタブ（Task 11）
├── compose.e2e.yaml          # E2E 用：ollama を偽サーバーに差し替え（Task 12）
├── e2e/mock-ollama/          # 偽 Ollama サーバー（Task 12）
├── e2e/models.e2e.yaml       # E2E 用のモデル候補（Task 12）
├── data/.gitkeep             # 中身は .gitignore（Task 2）
├── .github/workflows/test.yml  # CI（Task 13）
└── frontend/
    ├── Dockerfile
    ├── next.config.ts
    ├── proxy.ts              # 認証差し込み口（今回は素通し。Next.js 15 以前なら middleware.ts）
    ├── messages/ja.json
    ├── app/
    │   ├── layout.tsx, page.tsx, globals.css
    │   └── api/
    │       ├── health/route.ts
    │       ├── models/route.ts
    │       ├── models/[name]/route.ts           # DELETE
    │       ├── models/download/route.ts         # GET/POST/DELETE
    │       ├── chat/route.ts
    │       └── sessions/route.ts, sessions/[id]/route.ts, sessions/[id]/images/[file]/route.ts
    ├── lib/
    │   ├── config.ts         # env 読み込み
    │   ├── i18n.ts           # t()
    │   ├── theme.ts          # Theme 型
    │   ├── ollama.ts         # Ollama HTTP クライアント
    │   ├── tiers.ts          # 負荷区分
    │   ├── catalog.ts        # models.yaml + インストール済み + 検索結果の統合
    │   ├── discovery.ts      # ollama.com / registry からの検索とキャッシュ
    │   ├── downloads.ts      # ダウンロード管理シングルトン
    │   ├── disk.ts           # 空き容量
    │   ├── sessions.ts       # セッション保存
    │   ├── chat-stream.ts    # Ollama ストリーム → ChatEvent 変換、無応答タイムアウト
    │   ├── markdown.ts       # 未完フェンス判定
    │   └── types.ts          # 共有型
    ├── components/ …         # Task 9 / 10
    ├── e2e/                  # Playwright（Task 12）
    └── instrumentation.ts    # 起動時のデフォルトモデル自動 DL
```

共有型（`frontend/lib/types.ts`、Task 2 で作成し以後これを使う）：

```ts
export type Tier = "comfort" | "slow" | "excluded";
export type ModelEntry = {
  name: string;              // "gemma4:e4b"
  sizeBytes: number | null;  // 不明なら null（区分は comfort 扱いにしない→"slow"）
  tier: Exclude<Tier, "excluded">;
  installed: boolean;
  capabilities: string[];    // installed のときのみ Ollama /api/show の値。未DLは []
  source: "yaml" | "discovered" | "installed";
};
export type ModelsResponse = { models: ModelEntry[]; defaultModel: string; ollamaUp: boolean };
export type DownloadState =
  | { status: "idle" }
  | { status: "running"; model: string; completed: number; total: number; startedAt: string }
  | { status: "error"; model: string; message: string }
  | { status: "done"; model: string };
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  images?: string[];         // セッションフォルダ内のファイル名
  interrupted?: boolean;
  createdAt: string;
};
export type Session = {
  id: string; title: string; model: string;
  createdAt: string; updatedAt: string;
  messages: ChatMessage[];
  lastContextTokens?: number;
};
export type SessionSummary = Pick<Session, "id" | "title" | "model" | "updatedAt">;
export type ChatEvent =
  | { type: "session"; session: SessionSummary }
  | { type: "thinking"; text: string }
  | { type: "content"; text: string }
  | { type: "done"; contextTokens: number; contextLimit: number; warn: boolean }
  | { type: "error"; code: "timeout" | "ollama_down" | "too_heavy" | "failed"; message: string };
// ollama_down: Ollama コンテナ自体が応答しない（再起動中）
// too_heavy : Ollama は生きているが、モデルの実行プロセスがメモリ不足で落ちた／読み込みを拒否した
```

---

### Task 1: 環境構築スクリプト（Docker Engine + NVIDIA Container Toolkit）

**Files:**
- Create: `scripts/lib.sh`, `scripts/setup.sh`, `.shellcheckrc`（`source-path=SCRIPTDIR`。Step 3 の shellcheck より前に必要）

**Interfaces:**
- Produces: `scripts/lib.sh` の関数 `info <msg>` / `ok <msg>` / `fail <msg> <対処>`（`fail` は exit 1）/ `require_docker` / `require_gpu_in_docker` / `ensure_builder`（buildx ビルダー `local-llm-chat`（`--driver docker-container`）が無ければ作成し、`export BUILDX_BUILDER=local-llm-chat`）。Task 2・11 が使う

- [ ] **Step 1: `scripts/lib.sh` を作る**。`fail` は「✖ 原因」「→ 対処」の 2 行を出す。`require_docker`：`docker` が無ければ `fail "Docker が見つかりません" "scripts/setup.sh を実行してください"`、デーモン停止なら `sudo -n systemctl start docker` を試し（パスワードを求めない）、失敗したら `fail "Docker が停止しています" "sudo systemctl start docker を実行してください"`。`require_gpu_in_docker`：`docker run --rm --gpus all ubuntu nvidia-smi -L` が失敗したら fail。`ensure_builder`：専用ビルダーにする理由は、`reset.sh` が `docker buildx rm local-llm-chat` でこのアプリのビルドキャッシュだけを確実に消せるようにするため（`docker builder prune` はプロジェクト単位で絞れない）
- [ ] **Step 2: `scripts/setup.sh` を作る**。Docker 公式手順（apt リポジトリ追加 → `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`）、`usermod -aG docker "$SUDO_USER"`（sudo 実行中の `$USER` は root になるため。`$SUDO_USER` が空なら中断）、`systemctl enable --now docker`、NVIDIA 公式手順（`nvidia-container-toolkit` 導入 → `nvidia-ctk runtime configure --runtime=docker` → docker 再起動）。各段階の前に導入済みかを確認してスキップ（再実行しても安全）。最後に `docker run --rm --gpus all ubuntu nvidia-smi -L` の結果を表示
- [ ] **Step 3: 構文チェック**　Run: `for f in scripts/*.sh; do bash -n "$f"; done && shellcheck scripts/*.sh`（shellcheck が無ければ `sudo apt install -y shellcheck` をユーザーに依頼）　Expected: エラーなし
- [ ] **Step 4: ユーザーが実行する**（sudo パスワードが必要なため実装者は実行しない）。ユーザーに `sudo bash scripts/setup.sh` を依頼する。終了後、docker グループの追加を反映するため、ユーザーに PowerShell で `wsl --shutdown` → WSL と Claude Code を開き直してもらう（Claude Code のシェルも古いグループのままでは `docker` が permission denied になる）。再開後は Step 5 から続ける
- [ ] **Step 5: 確認**　Run: `docker run --rm --gpus all ubuntu nvidia-smi -L`　Expected: `GPU 0: NVIDIA GeForce RTX 5070 Laptop GPU` を含む
- [ ] **Step 6: Commit**　`git add scripts/ && git commit -m "chore: 環境構築スクリプトを追加"`

### Task 2: プロジェクトの土台（Next.js・compose・設定・i18n・テーマ）

**Files:**
- Create: `scripts/up.sh`、`data/.gitkeep`、`frontend/.dockerignore`、`frontend/`（create-next-app）、`frontend/Dockerfile`、`frontend/vitest.config.ts`、`frontend/vitest.setup.ts`、`frontend/next.config.ts`、`frontend/proxy.ts`、`frontend/lib/{config,i18n,theme,types}.ts`、`frontend/messages/ja.json`、`frontend/app/globals.css`、`compose.yaml`、`.env.example`、`models.yaml`
- Modify: `.gitignore`（`data/` → `data/*` と `!data/.gitkeep`）
- Test: `frontend/lib/__tests__/config.test.ts`、`frontend/lib/__tests__/i18n.test.ts`

**Interfaces:**
- Produces:
  - `getConfig(): AppConfig`（`AppConfig = { ollamaUrl; defaultModel; numCtx; idleTimeoutSec; contextWarnRatio; tierComfortMaxGb; tierExcludeMinGb; discoveryTtlHours; discoveryEnabled; sessionLimit; dataDir; modelsYamlPath }`。`ollamaUrl`・`dataDir`・`modelsYamlPath` は環境変数 `OLLAMA_URL`・`DATA_DIR`・`MODELS_YAML_PATH` から読み、既定は Global Constraints のとおり）
  - `t(key: MessageKey, vars?: Record<string,string|number>): string`（`ja.json` は入れ子にせず `"download.confirmTitle": "…"` のような平らなキーにする。`MessageKey = keyof typeof ja`、`{name}` 形式で置換）
  - `type Theme = "system" | "light" | "dark"`、`getTheme(): Theme`（常に `"system"`）
  - `lib/types.ts`（上記の共有型）

- [ ] **Step 1: 雛形作成**　`npx create-next-app@latest frontend --ts --app --eslint --no-tailwind --no-src-dir --import-alias "@/*" --use-npm --disable-git --yes`、続けて `cd frontend && npm i -D vitest @vitest/coverage-v8 @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom` と `npm i yaml`。`vitest.config.ts`（`environment: "node"`、`plugins: [react()]`、`@/` エイリアス、`setupFiles: ["./vitest.setup.ts"]`（中身は `import "@testing-library/jest-dom/vitest"`）、`exclude: ["e2e/**", "node_modules/**"]`、`coverage: { include: ["lib/**"], thresholds: { lines: 80 } }`）を作り、`package.json` に `"test": "vitest run"`。既定を `node` にするのは、Route Handler のテストで `FormData`・`ReadableStream`・`fs` を Node 本来の実装で動かすため（jsdom では multipart の解析が壊れる）。コンポーネントとフックのテストはファイル先頭に `// @vitest-environment jsdom` を書く。インストールされた Next.js のメジャー版を確認し、16 以降なら認証差し込み口は `proxy.ts`、15 以前なら `middleware.ts` とする（以下 `proxy.ts` と書く）
- [ ] **Step 2: 失敗するテストを書く**

```ts
// config.test.ts
it("既定値を返す", () => {
  const c = getConfig({});
  expect(c.defaultModel).toBe("gemma4:e4b");
  expect(c.numCtx).toBe(8192);
  expect(c.tierComfortMaxGb).toBe(7);
  expect(c.tierExcludeMinGb).toBe(20);
  expect(c.sessionLimit).toBe(10);
});
it("数値でない値は既定値に戻す", () => expect(getConfig({ NUM_CTX: "abc" }).numCtx).toBe(8192));
it("DISCOVERY_ENABLED=\"false\" を false と読む", () => expect(getConfig({ DISCOVERY_ENABLED: "false" }).discoveryEnabled).toBe(false));   // E2E が外部サイトに出ない前提
// i18n.test.ts
it("変数を置換する", () => expect(t("download.confirmTitle", { name: "x" })).toBe("x はダウンロードされていません"));
```
（`getConfig(env = process.env)` として env を注入可能にする）

- [ ] **Step 3: 失敗を確認**　Run: `cd frontend && npm test`　Expected: FAIL（モジュール未定義）
- [ ] **Step 4: 実装**。`messages/ja.json` には spec の全文言を入れる（6.1 の（！）説明文、6.2/6.3 ダイアログ、6.4 警告「会話が長くなりました。新しいチャットをおすすめします」、6.5「このモデルは削除されています」、7.3「モデルが重すぎて停止しました。再起動中です」、思考「考え中…（クリックで展開）」、低速注記「遅くなります」、6.1 の「✅ すぐ使える」「⬇ 未ダウンロード」、11-10「画像の質問」（キー `session.imageOnlyTitle`。Task 7 が使う））。打ち切り・添付エラーなど後のタスクで必要になった文言は、そのタスクで `ja.json` に追加する。`globals.css` はライト値を `:root` に、ダーク値を `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` と `:root[data-theme="dark"]` に定義（将来「ライト」を手動で選んだとき OS がダークでもライトになるように）。`proxy.ts` は `NextResponse.next()` を返し、「認証はここに追加する」コメントを置く。`next.config.ts` に `output: "standalone"`
- [ ] **Step 5: テスト通過を確認**　Run: `npm test`　Expected: PASS
- [ ] **Step 6: Docker 一式**
  - `frontend/.dockerignore`：`node_modules`・`.next`・`e2e`・`coverage`・`test-results`・`playwright-report`（ホストの `node_modules`（Node 24 で入れたもの）がビルドに混ざり、コンテナ内の `npm ci` の結果を上書きするのを防ぐ）
  - `frontend/Dockerfile`：`node:22-bookworm-slim` のマルチステージ、standalone 出力（`.next/standalone`・`.next/static`・`public`）をコピー、`ENV HOSTNAME=0.0.0.0 PORT=3000`、`RUN mkdir -p /app/data && chown node:node /app/data`（名前付き volume をマウントしたときも node ユーザーで書けるようにするため）、`EXPOSE 3000`、`USER node`、`CMD ["node", "server.js"]`
  - `compose.yaml`：`name: local-llm-chat`。`ollama`：`image: ollama/ollama:<固定タグ>`（`gh release view -R ollama/ollama --json tagName` で最新の安定版を調べて固定。GitHub のタグは `v0.x.y`、Docker のタグは先頭の `v` を除いた `0.x.y`）、`gpus: all`、`mem_limit: ${OLLAMA_MEM_LIMIT:-24g}`、`environment: OLLAMA_MAX_LOADED_MODELS=1, OLLAMA_NUM_PARALLEL=1`、`restart: unless-stopped`、volume `ollama-models:/root/.ollama`、`healthcheck: ollama list`、ポート公開なし。`frontend`：`build: ./frontend`、`env_file: [{ path: .env, required: false }]`、`environment:`（マップ形式。E2E の上書きとマージするため）`{ PORT: "3000", HOSTNAME: "0.0.0.0" }`、`ports: ["${BIND_ADDRESS:-127.0.0.1}:${PORT:-3000}:3000"]`、`volumes: ["./data:/app/data", "./models.yaml:/app/models.yaml:ro"]`、`restart: unless-stopped`、`depends_on: ollama`（`condition: service_started`。ollama 未起動でも frontend は動く必要があるため healthy 待ちにしない）
  - `.env.example`：Global Constraints の全項目
  - `models.yaml`：
```yaml
families: [gemma4, qwen3, llama3.1]
models:
  - { name: "gemma4:e4b", sizeGb: 6.6 }
  - { name: "gemma4:12b", sizeGb: 8.0 }
  - { name: "gemma4:26b", sizeGb: 18 }
```
  - `data/.gitkeep` をコミットし、`.gitignore` の `data/` を `data/*` と `!data/.gitkeep` に変える（`up.sh` を通さず `docker compose up -d` しても、Docker が `./data` を root 所有で作ってセッションが保存できなくなるのを防ぐ。spec 8 の「1 コマンドで起動」）
  - `scripts/up.sh`：`source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"` → `cd "$LLM_APP_ROOT"` → `require_docker` → `.env` が無ければ `.env.example` からコピー（既存は上書きしない）→ `ensure_builder` → `mkdir -p data` → `docker compose up -d --build`
- [ ] **Step 7: 起動確認**　Run: `scripts/up.sh && curl -s --retry 30 --retry-delay 2 --retry-all-errors -o /dev/null -w "%{http_code}" http://localhost:3000 && docker compose exec ollama nvidia-smi -L`　Expected: `200` と GPU 名
- [ ] **Step 8: CLAUDE.md を更新**：「コマンド」表を実際に動いたコマンドに合わせて直し、「フォルダ構成」を 5 行程度で追記（60 行以内に保つ）
- [ ] **Step 9: Commit**　`git add -A && git commit -m "feat: Next.js と compose の土台を追加"`

### Task 3: Ollama クライアント・負荷区分・モデル一覧 API

**Files:**
- Create: `frontend/lib/ollama.ts`、`frontend/lib/tiers.ts`、`frontend/lib/catalog.ts`、`frontend/app/api/models/route.ts`、`frontend/app/api/health/route.ts`
- Test: `frontend/lib/__tests__/tiers.test.ts`、`frontend/lib/__tests__/catalog.test.ts`

**Interfaces:**
- Consumes: `getConfig()`、`lib/types.ts`
- Produces:
  - `ollama.ts`：`listInstalled(): Promise<{name:string;size:number}[]>`（`GET /api/tags`）、`showModel(name): Promise<{capabilities:string[]}>`（`POST /api/show`）、`deleteModel(name): Promise<void>`（`DELETE /api/delete`）、`isUp(): Promise<boolean>`（`GET /api/version`、2 秒タイムアウト）。`pull` と `chat` は Task 5 / 8 で追加
  - `classifyTier(sizeBytes: number | null, cfg): Tier`
  - `buildCatalog(input: { yaml: YamlModels; installed: {name;size;capabilities}[]; discovered: {name;sizeBytes}[]; cfg }): ModelEntry[]`
  - `loadYaml(path): YamlModels`（`{ families: string[]; models: {name; sizeGb}[] }`）
  - `getCatalog(): Promise<ModelsResponse>`（`catalog.ts`。yaml・`listInstalled`＋`showModel`・検索結果（Task 4 で追加）を集めて `buildCatalog` を呼ぶ。Ollama 停止時は例外を出さず `installed: []`・`ollamaUp: false`。`/api/models`・`/api/models/download`（Task 5）・`/api/models/[name]`（Task 6）はこれを共有し、一覧の組み立てを各ルートに重複させない）
  - `GET /api/models` → `ModelsResponse`、`GET /api/health` → `{ ollamaUp: boolean }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// tiers.test.ts（cfg は comfort 7 / exclude 20）
expect(classifyTier(6.6e9, cfg)).toBe("comfort");
expect(classifyTier(7e9, cfg)).toBe("comfort");
expect(classifyTier(8e9, cfg)).toBe("slow");
expect(classifyTier(20e9, cfg)).toBe("excluded");
expect(classifyTier(null, cfg)).toBe("slow");
// catalog.test.ts
it("excluded を除き、同名は installed を優先し実サイズで判定する")  // yaml 12b(8GB) + installed 12b(size 6e9) → installed:true, tier:"comfort", source:"installed"
it("yaml に無い installed も出す")                                  // installed "phi4:14b" → 含まれる
it("discovered の 31b(20.1e9) は出さない")
it("並び順：installed が先、次に sizeBytes 昇順")
it("デフォルトモデルが excluded サイズでも tier:\"slow\" として一覧に残す")   // 削除不可・起動時DL対象のため
```

- [ ] **Step 2: 失敗を確認**　Run: `npm test -- tiers catalog`　Expected: FAIL
- [ ] **Step 3: 実装**。`GET /api/models` は Ollama 停止時に例外を出さず `installed: []`・`ollamaUp: false` で 200 を返す（Review Focus 5）。capabilities は installed の各モデルに `showModel` を呼んで埋める（並列）
- [ ] **Step 4: テスト通過を確認**　Run: `npm test`　Expected: PASS
- [ ] **Step 5: 実機確認**　Run: `scripts/up.sh && curl -s localhost:3000/api/models`　Expected: `gemma4:e4b` などを含む JSON、`"ollamaUp":true`
- [ ] **Step 6: Commit**

### Task 4: 起動時のモデル自動検索（discovery）

**Files:**
- Create: `frontend/lib/discovery.ts`
- Modify: `frontend/lib/catalog.ts`（`getCatalog` が `readDiscoveryCache` の結果を `buildCatalog` に渡す）
- Create: `frontend/instrumentation.ts`（`register()` は `process.env.NEXT_RUNTIME === "nodejs"` のときだけ動き、サーバー専用モジュールは関数内で `await import()` する（Edge 用のビルドに `fs` を混ぜないため）。`discoveryEnabled` のときだけ `refreshDiscovery` を呼ぶ。**`register()` の中で検索の完了を `await` しない**（`void refreshDiscovery(cfg)`）。Next.js は `register()` が終わるまでリクエストを受け付けないため、待つと最大 30 秒画面が開かない。Task 5 で追記する）
- Test: `frontend/lib/__tests__/discovery.test.ts`、fixture `frontend/lib/__tests__/fixtures/gemma4-tags.html`（`curl -s https://ollama.com/library/gemma4/tags` を保存）

**Interfaces:**
- Produces:
  - `parseTagNames(html: string, family: string): string[]`
  - `isStandardTag(tag: string): boolean`
  - `fetchManifestSize(family, tag, fetchFn = fetch): Promise<number | null>`（`GET https://registry.ollama.ai/v2/library/<family>/manifests/<tag>`、`Accept: application/vnd.docker.distribution.manifest.v2+json`、`layers[].size` の合計）
  - `readDiscoveryCache(cfg): Promise<{name; sizeBytes}[]>`（キャッシュ `${dataDir}/cache/discovery.json` = `{ fetchedAt, families, models }` を読むだけ。無ければ `[]`。ネットワークに出ない。`fetchedAt` の古さは見ない。呼ばれるたびにファイルを読み、結果をメモリに持ち続けない（検索後や E2E でキャッシュを置き換えたとき、すぐ一覧に反映するため））
  - `refreshDiscovery(cfg, fetchFn = fetch): Promise<void>`（次のいずれかのときだけ検索して書き込む：キャッシュが無い／`discoveryTtlHours` より古い／キャッシュの `families` が今の `models.yaml` の `families` と違う。最後の条件は、spec 6.1 の（！）の説明「追記すると次回の起動時に検索」を 24 時間待たせないため。失敗時は古いキャッシュを残し、メモリ上で 1 時間は再検索しない（オフライン時に `/api/models` のたびに 30 秒の検索を繰り返さないため）。例外を外に出さない。同時実行は 1 つ）
  - `discoveryEnabled` が false（E2E 用）のときは `refreshDiscovery` を呼ばず、キャッシュの読み込みだけ行う
  - 呼び出し方：`instrumentation.ts` の起動時と、`GET /api/models` のたびに `void refreshDiscovery(cfg)` を待たずに（バックグラウンドで）呼ぶ（新しければ何もしない）。`GET /api/models` は常に `readDiscoveryCache` の結果だけで即応答する。理由：検索は最大 30 秒かかり、画面の表示を止めないため

- [ ] **Step 1: 失敗するテストを書く**

```ts
expect(parseTagNames(fixtureHtml, "gemma4")).toEqual(expect.arrayContaining(["e4b", "12b", "26b", "31b-mlx"]));
expect(["e2b","e4b","12b","26b","31b","1.5b","70b"].every(isStandardTag)).toBe(true);
expect(["latest","31b-cloud","12b-mlx","12b-it-q8_0","26b-a4b","12b-nvfp4","12b-mxfp8","31b-it-bf16"].some(isStandardTag)).toBe(false);
it("manifest の layers.size を合計する")            // fetchFn をモックし [100, 200] → 300
it("キャッシュが TTL 内なら fetch しない")
it("TTL 内でも models.yaml の families が変わっていたら検索する")
it("fetch が全て失敗してもキャッシュは壊さず、readDiscoveryCache は [] を返す")
it("失敗した直後の再呼び出しでは fetch しない")
it("refreshDiscovery の同時呼び出しは 1 回だけ検索する")
```
`isStandardTag` の判定は正規表現 `/^e?\d+(\.\d+)?b$/`。

- [ ] **Step 2: 失敗を確認**　Run: `npm test -- discovery`　Expected: FAIL
- [ ] **Step 3: 実装**。`parseTagNames` は `href="/library/<family>:<tag>"` を抽出し重複除去。manifest 取得は family ごとに直列、全体 30 秒で打ち切り
- [ ] **Step 4: テスト通過を確認**　Expected: PASS
- [ ] **Step 5: 実機確認**　Run: `scripts/up.sh && sleep 40 && curl -s localhost:3000/api/models | grep -o '"source":"discovered"' | head -3 && ls data/cache/discovery.json`　Expected: discovered が 1 件以上、キャッシュファイルあり
- [ ] **Step 6: Commit**

### Task 5: ダウンロード管理（進捗・中止・空き容量・起動時自動 DL）

**Files:**
- Create: `frontend/lib/downloads.ts`、`frontend/lib/disk.ts`、`frontend/app/api/models/download/route.ts`
- Modify: `frontend/instrumentation.ts`（Task 4 で作成済み）
- Modify: `frontend/lib/ollama.ts`（`pull` 追加）
- Test: `frontend/lib/__tests__/downloads.test.ts`、`frontend/lib/__tests__/disk.test.ts`、`frontend/lib/__tests__/ollama.test.ts`（`fetch` をモック。`ollama.ts` は他のテストでは常にモックされ、`lib/` のカバレッジ 80% を下回りやすいため）

**Interfaces:**
- Consumes: `classifyTier`、`getConfig`
- Produces:
  - `readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncIterable<T>`（`ollama.ts`。1 行が複数チャンクに分かれても、1 チャンクに複数行あっても正しく区切る。Task 8 の `chat` も使う）
  - `ollama.pull(name, signal): AsyncIterable<{status:string; completed?:number; total?:number; error?:string}>`（`POST /api/pull`、`stream: true`、`readNdjson` でパース）
  - `getDownloadManager(): DownloadManager`（`globalThis.__downloadManager` に保持）
    - `state(): DownloadState`
    - `start(model: string, expectedBytes: number | null): Promise<{ ok: true } | { ok: false; code: "busy" | "disk" ; message: string }>`（空き容量の確認 `freeBytes` が非同期のため。`busy` の判定と「確認中」の印は `await` の前に同期的に行い、同時に 2 回呼ばれても 1 つしか始まらないようにする）
    - `cancel(): void`（`running` なら中止して `idle`。`error` / `done` なら `idle` に戻すだけ＝エラー表示を閉じる操作）
    - `isBusy(): boolean`
  - `freeBytes(path: string): Promise<number>`（`fs.statfs`、`bavail * bsize`）
  - API：`GET /api/models/download` → `DownloadState`、`POST { model }` → 202 / 409(busy) / 507(disk)（`expectedBytes` は `buildCatalog` の該当エントリの `sizeBytes`。一覧に無いモデル名は 400）、`DELETE` → 中止、または error / done の表示を閉じる（`cancel()`）
  - 他の変更系 API（チャット送信・モデル削除・セッション削除）は `isBusy()` のとき 409 を返す（Task 6–8 で使用）

- [ ] **Step 1: 失敗するテストを書く**（`pull` をモック）

```ts
it("進捗を state に反映し、完了で done になる")
it("実行中に start すると busy を返す")
it("start を await せずに 2 回続けて呼んでも、2 回目は busy")
it("空き容量 < expectedBytes * 1.1 なら disk を返し開始しない")
it("cancel で AbortSignal が発火し state が idle に戻る")
it("pull が error 行を返したら state は error（message 付き）")
it("done/error の後の start は受け付ける")
it("error 状態で cancel すると idle に戻る")
// ollama.test.ts
it("readNdjson: 1 行が 2 チャンクに分かれても、1 チャンクに 2 行あっても 1 行ずつ返す")
it("isUp: 2 秒で応答が無ければ false")
```

- [ ] **Step 2: 失敗を確認**　Expected: FAIL
- [ ] **Step 3: 実装**。空き容量は `getConfig().dataDir` に対して `freeBytes`（ollama volume と同じ WSL 仮想ディスク上にあるため。spec 11-3）。`instrumentation.ts` の `register()` に、`isUp()` を 5 秒間隔・最大 10 分待ち、デフォルトモデルが未インストールなら `start(defaultModel, <getCatalog() の該当エントリの sizeBytes>)` する処理を追加する（空き容量の確認を飛ばさないため）。Task 4 と同じく **`await` せずバックグラウンドで動かす**（Ollama が起動しないと最大 10 分、画面が開かなくなる。Review Focus 5）
- [ ] **Step 4: テスト通過を確認**　Expected: PASS
- [ ] **Step 5: 実機確認**（起動時にデフォルトモデルの自動 DL が走るので、まずそれを確認してから中止を試す）
  1. Run: `scripts/up.sh && sleep 15 && curl -s localhost:3000/api/models/download`　Expected: `gemma4:e4b` の `running`（自動 DL。Task 8 以降で使うので中止しない。すでに入っていれば `idle` なので 3 へ）
  2. Run: `until curl -s localhost:3000/api/models/download | grep -qE '"(done|error|idle)"'; do sleep 10; done; curl -s localhost:3000/api/models/download; curl -s localhost:3000/api/models | grep -o '"name":"gemma4:e4b"[^}]*'`　Expected: 状態が `done`、`"installed":true` を含む（`error` なら原因を直してから進む）
  3. Run: `curl -s -XPOST localhost:3000/api/models/download -H 'content-type: application/json' -d '{"model":"gemma4:e2b"}'; sleep 3; curl -s localhost:3000/api/models/download; curl -s -XDELETE localhost:3000/api/models/download; curl -s localhost:3000/api/models/download`　Expected: `running` の進捗 → 中止後 `idle`（`gemma4:e2b` は Task 4 の検索で一覧に入っている。無ければ 400 になるので、`/api/models` にある別の未 DL モデルで試す）
- [ ] **Step 6: Commit**

### Task 6: モデル削除 API

**Files:**
- Create: `frontend/app/api/models/[name]/route.ts`
- Test: `frontend/app/api/models/__tests__/delete.test.ts`

**Interfaces:**
- Consumes: `ollama.deleteModel`、`getDownloadManager().isBusy()`、`getConfig().defaultModel`
- Produces: `DELETE /api/models/:name`（name は `encodeURIComponent`。`gemma4:e4b` → `gemma4%3Ae4b`）→ 204 / 400(`default_model` または形式違反) / 404(未インストール) / 409(`busy`) / 503(Ollama 停止中)。`params.name` がデコード済みかをインストールされた Next.js で確かめ、二重にデコードしない。静的ルート `models/download` が動的ルート `models/[name]` より優先されるため衝突しない

- [ ] **Step 1: 失敗するテストを書く**：「デフォルトモデルは 400」「ダウンロード中は 409」「未インストールは 404」「`..%2Fetc:x`（デコード後 `../etc:x`）は 400」「`hf.co/user/repo:Q4_K_M` は形式チェックを通る」「Ollama 停止中は 503」「通常は deleteModel を呼び 204」
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: PASS を確認**
- [ ] **Step 5: Commit**

### Task 7: セッション保存（ファイル・10 件保持・画像）

**Files:**
- Create: `frontend/lib/sessions.ts`、`frontend/app/api/sessions/route.ts`、`frontend/app/api/sessions/[id]/route.ts`、`frontend/app/api/sessions/[id]/images/[file]/route.ts`
- Test: `frontend/lib/__tests__/sessions.test.ts`（一時ディレクトリを `DATA_DIR` に指定する）、`frontend/app/api/sessions/__tests__/route.test.ts`（形式チェックの 400）

**Interfaces:**
- Produces（保存形式：`${dataDir}/sessions/<id>/session.json` と同フォルダの画像）：
  - `createSession(model: string, firstUserText: string): Promise<Session>`（id は `YYYYMMDD-HHmmss-<6桁ランダム>`、title は `firstUserText` の空白を詰めた先頭 20 文字、超えたら末尾 `…`。本文が空で画像だけのときは `t("session.imageOnlyTitle")`（「画像の質問」））
  - `saveSession(s: Session): Promise<void>`（一時ファイルに書いて rename。保存後 `prune(keepId = s.id)`）
  - `getSession(id): Promise<Session | null>`、`listSessions(): Promise<SessionSummary[]>`（updatedAt 降順）、`deleteSession(id): Promise<void>`（フォルダごと）
  - `saveImage(id, file: { name; type; bytes: Uint8Array }): Promise<string>`（保存したファイル名を返す。`img-<n>.<ext>`）
  - `prune(keepId: string): Promise<void>`（updatedAt 降順で `sessionLimit` 件を超えた分を削除、`keepId` は除外）
  - `validateImage(file): { ok: true } | { ok: false; reason: "type" | "size" }`
  - API：`GET /api/sessions` → `SessionSummary[]`、`GET /api/sessions/:id` → `Session`、`DELETE /api/sessions/:id` → 204（ダウンロード中 409）、`GET /api/sessions/:id/images/:file` → 画像（`file` は `/^img-\d+\.(png|jpg|webp)$/` のみ許可）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("title は先頭 20 文字＋…")
it("11 件目の保存で最も古い updatedAt のセッションが消える")
it("keepId のセッションは古くても消えない")
it("deleteSession は画像ごとフォルダを消す")
it("validateImage: gif は type、10MB+1 byte は size")
it("壊れた session.json は listSessions で無視する")
// route.test.ts
it("images の file に ../ を含むと 400")
it("セッション ID が形式違反（例 ../etc）なら GET/DELETE とも 400")
// sessions.test.ts
it("本文が空で画像だけのセッションは title が『画像の質問』")
```

- [ ] **Step 2–4: FAIL → 実装 → PASS**
- [ ] **Step 5: Commit**

### Task 8: チャット API（ストリーミング・思考・無応答タイムアウト・中断保存）

**Files:**
- Create: `frontend/lib/chat-stream.ts`、`frontend/app/api/chat/route.ts`
- Modify: `frontend/lib/ollama.ts`（`chat` 追加）
- Test: `frontend/lib/__tests__/chat-stream.test.ts`、`frontend/app/api/chat/__tests__/route.test.ts`

**Interfaces:**
- Consumes: sessions（Task 7）、`isBusy()`、`getConfig()`
- Produces:
  - `ollama.chat({ model, messages, think, numCtx }, signal): AsyncIterable<OllamaChatChunk>`（`POST /api/chat`、`stream: true`、`options: { num_ctx }`、メッセージの `images` は base64。過去のユーザー発言に付いた画像もセッションフォルダから読み込んで毎回付ける）
  - `streamWithIdleTimeout<T>(src: AsyncIterable<T>, idleMs: number, signal): AsyncIterable<T>`（チャンク間・最初のチャンクまでの無応答が `idleMs` を超えたら `IdleTimeoutError` を投げる）
  - `POST /api/chat`（`multipart/form-data`：`sessionId?`、`model`、`content`、`images`（同じ名前で最大 4 回。`formData.getAll("images")`））→ `application/x-ndjson` の `ChatEvent` ストリーム
    - 新規なら最初に `{type:"session"}` を送る。`sessionId` があるのにセッションが無ければ 404
    - `ollama.chat` は Ollama のエラーを 2 つの形で受ける：HTTP エラー（本文 `{"error": "…"}`）と、200 のストリームの途中に来る `{"error": "…"}` の行。どちらも `error` の文を持つ例外にして `classifyOllamaError` に渡す（`too_heavy` の判定は主にこの文で行うため）
    - `think` は対象モデルの capabilities に `"thinking"` があるときだけ `true`
    - 完了時 `contextTokens = prompt_eval_count + eval_count`、`warn = contextTokens >= numCtx * contextWarnRatio`、`session.lastContextTokens` に保存
    - クライアント切断（`request.signal` abort）・タイムアウト・Ollama 切断のいずれでも、途中までの応答を `interrupted: true` で保存する。切断は応答用 `ReadableStream` の `cancel()` でも検知して同じ処理にする（`request.signal` が切断で発火しない Next.js の版があるため。どちらが先でも保存は 1 回だけ）
    - `classifyOllamaError(err: unknown, up: boolean): "ollama_down" | "too_heavy" | "failed"`：`up` が false → `ollama_down`。Ollama のエラー文に `unexpectedly stopped` / `out of memory` / `requires more system memory` / `exit status` を含む → `too_heavy`（コンテナのメモリ上限に当たると、多くの場合 Ollama 本体ではなくモデルの実行プロセスだけが落ちるため）。その他 → `failed`
    - エラーコード：タイムアウト → `timeout`、それ以外は `classifyOllamaError`。ダウンロード中は送信前に 409
    - `sessionId` がある場合、モデルはセッションに保存されたものを使い、フォームの `model` は無視する（1 セッション＝1 モデル）
    - セッションのモデルが未インストールなら 409（閲覧のみ）。ただし Ollama 停止中で一覧が取れないときは 409 にせず `error ollama_down` を返す（Global Constraints）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// chat-stream.test.ts
it("チャンク間が idleMs を超えたら IdleTimeoutError")
it("チャンクが来続ければ総時間が idleMs を超えても切らない")
// route.test.ts（ollama.chat をモック）
it("thinking と content を別イベントで流し、done に contextTokens と warn を入れる")   // numCtx 8192, 7000 → warn:true
it("途中で ollama.chat が ECONNRESET、isUp=false → error ollama_down、途中の応答が interrupted で保存")
it("Ollama が 'model runner has unexpectedly stopped' を返す → error too_heavy")
it("Ollama が 'model requires more system memory' を返す → error too_heavy")
it("既存 sessionId に別の model を送ってもセッションのモデルで実行する")
it("request.signal を abort すると途中の応答が interrupted で保存")
it("capabilities に vision が無いモデルに画像を送ると 400")
it("画像 5 枚は 400")
it("本文が空で画像も無いと 400")
it("存在しない sessionId は 404")
it("ストリームの途中に {\"error\":\"model runner has unexpectedly stopped\"} の行が来ても too_heavy")
it("Ollama 停止中に既存セッションへ送ると 409 ではなく error ollama_down")
it("ReadableStream の cancel() でも途中の応答が interrupted で 1 回だけ保存される")
```

- [ ] **Step 2–4: FAIL → 実装 → PASS**
- [ ] **Step 5: 実機確認**　Run: `scripts/up.sh && curl -sN -F model=gemma4:e4b -F content=こんにちは localhost:3000/api/chat`　Expected: `session`→`content`…→`done` の NDJSON 行、`data/sessions/` にフォルダ作成
- [ ] **Step 6: Commit**

### Task 9: 画面（レイアウト・セッション一覧・モデル選択・ダイアログ・操作ロック）

**Files:**
- Create: `frontend/app/page.tsx`、`frontend/components/{AppShell,SessionList,ModelPicker,InfoPopover,DownloadDialog,ConfirmDialog,Icon}.tsx`、`frontend/hooks/{useModels,useDownload,useSessions}.ts`
- Test: `frontend/components/__tests__/ModelPicker.test.tsx`、`frontend/components/__tests__/DownloadDialog.test.tsx`、`frontend/hooks/__tests__/useDownload.test.ts`

**Interfaces:**
- Consumes: 全 API（Task 3–7）、`t()`
- Produces（Task 10 が使う）：
  - `AppShell` が保持する画面状態 `UiState = { selectedModel: string; currentSessionId: string | null; locked: boolean /* ダウンロード中 */ }`
  - `useModels(): { models: ModelEntry[]; defaultModel: string; ollamaUp: boolean; refresh(): Promise<void> }`
  - `useDownload(opts: { onDone(model: string): void }): { state: DownloadState; start(model): Promise<void>; cancel(): Promise<void> }`（`running` 中は 1 秒、それ以外は 5 秒間隔で `GET /api/models/download` をポーリング。`done` を受け取ったら（ブラウザを閉じている間に完了した場合も含め、遷移を見なくても）`onDone(model)` を呼んでから `cancel()` で `idle` に戻す。`AppShell` は `onDone` で `useModels().refresh()` とモデル選択を行う）
  - `useSessions(): { list: SessionSummary[]; refresh(); remove(id) }`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it("未DLモデルを選ぶと DownloadDialog（サイズと遅くなります注記付き）が開く")
it("デフォルトモデル選択中はゴミ箱が disabled")
it("会話中（currentSession にメッセージあり）はプルダウンが disabled で 🔒 表示")
it("（！）を押すと models.yaml の説明文が出る")
it("useDownload: 初回取得が running なら進捗ダイアログを開いた状態で始まる")   // Review Focus 2
it("locked 中は [中止] 以外のボタンが disabled")
it("削除確認で [削除する] → 選択中モデルならデフォルトモデルに切り替わり、会話中だったなら新しいチャットになる")
it("アプリを開いた直後は新しいチャット（空）＋デフォルトモデル。過去のセッションは一覧から開く")
it("DownloadState が error ならダイアログにエラー文を出し、閉じると locked が解除される")
it("POST が 507（空き容量不足）・409 を返したら、ダイアログにその理由を出し、ダウンロードは始まらない")   // spec 6.2。state は idle のままなので、POST の応答で表示する
it("ollamaUp:false のときは選択中モデルが未インストール扱いでも DownloadDialog を開かない")
it("表示中のセッションを一覧から削除すると新しいチャット（空）になる")
```

- [ ] **Step 2–4: FAIL → 実装 → PASS**。アイコンはインライン SVG（ゴミ箱、情報、クリップ、鍵）で `Icon` にまとめる。セッション行のゴミ箱は `ConfirmDialog` を通す
- [ ] **Step 5: 実機確認**　Run: `scripts/up.sh` の後、Playwright（MCP の `browser_navigate`・`browser_take_screenshot`）で `http://localhost:3000` を開いてスクリーンショット　Expected: 左にセッション一覧、上にモデル選択と（！）とゴミ箱
- [ ] **Step 6: Commit**

### Task 10: チャット画面（Markdown・Mermaid・思考・警告・画像添付・閲覧のみ・復帰バナー）

**Files:**
- Create: `frontend/lib/markdown.ts`、`frontend/components/{ChatView,MessageBubble,MarkdownView,CodeBlock,MermaidBlock,ThinkingBlock,Composer,AttachmentTray,OllamaDownBanner}.tsx`、`frontend/hooks/useChat.ts`
- Test: `frontend/lib/__tests__/markdown.test.ts`、`frontend/components/__tests__/{MarkdownView,Composer,ChatView}.test.tsx`

**Interfaces:**
- Consumes: `UiState`、`useModels`、`POST /api/chat`、`GET /api/health`
- Produces:
  - `hasOpenFence(md: string): boolean`（行頭 ```` ``` ```` の個数が奇数なら true）
  - `useChat(sessionId, opts: { onSessionCreated(s: SessionSummary): void; onDone(): void }): { messages; send(content, files: File[]); stop(); streaming: boolean; warn: boolean; ollamaDown: boolean }`（`sessionId` が外から変わったときだけ `GET /api/sessions/:id` で読み直す。新規送信で受けた `{type:"session"}` は `onSessionCreated` で `AppShell` に伝えて `currentSessionId` を更新させるが、**自分が作ったこの ID では読み直さない**（読み直すとストリーミング中の表示が保存前の内容で上書きされて消えるため）。`onDone` で `AppShell` はセッション一覧を更新する。`stop` は fetch を abort。`error ollama_down` または `too_heavy` を受けたら `ollamaDown=true` にし（バナー文言は spec 7.3）、`/api/health` を 3 秒間隔で確認、`ollamaUp` で false に戻す）
  - `MarkdownView({ text, streaming })`：react-markdown + remark-gfm + rehype-highlight。`rehype-raw` は使わない。`code` レンダラで `language-mermaid` かつ「`streaming && hasOpenFence(text)` で最後のブロック」でなければ `MermaidBlock`、それ以外は `CodeBlock`（コピーボタン付き）。「最後のブロック」は react-markdown が渡す `node.position.end.offset` が本文の末尾（末尾の空白を除く）に届いているかで判定する（閉じていないフェンスは本文の最後まで続くため）
  - `MermaidBlock({ code })`：`mermaid` を dynamic import し `mermaid.parse` → 失敗なら `CodeBlock` を表示（例外を外に出さない）。テーマはダーク判定で `dark` / `default`

- [ ] **Step 1: 失敗するテストを書く**

```ts
expect(hasOpenFence("a\n```mermaid\ngraph TD")).toBe(true);
expect(hasOpenFence("```mermaid\ngraph TD\n```\n")).toBe(false);
it("表・チェックボックスが table / input[type=checkbox] で描画される")
it("<script> を含む応答で script 要素が生成されない")
it("ストリーミング中の未完 mermaid は pre/code で表示")                 // Review Focus 4
it("mermaid.parse が例外でもコードとして表示し、例外を投げない")
it("thinking があると『考え中…（クリックで展開）』で折りたたまれている")
it("done.warn=true で警告文を表示し、送信は可能なまま")
it("vision 非対応モデルでは 📎 が disabled")
it("PNG/JPEG/WebP 以外・10MB 超・5 枚目は追加されずエラー文言を表示")
it("error timeout を受けると打ち切りの文言を表示し、入力を再開できる")
it("セッションのモデルが installed に無いと入力欄 disabled と『このモデルは削除されています』")   // Review Focus 3
it("ollamaUp:false のときは installed に無くても『削除されています』を出さない")
it("新規送信で session イベントを受けても、ストリーミング中の表示が消えない")
it("ollama_down を受けるとバナー表示、health が up でバナーが消える")                       // Review Focus 1
it("too_heavy を受けるとバナー表示、health が up なら次の確認で消える")
it("interrupted のメッセージに（中断）が付く")
```

- [ ] **Step 2–4: FAIL → 実装 → PASS**。先に `npm i react-markdown remark-gfm rehype-highlight mermaid` と `npm i -D @testing-library/user-event`。添付は 📎 ボタン、ドラッグ＆ドロップ、`paste` イベントの 3 経路。送信前はサムネイル（`URL.createObjectURL`）と ✕
- [ ] **Step 5: 実機確認**（`scripts/up.sh` の後、Playwright）：`gemma4:e4b` に「mermaid でフローチャートを書いて」→ 図が描画される／画像を添付して説明が返る／[停止] で（中断）表示
- [ ] **Step 6: Commit**

### Task 11: 起動・終了・リセットスクリプトと Windows ショートカット

**Files:**
- Create: `scripts/start.sh`、`scripts/stop.sh`、`scripts/reset.sh`、`scripts/keepalive.sh`、`scripts/install-windows-shortcuts.sh`
- Test: `scripts/tests/{start,stop,reset,lib}.bats`、`scripts/tests/{bats,test_helper/bats-support,test_helper/bats-assert}`（git submodule）、`scripts/tests/stubs/docker`（呼ばれた引数を 1 行ずつ `$DOCKER_CALLS` のファイルに追記するだけの偽 `docker`。`ps` や `system df` には固定の出力を返す）、`scripts/tests/run.sh`（shellcheck → bats をまとめて実行）

**Interfaces:**
- Consumes: `scripts/lib.sh`（Task 1）
- Produces: Windows デスクトップの `LocalLLM-start.bat` / `LocalLLM-stop.bat` / `LocalLLM-reset.bat`

- [ ] **Step 0: 失敗するテストを書く**（`PATH` の先頭に `scripts/tests/stubs` を置き、`docker` / `curl` / `ss` / `cmd.exe` をスタブにする。`docker` スタブは `STUB_FRONTEND_RUNNING=1` のとき `docker compose ps` に `frontend` の running 行を返す。`ss` は環境変数 `STUB_PORT_BUSY=1` のとき `127.0.0.1:3000` の LISTEN 行を返す（ポート使用中のテストを実機のポート状況に左右させないため）。`cmd.exe` は `start.sh` が絶対パス `/mnt/c/Windows/System32/cmd.exe` で呼ぶため、そのパスは環境変数 `WIN_CMD`（既定は絶対パス）で差し替えられるようにし、テストではスタブを指す。`pkill` もスタブにする（`stop.sh` のテストで実機のプロセスを終わらせないため）。bats-core・bats-support・bats-assert を git submodule で追加し、`sudo` を不要にする。**全スクリプトは環境変数 `LLM_APP_ROOT`（既定：リポジトリのルート）を基準に動き、テストでは一時ディレクトリを指定する**。理由：`reset.sh` のテストが本物の `data/` を消さないようにするため。`setup()` で一時ディレクトリに `.env.example` のコピーと `data/sessions/x/session.json` を作り、スクリプトは `"$BATS_TEST_DIRNAME/../stop.sh"` のように絶対パスで呼ぶ（`bats` を実行した場所に左右されないため。下の例では短く `scripts/stop.sh` と書く））

```bash
@test "stop.sh は down に -v を付けない" { run scripts/stop.sh; assert_success; grep -q "compose down" "$DOCKER_CALLS"; ! grep -q -- "-v" "$DOCKER_CALLS"; }   # docker の引数は画面ではなく $DOCKER_CALLS に残るので、そちらを調べる
@test "stop.sh は引数を受け付けない"    { run scripts/stop.sh -v; assert_failure; }
@test "reset.sh は RESET 以外の入力で何も消さない" { run bash -c 'echo yes | scripts/reset.sh'; assert_failure; [ ! -s "$DOCKER_CALLS" ] || ! grep -q "down" "$DOCKER_CALLS"; }
@test "reset.sh --dry-run は消す対象を表示し docker を変更系で呼ばない" { run scripts/reset.sh --dry-run; assert_output --partial "local-llm-chat_ollama-models"; ! grep -qE "compose .*(down|kill)|buildx rm|image rm|volume rm" "$DOCKER_CALLS"; }
@test "reset.sh は --with-images が無ければ ollama イメージを消さない" { run bash -c 'echo RESET | scripts/reset.sh'; ! grep -q "image rm ollama/ollama" "$DOCKER_CALLS"; }
@test "start.sh は frontend 起動済みなら up.sh を呼ばずブラウザだけ開く"
@test "start.sh はポート 3000 使用中なら原因と対処の 2 行を出して失敗"
@test "lib.sh fail は ✖ と → の 2 行を出し exit 1"
@test "reset.sh を LLM_APP_ROOT=一時ディレクトリで実行すると、そこの data/ だけが消える"
```

- [ ] **Step 0.5: 失敗を確認**　Run: `scripts/tests/run.sh`　Expected: FAIL（スクリプト未作成）
- [ ] **Step 1: `start.sh`**：`cd "$LLM_APP_ROOT"` → `require_docker` → `.env` が無ければ `.env.example` からコピー → `.env` の `PORT`（無ければ 3000）を `grep '^PORT='` で読む（`.env` を `source` しない。以下 `$PORT`）→ 既に `frontend` が running ならブラウザを開いて終了 → ポート `$PORT` 使用中（`ss -ltn`）なら fail → `"$LLM_SCRIPTS_DIR/up.sh"`（`data/` はここで `mkdir -p` する。コンテナの `node` ユーザー＝UID 1000 で書けるよう、Docker に作らせない）→ `curl localhost:$PORT/api/health` を 2 秒間隔・最大 2 分、待ち中は経過秒を表示 → `"$WIN_CMD" /c start http://localhost:$PORT`（`WIN_CMD` 既定 `/mnt/c/Windows/System32/cmd.exe`。`appendWindowsPath=false` のため絶対パス）
- [ ] **Step 2: `stop.sh`**：`docker compose stop` → `docker compose down`（`-v` を付けない）→ 下の Step 4 の常駐プロセスを `pkill -f '^local-llm-chat-keepalive'` で終わらせる（見つからなくても成功扱い）。引数は受け付けない
- [ ] **Step 3: `reset.sh`**：対象一覧と合計サイズを表示（`docker system df -v` から volume `local-llm-chat_ollama-models` のサイズ、`du -sh data/`）→ `RESET` 入力で実行（それ以外の入力なら何もせず exit 1）：`docker compose --project-directory "$LLM_APP_ROOT" kill` → `docker compose --project-directory "$LLM_APP_ROOT" down -v --rmi local --remove-orphans` → `data/sessions/*`・`data/cache/*`・`data/tmp/*` を削除（spec 8.5 の「ダウンロード中の印」は、この設計ではサーバーのメモリにしか無いのでファイルは消さなくてよい。「中断したダウンロードの残り」は ollama の volume ごと消える） → `docker buildx rm -f local-llm-chat`（専用ビルダーとそのビルドキャッシュを削除）→ `stop.sh` と同じく常駐プロセスを終わらせる→ E2E の残り（`docker compose -f compose.yaml -f compose.e2e.yaml -p local-llm-chat-e2e down -v --rmi all`。`-f` で E2E 用ファイルも読ませないと、そこでだけ定義した volume `e2e-data` が消えない。`--rmi all` は、偽 Ollama のイメージに名前を付けているため `local` では消えないから。E2E プロジェクトのイメージは偽 Ollama と E2E 用 frontend だけなので、本物の Ollama イメージは消えない）も削除 → `--with-images` のときだけ `docker image rm ollama/ollama:<タグ>`（タグは `docker compose config --images` から取る。`compose.yaml` を書き換えても追従するため）。最後に消えたものと「次は start で初回と同じように起動できます」を表示。`--dry-run` のときは一覧表示だけで終了（テストと事前確認用）
- [ ] **Step 4: `install-windows-shortcuts.sh`**：Windows のデスクトップに 3 つの `.bat` を生成。デスクトップの場所は `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"` で取得し、末尾の `\r` を除いて `wslpath` で変換する（`%USERPROFILE%\Desktop` 決め打ちだと OneDrive にデスクトップを移している PC で見えない場所に置かれるため。UTF-8 指定は日本語のユーザー名で文字化けしないため）。中身は `wsl.exe -d <生成時の $WSL_DISTRO_NAME の値> --cd <repo の絶対パス> bash scripts/<x>.sh` と `pause`（`%WSL_DISTRO_NAME%` は Windows 側に存在しないため、生成時に値を埋め込む）。
  - **WSL を止めないための常駐**：WSL は、Windows 側から起動した `wsl.exe` がすべて終わると、systemd のサービス（Docker）が動いていてもディストリビューションを止める。そのため `.bat` のウィンドウを閉じた数十秒後に、アプリも止まる（開発中は Claude Code や端末が WSL を開いているので気づきにくい）。`LocalLLM-start.bat` は `start.sh` が成功したら、`powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process wsl.exe -WindowStyle Hidden -ArgumentList '-d','<distro>','--cd','<repo>','--exec','bash','scripts/keepalive.sh'"` で、見えない常駐プロセスを 1 つだけ起動する。`scripts/keepalive.sh` は `pgrep -f '^local-llm-chat-keepalive' >/dev/null && exit 0; exec -a local-llm-chat-keepalive sleep infinity`（2 回目以降は既存があるので何もしない）。処理をスクリプトに分けるのは、`Start-Process -ArgumentList` が空白を含む引数を引用符で囲まずにつなぐため、`bash -c '…'` の形だと中身が分解されて動かないから（`<repo>` に空白があれば生成時に中止する）。`stop.sh` がこれを終わらせる。端末から `start.sh` を直接使う場合は、端末を開いている間だけ動く（README に書く）`.bat` は改行を CRLF で書き（`printf '...\r\n'`）、文字化けを避けるため中身は英数字のみにする（`reset` は入力が要るのでウィンドウを残す）
- [ ] **Step 5: テスト通過を確認**　Run: `scripts/tests/run.sh`　Expected: shellcheck エラーなし、bats 全件 PASS
- [ ] **Step 5.5: 実機確認**　Run: `scripts/stop.sh && scripts/start.sh && scripts/start.sh && scripts/reset.sh --dry-run`　Expected: `start` で health 待ち後ブラウザが開く、2 回目の `start` は起動し直さない、`--dry-run` は何も消さない
- [ ] **Step 5.6: 常駐の確認をユーザーに依頼**：Windows で `LocalLLM-start.bat` を実行してウィンドウを閉じ、WSL の端末もすべて閉じて 2 分待ってから、ブラウザで `http://localhost:3000` が開けること。続けて `LocalLLM-stop.bat` の後に `wsl.exe -l --running`（PowerShell）で、しばらくするとディストリビューションが止まること（常駐が残っていない確認）
- [ ] **Step 6: Commit**

### Task 12: E2E テスト（偽 Ollama サーバー＋Playwright）とスモークテスト

**Files:**
- Create: `e2e/mock-ollama/server.mjs`（Node 標準の `http` のみ、依存なし）、`e2e/mock-ollama/Dockerfile`、`scripts/e2e.sh`、`compose.e2e.yaml`：
  - `ollama`：`build: ./e2e/mock-ollama`、`image: local-llm-chat-e2e-mock-ollama`（**必須**。上書きしないと `compose.yaml` の `image: ollama/ollama:<タグ>` の名前で偽サーバーがビルドされ、本番の Ollama イメージが偽物に置き換わる）、`gpus: !reset null`、`mem_limit: !reset null`、`healthcheck: !reset null`、`volumes: !reset []`（GPU の無い CI でも動かすため）、操作用に `ports: ["127.0.0.1:11500:11434"]`（Playwright から `/__mock/*` を呼ぶため。E2E のみ）
  - `frontend`：`ports: !override ["127.0.0.1:3100:3000"]`（本番の 3000 と衝突させない）、`volumes: !override ["e2e-data:/app/data", "./e2e/models.e2e.yaml:/app/models.yaml:ro"]`（トップレベルに `volumes: { e2e-data: {} }`）、`environment`（マップ形式）：`IDLE_TIMEOUT_SEC: "3"`, `DISCOVERY_ENABLED: "false"`（外部サイトに出ず、結果を毎回同じにするため）, `DEFAULT_MODEL: gemma4:e4b`, `NUM_CTX: "8192"`, `CONTEXT_WARN_RATIO: "0.8"`, `TIER_COMFORT_MAX_GB: "7"`, `TIER_EXCLUDE_MIN_GB: "20"`, `SESSION_LIMIT: "10"`（利用者の `.env` を書き換えていても E2E の期待値が変わらないよう、テストが前提にする値はすべて上書きする）
- Create: `e2e/models.e2e.yaml`：`families: []`、`models: [{ name: "gemma4:e4b", sizeGb: 6.6 }, { name: "tiny-dl:1b", sizeGb: 0.05 }, { name: "slow-dl:8b", sizeGb: 8 }]`。ダウンロードの E2E は `tiny-dl:1b` を使う（本番の `models.yaml` の `gemma4:12b`（8GB）だと、空き容量チェックに 8.8GB 必要になり、空きの少ない CI ランナーで 507 になって失敗するため）。`slow-dl:8b` は「遅くなります」の表示確認用
- Create: `frontend/playwright.config.ts`（E2E 用：`testDir: "e2e"`、`testIgnore: "smoke/**"`、`baseURL: http://localhost:3100`、**`workers: 1`・`fullyParallel: false`**（偽 Ollama とサーバー側のダウンロード状態は全テストで 1 つを共有するため、並列に動かすと互いの状態を壊す））、`frontend/playwright.smoke.config.ts`（`testDir: "e2e/smoke"`、`baseURL: http://localhost:3000`）、`frontend/e2e/helpers.ts`、`frontend/e2e/{chat,models,sessions,attachments,recovery}.spec.ts`、`frontend/e2e/fixtures/{sample.png,sample.gif,cache/discovery.json}`、`frontend/e2e/smoke/real-ollama.spec.ts`
  - 10MB 超・9MB の画像は fixture としてコミットせず、テスト内で `Buffer` から作って `setInputFiles({ name, mimeType, buffer })` で渡す（リポジトリを重くしないため）
  - `helpers.ts` の `resetAll()`（各 spec の `beforeEach` で呼ぶ）：① `POST http://localhost:11500/__mock/reset` ② `DELETE http://localhost:3100/api/models/download`（前のテストのダウンロード状態 error/done/running を `idle` に戻す。サーバーのメモリに残るため）③ `docker compose -f ../compose.yaml -f ../compose.e2e.yaml -p local-llm-chat-e2e exec -T frontend sh -c 'rm -rf /app/data/sessions /app/data/cache && mkdir -p /app/data/cache'`（node ユーザーで作る）④ 必要な spec だけ `docker compose -f ../compose.yaml -f ../compose.e2e.yaml -p local-llm-chat-e2e cp e2e/fixtures/cache/discovery.json frontend:/app/data/cache/discovery.json`（`cp` は親フォルダが無いと失敗するため ③ の後に行う）。コマンドは `node:child_process` の `execFileSync` で呼ぶ（Playwright は `frontend/` で動くため、compose ファイルは `../` で指す）
- Modify: `frontend/package.json`（`npm i -D @playwright/test` の後、`"test:e2e": "bash ../scripts/e2e.sh"`、`"test:smoke": "playwright test -c playwright.smoke.config.ts"`）

**Interfaces:**
- Consumes: 画面全体（Task 9・10）、`ChatEvent` と各 API（Task 3–8）
- Produces: 偽サーバーの操作用 API（テストからのみ呼ぶ。`/__mock/*` は本物の Ollama に存在しないパス）
  - `POST /__mock/reset`：初期状態に戻す（installed = `gemma4:e4b`(6.6e9, capabilities `["completion","vision","thinking"]`)、`text-only:1b`(1e9, `["completion"]`)。down 状態も解除し、script・pull の設定も既定に戻す）。サーバー起動時もこの状態で始まる（frontend の起動時処理がデフォルトモデルを入っていると判断し、自動 DL を始めないため）
  - 既定の応答（script を指定しないとき）：`thinking` なし、`content: "OK"`、`chunkDelayMs: 20`。既定の pull：`totalBytes: 5e7`、`stepMs: 100`
  - `POST /__mock/script { thinking?: string; content: string; chunkDelayMs?: number; dropAfterChunks?: number; promptEvalCount?: number; failWith?: string }`：次の `/api/chat` の応答内容（`dropAfterChunks` は N チャンク送った時点で**先に down 状態に入ってから**接続を切る。コンテナごと落ちた状態の再現。接続を切るだけだと、frontend が直後に `isUp()` で確かめたとき偽サーバーがまだ生きていて `failed` に分類され、テストが `/__mock/down` を呼ぶタイミング次第で結果が変わるため。`failWith` は Ollama と同じ形のエラー JSON（HTTP 500・本文 `{"error": "…"}`）を返す。ストリーム途中のエラー行は Task 8 の単体テストで確認する。例 `"model runner has unexpectedly stopped"`）
  - `POST /__mock/down` / `POST /__mock/up`：`/api/version` を含む全 API の停止・復帰（OOM 再起動の再現）。停止中は `/__mock/*` 以外のリクエストに応答せず `req.socket.destroy()` で切る（実機の接続拒否・切断と同じく fetch が例外になるようにするため。503 を返すと `ollama_down` ではなく `failed` の経路を通ってしまう）。停止した瞬間に流れている `/api/chat` の応答も切る
  - `POST /__mock/pull { totalBytes: number; stepMs: number; failAt?: number }`：次の `/api/pull` の進捗の出方。完了したらそのモデルを installed に加え（サイズ `totalBytes`、capabilities `["completion"]`）、`DELETE /api/delete` で installed から外す（完了後の一覧更新・削除の E2E のため）
  - 本物と同じ形で応答するもの：`GET /api/version`、`GET /api/tags`、`POST /api/show`、`POST /api/chat`（NDJSON）、`POST /api/pull`（NDJSON）、`DELETE /api/delete`
  - モデル検索の表示は、固定のキャッシュ `frontend/e2e/fixtures/cache/discovery.json`（`{ fetchedAt, families: [], models }`。`gemma4:e2b`(7.2e9)・`gemma4:31b`(20.1e9) を含む）を `helpers.ts` の手順 ④ で配置して確認する

- [ ] **Step 1: 偽サーバーを作り、単体で確認**　Run: `node e2e/mock-ollama/server.mjs & MOCK_PID=$!; sleep 1; curl -s localhost:11434/api/tags; curl -sN -XPOST localhost:11434/api/chat -d '{"model":"gemma4:e4b","messages":[],"stream":true}'; kill $MOCK_PID`　Expected: tags に 2 件、chat は NDJSON で `done:true` まで流れる
- [ ] **Step 2: E2E テストを書く**（各 spec の `beforeEach` で `resetAll()`）

```ts
// chat.spec.ts
test("送信すると応答が逐次表示され、完了後にプルダウンが 🔒 になる")
test("思考過程が『考え中…（クリックで展開）』で折りたたまれ、クリックで開く")
test("表・チェックボックス・言語付きコードブロック（コピーボタン）が整形表示される")
test("mermaid ブロックは完了後に svg になり、壊れた mermaid はコードのまま")
test("<script>alert(1)</script> を含む応答で dialog が発生しない")
test("[停止] で応答が止まり（中断）が付く")
test("chunkDelayMs が IDLE_TIMEOUT_SEC を超えると打ち切り文言が出る")   // compose.e2e.yaml で IDLE_TIMEOUT_SEC=3
test("promptEvalCount が NUM_CTX×0.8 以上で長さ警告が出て、送信は可能")
// models.spec.ts
test("未DLモデル（tiny-dl:1b）選択→ダイアログ→ダウンロード→進捗→完了で一覧更新・選択状態")
test("slow-dl:8b は一覧とダイアログに『遅くなります』が付く")
test("ダウンロード中は [中止] 以外が押せず、[中止] で解除")
test("ダウンロード中にリロードしても進捗ダイアログが再表示される")            // Review Focus 2
test("pull 失敗（failAt）でエラー文が出て操作禁止が解除される")
test("選択中モデルを削除→確認→デフォルトモデルに切替。デフォルトはゴミ箱 disabled")
test("（！）で models.yaml の説明が出る")
test("discovered の gemma4:e2b は出て、excluded サイズの gemma4:31b は出ない")
// sessions.spec.ts
test("リロード後もセッション一覧と会話が残る")
test("11 件目作成で最古が消える")
test("古いセッションを開いて続けると一覧の先頭に上がり、次の作成で消されない")   // spec 11-6。「表示中は消さない」の単体確認は Task 7 の keepId テスト
test("一覧のゴミ箱→確認でセッションが消える")
test("削除済みモデルのセッションは入力欄 disabled と説明文")                   // Review Focus 3
// attachments.spec.ts
test("PNG を📎・ドラッグ＆ドロップ・貼り付けで添付し、送信後も画像が表示される")
test("GIF・10MB 超・5 枚目は拒否される")
test("9MB の PNG 4 枚を一度に送っても受け付けられる")   // 本文サイズ上限の確認
test("text-only:1b では📎が disabled")
// recovery.spec.ts
test("dropAfterChunks で応答中に偽サーバーごと停止 → バナー表示、途中応答は（中断）で残る、/__mock/up でバナーが消え送信できる")  // Review Focus 1
test("偽サーバーが down のまま画面を開いても表示され、削除済み表示やダウンロードダイアログは出ず、up 後にモデル一覧が出る")   // Review Focus 5
test("failWith でモデルの実行プロセス停止を再現 → バナー表示 → 自動で消え、再送できる")
```

- [ ] **Step 3: 失敗を確認**　Run: `cd frontend && npm run test:e2e`　Expected: 未実装・不具合のあるものが FAIL（Task 9・10 完了済みなら、ここで見つかった不具合を直す）
- [ ] **Step 4: 不具合を直し、全件 PASS を確認**　Run: `npm run test:e2e`　Expected: 全件 PASS。`test:e2e` は `bash ../scripts/e2e.sh` を呼ぶ。`e2e.sh`：`source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"` → `cd "$LLM_APP_ROOT"` → `ensure_builder` → `docker compose -f compose.yaml -f compose.e2e.yaml -p local-llm-chat-e2e up -d --build` → `http://localhost:3100/api/health` を待つ → `(cd frontend && npx playwright test "$@")` → 成否にかかわらず `docker compose -f compose.yaml -f compose.e2e.yaml -p local-llm-chat-e2e down -v`（`trap`。`-f` を省くと `e2e-data` が消えない）。本番のデータ・volume・ポートに触れない
- [ ] **Step 5: スモークテスト（実 Ollama・GPU）を書いて実行**　`real-ollama.spec.ts`：`gemma4:e4b` に「1+1は？」→ 60 秒以内に応答が完了する／`sample.png` を添付して応答が返る。Run: `scripts/start.sh && cd frontend && npm run test:smoke`　Expected: PASS
- [ ] **Step 6: Commit**

### Task 13: CI（GitHub Actions）

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: ワークフローを書く**：`push` と `pull_request` で、`actions/checkout` は `submodules: true`（bats を取得するため）、Node のジョブは `working-directory: frontend`。ジョブ ① `unit`：Node 22 → `npm ci` → `npm test -- --coverage`（`frontend/lib` 80% 未満で失敗）→ `npm run lint`、② `scripts`：`scripts/tests/run.sh`、③ `e2e`：Node 22 → `npm ci` → `npx playwright install --with-deps chromium` → `npm run test:e2e`（`.env` が無い状態で動くこと＝`env_file` の `required: false` の確認も兼ねる）、失敗時は Playwright レポートを artifact に保存。スモークは CI で実行しない（GPU が無いため）
- [ ] **Step 2: push して確認**　Run: `git push && gh run watch`　Expected: 3 ジョブとも成功
- [ ] **Step 3: CLAUDE.md のテストコマンドが実際と一致しているか確認し、違えば直す**（README は Task 14 で作る）
- [ ] **Step 4: Commit**

### Task 14: 完成確認（spec 9 章）と README

**Files:**
- Create: `README.md`（前提、`setup.sh` → `start` の手順、`.env` 項目、`models.yaml` の書き方、スクリプト一覧、テストの実行方法）

- [ ] **Step 1: README を書く**
- [ ] **Step 2: spec 9 章の 1・2 を実行**　Run: `curl -s -o /dev/null -w "%{http_code}\n" localhost:3000 && /mnt/c/Windows/System32/curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000`　Expected: `200` と `200`
- [ ] **Step 3: 全テストを実行**　Run: `cd frontend && npm test && npm run test:e2e && npm run test:smoke && cd .. && scripts/tests/run.sh`　Expected: すべて PASS
- [ ] **Step 3.5: spec 9 章の 3 を実機の画面で確認**（Playwright でスクリーンショットを残す。チャット、DL と中止、削除とデフォルトへの切替、リロード後の履歴、画像添付）
- [ ] **Step 4: 高負荷確認（9 章の 6）**：`.env` を `OLLAMA_MEM_LIMIT=6g` にして `scripts/up.sh` → `gemma4:26b`（約 18GB。大半が CPU 側に載るため上限に確実に当たる）でチャット → Expected：次のいずれかになり、どちらでも画面にバナーが出て復帰後に消える。(a) Ollama が読み込みを拒否またはモデルの実行プロセスが落ちる（`too_heavy`）、(b) コンテナごと OOM で再起動（`docker compose ps` の RESTARTS が増える、`ollama_down`）。この間 WSL のシェルと Windows が操作できること。終わったら `24g` に戻して `scripts/up.sh`
- [ ] **Step 5: ユーザーに依頼**：Windows で `LocalLLM-start.bat` / `LocalLLM-stop.bat` / `LocalLLM-reset.bat` をダブルクリックして 9 章の 4・5 を確認してもらう
- [ ] **Step 6: CLAUDE.md の最終確認**：コマンド表とルールが実装と一致しているか見直す
- [ ] **Step 7: Commit & push**　`git add -A && git commit -m "docs: README を追加" && git push`

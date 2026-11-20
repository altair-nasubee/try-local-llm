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
- compose のプロジェクト名は `local-llm-chat` 固定（reset.sh がこの名前で対象を絞る）
- `.env` の項目と既定値：`DEFAULT_MODEL=gemma4:e4b` / `OLLAMA_MEM_LIMIT=24g` / `IDLE_TIMEOUT_SEC=180` / `NUM_CTX=8192` / `CONTEXT_WARN_RATIO=0.8` / `TIER_COMFORT_MAX_GB=7` / `TIER_EXCLUDE_MIN_GB=20` / `DISCOVERY_TTL_HOURS=24` / `SESSION_LIMIT=10` / `BIND_ADDRESS=127.0.0.1` / `PORT=3000`
- 負荷区分：サイズ ≤ 7GB → `comfort`、7GB < サイズ < 20GB → `slow`、≥ 20GB → `excluded`（一覧に出さない）。1GB = 1e9 bytes
- 画像：PNG / JPEG / WebP、1 枚 10MB まで、1 回 4 枚まで
- 応答に含まれる HTML は描画しない（`rehype-raw` を使わない）
- `stop.sh` はデータを消すオプションを持たない。`reset.sh` は `RESET` 入力時のみ実行
- 各コミットの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Ollama がチャット中に OOM で落ちる**（7.3）→ 途中までの応答が `interrupted: true` で保存され、画面は「再起動中」バナー → health 復帰で解除。Task 8 / Task 10 にテストを置く
2. **ダウンロード中にブラウザをリロード**（6.2）→ 進捗ダイアログが再表示され、操作禁止が継続。Task 5（サーバー状態）/ Task 9（初期表示で状態取得）にテスト
3. **削除済みモデルの過去セッションを開く**（6.5）→ 入力欄無効＋説明表示。Task 10 にテスト
4. **ストリーミング途中の未完 mermaid フェンス／壊れた mermaid**（6.4）→ コードのまま表示、例外を出さない。Task 10 にテスト
5. **起動直後に Ollama がまだ応答しない**（デフォルトモデル自動 DL）→ 自動 DL はリトライし、画面の `/api/models` は Ollama 停止時も 200 で `ollamaUp: false` を返す。Task 3 / Task 5 にテスト

---

## ファイル構成

```
.
├── compose.yaml
├── .env.example
├── models.yaml
├── scripts/
│   ├── setup.sh              # Docker Engine + NVIDIA Container Toolkit 導入（ユーザーが sudo で実行）
│   ├── lib.sh                # 共通関数（色付き出力、前提チェック）
│   ├── start.sh / stop.sh / reset.sh
│   └── install-windows-shortcuts.sh   # start/stop/reset.bat をデスクトップに生成
└── frontend/
    ├── Dockerfile
    ├── next.config.ts
    ├── middleware.ts         # 認証差し込み口（今回は素通し）
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
  | { type: "error"; code: "timeout" | "ollama_down" | "failed" | "busy"; message: string };
```

---

### Task 1: 環境構築スクリプト（Docker Engine + NVIDIA Container Toolkit）

**Files:**
- Create: `scripts/lib.sh`, `scripts/setup.sh`

**Interfaces:**
- Produces: `scripts/lib.sh` の関数 `info <msg>` / `ok <msg>` / `fail <msg> <対処>`（`fail` は exit 1）/ `require_docker` / `require_gpu_in_docker`。Task 11 が使う

- [ ] **Step 1: `scripts/lib.sh` を作る**。`fail` は「✖ 原因」「→ 対処」の 2 行を出す。`require_docker`：`docker` が無ければ `fail "Docker が見つかりません" "scripts/setup.sh を実行してください"`、デーモン停止なら `sudo systemctl start docker` を試す。`require_gpu_in_docker`：`docker run --rm --gpus all ubuntu nvidia-smi -L` が失敗したら fail
- [ ] **Step 2: `scripts/setup.sh` を作る**。Docker 公式手順（apt リポジトリ追加 → `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`）、`usermod -aG docker $USER`、`systemctl enable --now docker`、NVIDIA 公式手順（`nvidia-container-toolkit` 導入 → `nvidia-ctk runtime configure --runtime=docker` → docker 再起動）。各段階の前に導入済みかを確認してスキップ（再実行しても安全）。最後に `docker run --rm --gpus all ubuntu nvidia-smi -L` の結果を表示
- [ ] **Step 3: 構文チェック**　Run: `bash -n scripts/lib.sh scripts/setup.sh && shellcheck scripts/*.sh`（shellcheck が無ければ `sudo apt install -y shellcheck` をユーザーに依頼）　Expected: エラーなし
- [ ] **Step 4: ユーザーが実行する**（sudo パスワードが必要なため実装者は実行しない）。ユーザーに `sudo bash scripts/setup.sh` を依頼し、終了後 WSL を開き直してもらう
- [ ] **Step 5: 確認**　Run: `docker run --rm --gpus all ubuntu nvidia-smi -L`　Expected: `GPU 0: NVIDIA GeForce RTX 5070 Laptop GPU` を含む
- [ ] **Step 6: Commit**　`git add scripts/ && git commit -m "chore: 環境構築スクリプトを追加"`

### Task 2: プロジェクトの土台（Next.js・compose・設定・i18n・テーマ）

**Files:**
- Create: `frontend/`（create-next-app）、`frontend/Dockerfile`、`frontend/next.config.ts`、`frontend/middleware.ts`、`frontend/lib/{config,i18n,theme,types}.ts`、`frontend/messages/ja.json`、`frontend/app/globals.css`、`compose.yaml`、`.env.example`、`models.yaml`
- Test: `frontend/lib/__tests__/config.test.ts`、`frontend/lib/__tests__/i18n.test.ts`

**Interfaces:**
- Produces:
  - `getConfig(): AppConfig`（`AppConfig = { ollamaUrl; defaultModel; numCtx; idleTimeoutSec; contextWarnRatio; tierComfortMaxGb; tierExcludeMinGb; discoveryTtlHours; sessionLimit; dataDir; modelsYamlPath }`。`ollamaUrl` 既定 `http://ollama:11434`、`dataDir` 既定 `/app/data`、`modelsYamlPath` 既定 `/app/models.yaml`）
  - `t(key: MessageKey, vars?: Record<string,string|number>): string`（`MessageKey = keyof typeof ja`、`{name}` 形式で置換）
  - `type Theme = "system" | "light" | "dark"`、`getTheme(): Theme`（常に `"system"`）
  - `lib/types.ts`（上記の共有型）

- [ ] **Step 1: 雛形作成**　`npx create-next-app@latest frontend --ts --app --eslint --no-tailwind --no-src-dir --import-alias "@/*"`、続けて `npm i -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom` と `npm i yaml`。`package.json` に `"test": "vitest run"`
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
// i18n.test.ts
it("変数を置換する", () => expect(t("download.confirmTitle", { name: "x" })).toBe("x はダウンロードされていません"));
```
（`getConfig(env = process.env)` として env を注入可能にする）

- [ ] **Step 3: 失敗を確認**　Run: `cd frontend && npm test`　Expected: FAIL（モジュール未定義）
- [ ] **Step 4: 実装**。`messages/ja.json` には spec の全文言を入れる（6.1 の（！）説明文、6.2/6.3 ダイアログ、6.4 警告「会話が長くなりました。新しいチャットをおすすめします」、6.5「このモデルは削除されています」、7.3「モデルが重すぎて停止しました。再起動中です」、思考「考え中…（クリックで展開）」、低速注記「遅くなります」）。`globals.css` はライト値を `:root` に、ダーク値を `@media (prefers-color-scheme: dark)` と `[data-theme="dark"]` に定義。`middleware.ts` は `NextResponse.next()` を返し、「認証はここに追加する」コメントを置く。`next.config.ts` に `output: "standalone"`
- [ ] **Step 5: テスト通過を確認**　Run: `npm test`　Expected: PASS
- [ ] **Step 6: Docker 一式**
  - `frontend/Dockerfile`：`node:22-bookworm-slim` のマルチステージ、standalone 出力をコピー、`EXPOSE 3000`、`USER node`
  - `compose.yaml`：`name: local-llm-chat`。`ollama`：`image: ollama/ollama:<固定タグ>`（`gh release view -R ollama/ollama --json tagName` で最新の安定版を調べて固定）、`gpus: all`、`mem_limit: ${OLLAMA_MEM_LIMIT:-24g}`、`restart: unless-stopped`、volume `ollama-models:/root/.ollama`、`healthcheck: ollama list`、ポート公開なし。`frontend`：`build: ./frontend`、`env_file: .env`、`ports: ["${BIND_ADDRESS:-127.0.0.1}:${PORT:-3000}:3000"]`、`volumes: ["./data:/app/data", "./models.yaml:/app/models.yaml:ro"]`、`restart: unless-stopped`、`depends_on: ollama`（`condition: service_started`。ollama 未起動でも frontend は動く必要があるため healthy 待ちにしない）
  - `.env.example`：Global Constraints の全項目
  - `models.yaml`：
```yaml
families: [gemma4, qwen3, llama3.1]
models:
  - { name: "gemma4:e4b", sizeGb: 6.6 }
  - { name: "gemma4:12b", sizeGb: 8.0 }
  - { name: "gemma4:26b", sizeGb: 18 }
```
- [ ] **Step 7: 起動確認**　Run: `cp .env.example .env && docker compose up -d --build && sleep 20 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 && docker compose exec ollama nvidia-smi -L`　Expected: `200` と GPU 名
- [ ] **Step 8: Commit**　`git add -A && git commit -m "feat: Next.js と compose の土台を追加"`

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
it("デフォルトモデルが excluded サイズでも一覧に残す")                 // 削除不可・起動時DL対象のため
```

- [ ] **Step 2: 失敗を確認**　Run: `npm test -- tiers catalog`　Expected: FAIL
- [ ] **Step 3: 実装**。`GET /api/models` は Ollama 停止時に例外を出さず `installed: []`・`ollamaUp: false` で 200 を返す（Review Focus 5）。capabilities は installed の各モデルに `showModel` を呼んで埋める（並列）
- [ ] **Step 4: テスト通過を確認**　Run: `npm test`　Expected: PASS
- [ ] **Step 5: 実機確認**　Run: `docker compose up -d --build && curl -s localhost:3000/api/models`　Expected: `gemma4:e4b` などを含む JSON、`"ollamaUp":true`
- [ ] **Step 6: Commit**

### Task 4: 起動時のモデル自動検索（discovery）

**Files:**
- Create: `frontend/lib/discovery.ts`
- Modify: `frontend/app/api/models/route.ts`（discovered を `buildCatalog` に渡す）
- Test: `frontend/lib/__tests__/discovery.test.ts`、fixture `frontend/lib/__tests__/fixtures/gemma4-tags.html`（`curl -s https://ollama.com/library/gemma4/tags` を保存）

**Interfaces:**
- Produces:
  - `parseTagNames(html: string, family: string): string[]`
  - `isStandardTag(tag: string): boolean`
  - `fetchManifestSize(family, tag, fetchFn = fetch): Promise<number | null>`（`GET https://registry.ollama.ai/v2/library/<family>/manifests/<tag>`、`Accept: application/vnd.docker.distribution.manifest.v2+json`、`layers[].size` の合計）
  - `getDiscovered(cfg, fetchFn = fetch): Promise<{name; sizeBytes}[]>`（キャッシュ `${dataDir}/cache/discovery.json` = `{ fetchedAt, models }`。`discoveryTtlHours` 以内ならキャッシュを返す。ネットワーク失敗時は古いキャッシュ、無ければ `[]`。例外を外に出さない）

- [ ] **Step 1: 失敗するテストを書く**

```ts
expect(parseTagNames(fixtureHtml, "gemma4")).toEqual(expect.arrayContaining(["e4b", "12b", "26b", "31b-mlx"]));
expect(["e2b","e4b","12b","26b","31b","1.5b","70b"].every(isStandardTag)).toBe(true);
expect(["latest","31b-cloud","12b-mlx","12b-it-q8_0","26b-a4b","12b-nvfp4","12b-mxfp8","31b-it-bf16"].some(isStandardTag)).toBe(false);
it("manifest の layers.size を合計する")            // fetchFn をモックし [100, 200] → 300
it("キャッシュが TTL 内なら fetch しない")
it("fetch が全て失敗してもキャッシュ無しなら [] を返す")
```
`isStandardTag` の判定は正規表現 `/^e?\d+(\.\d+)?b$/`。

- [ ] **Step 2: 失敗を確認**　Run: `npm test -- discovery`　Expected: FAIL
- [ ] **Step 3: 実装**。`parseTagNames` は `href="/library/<family>:<tag>"` を抽出し重複除去。manifest 取得は family ごとに直列、全体 30 秒で打ち切り
- [ ] **Step 4: テスト通過を確認**　Expected: PASS
- [ ] **Step 5: 実機確認**　Run: `docker compose up -d --build && curl -s localhost:3000/api/models | grep -o '"source":"discovered"' | head -3 && ls data/cache/discovery.json`　Expected: discovered が 1 件以上、キャッシュファイルあり
- [ ] **Step 6: Commit**

### Task 5: ダウンロード管理（進捗・中止・空き容量・起動時自動 DL）

**Files:**
- Create: `frontend/lib/downloads.ts`、`frontend/lib/disk.ts`、`frontend/app/api/models/download/route.ts`、`frontend/instrumentation.ts`
- Modify: `frontend/lib/ollama.ts`（`pull` 追加）
- Test: `frontend/lib/__tests__/downloads.test.ts`、`frontend/lib/__tests__/disk.test.ts`

**Interfaces:**
- Consumes: `classifyTier`、`getConfig`
- Produces:
  - `ollama.pull(name, signal): AsyncIterable<{status:string; completed?:number; total?:number; error?:string}>`（`POST /api/pull`、`stream: true`、NDJSON をパース）
  - `getDownloadManager(): DownloadManager`（`globalThis.__downloadManager` に保持）
    - `state(): DownloadState`
    - `start(model: string, expectedBytes: number | null): { ok: true } | { ok: false; code: "busy" | "disk" ; message: string }`
    - `cancel(): void`
    - `isBusy(): boolean`
  - `freeBytes(path: string): Promise<number>`（`fs.statfs`、`bavail * bsize`）
  - API：`GET /api/models/download` → `DownloadState`、`POST { model }` → 202 / 409(busy) / 507(disk)、`DELETE` → 中止
  - 他の変更系 API（チャット送信・モデル削除・セッション削除）は `isBusy()` のとき 409 を返す（Task 6–8 で使用）

- [ ] **Step 1: 失敗するテストを書く**（`pull` をモック）

```ts
it("進捗を state に反映し、完了で done になる")
it("実行中に start すると busy を返す")
it("空き容量 < expectedBytes * 1.1 なら disk を返し開始しない")
it("cancel で AbortSignal が発火し state が idle に戻る")
it("pull が error 行を返したら state は error（message 付き）")
it("done/error の後の start は受け付ける")
```

- [ ] **Step 2: 失敗を確認**　Expected: FAIL
- [ ] **Step 3: 実装**。空き容量は `getConfig().dataDir` に対して `freeBytes`（ollama volume と同じ WSL 仮想ディスク上にあるため。spec 11-3）。`instrumentation.ts` の `register()`（`process.env.NEXT_RUNTIME === "nodejs"` のときのみ）で、`isUp()` を 5 秒間隔・最大 10 分待ち、デフォルトモデルが未インストールなら `start(defaultModel, null)`
- [ ] **Step 4: テスト通過を確認**　Expected: PASS
- [ ] **Step 5: 実機確認**　Run: `curl -s -XPOST localhost:3000/api/models/download -H 'content-type: application/json' -d '{"model":"gemma4:e2b"}'; sleep 3; curl -s localhost:3000/api/models/download; curl -s -XDELETE localhost:3000/api/models/download; curl -s localhost:3000/api/models/download`　Expected: `running` の進捗 → 中止後 `idle`
- [ ] **Step 6: Commit**

### Task 6: モデル削除 API

**Files:**
- Create: `frontend/app/api/models/[name]/route.ts`
- Test: `frontend/app/api/models/__tests__/delete.test.ts`

**Interfaces:**
- Consumes: `ollama.deleteModel`、`getDownloadManager().isBusy()`、`getConfig().defaultModel`
- Produces: `DELETE /api/models/:name`（name は `encodeURIComponent`）→ 204 / 400(`default_model`) / 409(`busy`)

- [ ] **Step 1: 失敗するテストを書く**：「デフォルトモデルは 400」「ダウンロード中は 409」「通常は deleteModel を呼び 204」
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: PASS を確認**
- [ ] **Step 5: Commit**

### Task 7: セッション保存（ファイル・10 件保持・画像）

**Files:**
- Create: `frontend/lib/sessions.ts`、`frontend/app/api/sessions/route.ts`、`frontend/app/api/sessions/[id]/route.ts`、`frontend/app/api/sessions/[id]/images/[file]/route.ts`
- Test: `frontend/lib/__tests__/sessions.test.ts`（一時ディレクトリを `dataDir` に使う）

**Interfaces:**
- Produces（保存形式：`${dataDir}/sessions/<id>/session.json` と同フォルダの画像）：
  - `createSession(model: string, firstUserText: string): Promise<Session>`（id は `YYYYMMDD-HHmmss-<6桁ランダム>`、title は `firstUserText` の空白を詰めた先頭 20 文字、超えたら末尾 `…`）
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
it("images の file に ../ を含むと 400")
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
  - `ollama.chat({ model, messages, think, numCtx }, signal): AsyncIterable<OllamaChatChunk>`（`POST /api/chat`、`stream: true`、`options: { num_ctx }`、メッセージの `images` は base64）
  - `streamWithIdleTimeout<T>(src: AsyncIterable<T>, idleMs: number, signal): AsyncIterable<T>`（チャンク間・最初のチャンクまでの無応答が `idleMs` を超えたら `IdleTimeoutError` を投げる）
  - `POST /api/chat`（`multipart/form-data`：`sessionId?`、`model`、`content`、`images[]`）→ `application/x-ndjson` の `ChatEvent` ストリーム
    - 新規なら最初に `{type:"session"}` を送る
    - `think` は対象モデルの capabilities に `"thinking"` があるときだけ `true`
    - 完了時 `contextTokens = prompt_eval_count + eval_count`、`warn = contextTokens >= numCtx * contextWarnRatio`、`session.lastContextTokens` に保存
    - クライアント切断（`request.signal` abort）・タイムアウト・Ollama 切断のいずれでも、途中までの応答を `interrupted: true` で保存する
    - エラーコード：タイムアウト → `timeout`、接続断かつ `isUp()` が false → `ollama_down`、その他 → `failed`、ダウンロード中 → 送信前に 409
    - セッションのモデルが未インストールなら 409（閲覧のみ）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// chat-stream.test.ts
it("チャンク間が idleMs を超えたら IdleTimeoutError")
it("チャンクが来続ければ総時間が idleMs を超えても切らない")
// route.test.ts（ollama.chat をモック）
it("thinking と content を別イベントで流し、done に contextTokens と warn を入れる")   // numCtx 8192, 7000 → warn:true
it("途中で ollama.chat が ECONNRESET、isUp=false → error ollama_down、途中の応答が interrupted で保存")
it("request.signal を abort すると途中の応答が interrupted で保存")
it("capabilities に vision が無いモデルに画像を送ると 400")
it("画像 5 枚は 400")
```

- [ ] **Step 2–4: FAIL → 実装 → PASS**
- [ ] **Step 5: 実機確認**　Run: `curl -sN -F model=gemma4:e4b -F content=こんにちは localhost:3000/api/chat`　Expected: `session`→`content`…→`done` の NDJSON 行、`data/sessions/` にフォルダ作成
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
  - `useDownload(): { state: DownloadState; start(model): Promise<void>; cancel(): Promise<void> }`（`running` 中は 1 秒、それ以外は 5 秒間隔で `GET /api/models/download` をポーリング。`running`→`done` を検知したら `useModels().refresh()` を呼び、そのモデルを選択）
  - `useSessions(): { list: SessionSummary[]; refresh(); remove(id) }`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it("未DLモデルを選ぶと DownloadDialog（サイズと遅くなります注記付き）が開く")
it("デフォルトモデル選択中はゴミ箱が disabled")
it("会話中（currentSession にメッセージあり）はプルダウンが disabled で 🔒 表示")
it("（！）を押すと models.yaml の説明文が出る")
it("useDownload: 初回取得が running なら進捗ダイアログを開いた状態で始まる")   // Review Focus 2
it("locked 中は [中止] 以外のボタンが disabled")
it("削除確認で [削除する] → 選択中モデルならデフォルトモデルに切り替わる")
it("DownloadState が error ならダイアログにエラー文を出し、閉じると locked が解除される")
```

- [ ] **Step 2–4: FAIL → 実装 → PASS**。アイコンはインライン SVG（ゴミ箱、情報、クリップ、鍵）で `Icon` にまとめる。セッション行のゴミ箱は `ConfirmDialog` を通す
- [ ] **Step 5: 実機確認**　Run: `docker compose up -d --build` の後、Playwright で `http://localhost:3000` を開いてスクリーンショット　Expected: 左にセッション一覧、上にモデル選択と（！）とゴミ箱
- [ ] **Step 6: Commit**

### Task 10: チャット画面（Markdown・Mermaid・思考・警告・画像添付・閲覧のみ・復帰バナー）

**Files:**
- Create: `frontend/lib/markdown.ts`、`frontend/components/{ChatView,MessageBubble,MarkdownView,CodeBlock,MermaidBlock,ThinkingBlock,Composer,AttachmentTray,OllamaDownBanner}.tsx`、`frontend/hooks/useChat.ts`
- Test: `frontend/lib/__tests__/markdown.test.ts`、`frontend/components/__tests__/{MarkdownView,Composer,ChatView}.test.tsx`

**Interfaces:**
- Consumes: `UiState`、`useModels`、`POST /api/chat`、`GET /api/health`
- Produces:
  - `hasOpenFence(md: string): boolean`（行頭 ```` ``` ```` の個数が奇数なら true）
  - `useChat(sessionId): { messages; send(content, files: File[]); stop(); streaming: boolean; warn: boolean; ollamaDown: boolean }`（`stop` は fetch を abort。`error ollama_down` を受けたら `ollamaDown=true` にし、`/api/health` を 3 秒間隔で確認、`ollamaUp` で false に戻す）
  - `MarkdownView({ text, streaming })`：react-markdown + remark-gfm + rehype-highlight。`rehype-raw` は使わない。`code` レンダラで `language-mermaid` かつ「`streaming && hasOpenFence(text)` で最後のブロック」でなければ `MermaidBlock`、それ以外は `CodeBlock`（コピーボタン付き）
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
it("ollama_down を受けるとバナー表示、health が up でバナーが消える")                       // Review Focus 1
it("interrupted のメッセージに（中断）が付く")
```

- [ ] **Step 2–4: FAIL → 実装 → PASS**。添付は 📎 ボタン、ドラッグ＆ドロップ、`paste` イベントの 3 経路。送信前はサムネイル（`URL.createObjectURL`）と ✕
- [ ] **Step 5: 実機確認**（Playwright）：`gemma4:e4b` に「mermaid でフローチャートを書いて」→ 図が描画される／画像を添付して説明が返る／[停止] で（中断）表示
- [ ] **Step 6: Commit**

### Task 11: 起動・終了・リセットスクリプトと Windows ショートカット

**Files:**
- Create: `scripts/start.sh`、`scripts/stop.sh`、`scripts/reset.sh`、`scripts/install-windows-shortcuts.sh`
- Modify: `compose.yaml`（不要なら変更なし）

**Interfaces:**
- Consumes: `scripts/lib.sh`（Task 1）
- Produces: Windows デスクトップの `LocalLLM-start.bat` / `LocalLLM-stop.bat` / `LocalLLM-reset.bat`

- [ ] **Step 1: `start.sh`**：`cd` でリポジトリルートへ → `require_docker` → `.env` が無ければ `.env.example` からコピー → `mkdir -p data`（コンテナの `node` ユーザー＝UID 1000 で書けるようにするため、Docker に作らせない）→ 既に `frontend` が running ならブラウザを開いて終了 → ポート 3000 使用中（`ss -ltn`）なら fail → `docker compose up -d --build` → `curl localhost:3000/api/health` を 2 秒間隔・最大 2 分、待ち中は経過秒を表示 → `/mnt/c/Windows/System32/cmd.exe /c start http://localhost:3000`（`appendWindowsPath=false` のため絶対パス）
- [ ] **Step 2: `stop.sh`**：`docker compose stop` → `docker compose down`（`-v` を付けない）。引数は受け付けない
- [ ] **Step 3: `reset.sh`**：対象一覧と合計サイズを表示（`docker system df -v` から volume `local-llm-chat_ollama-models` のサイズ、`du -sh data/`）→ `RESET` 入力で実行：`docker compose kill` → `docker compose down -v --rmi local --remove-orphans` → `data/sessions/*`・`data/cache/*`・`data/tmp/*` を削除 → `docker builder prune -f --filter "label=com.docker.compose.project=local-llm-chat"`（Dockerfile に `LABEL com.docker.compose.project=local-llm-chat` を追加しておく。効かない場合は frontend イメージ削除で十分とし、その旨を出力）→ `--with-images` のときだけ `docker image rm ollama/ollama:<タグ>`。最後に消えたものと「次は start で初回と同じように起動できます」を表示
- [ ] **Step 4: `install-windows-shortcuts.sh`**：Windows のデスクトップ（`cmd.exe /c echo %USERPROFILE%` → `wslpath`）に 3 つの `.bat` を生成。中身は `wsl.exe -d %WSL_DISTRO_NAME% --cd <repo の絶対パス> bash scripts/<x>.sh` と `pause`（`reset` は入力が要るのでウィンドウを残す）
- [ ] **Step 5: 確認**　Run: `bash -n scripts/*.sh && shellcheck scripts/*.sh && scripts/stop.sh && scripts/start.sh`　Expected: shellcheck エラーなし、`start` で health 待ち後ブラウザが開く、2 回目の `start` は起動し直さない
- [ ] **Step 6: Commit**

### Task 12: 完成確認（spec 9 章）と README

**Files:**
- Create: `README.md`（前提、`setup.sh` → `start` の手順、`.env` 項目、`models.yaml` の書き方、スクリプト一覧）

- [ ] **Step 1: README を書く**
- [ ] **Step 2: spec 9 章の 1・2 を実行**　Run: `curl -s -o /dev/null -w "%{http_code}\n" localhost:3000 && /mnt/c/Windows/System32/curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000`　Expected: `200` と `200`
- [ ] **Step 3: spec 9 章の 3 を Playwright で確認**（チャット、DL と中止、削除とデフォルトへの切替、リロード後の履歴、画像添付）。各項目のスクリーンショットを残す
- [ ] **Step 4: 高負荷確認（9 章の 6）**：`.env` を `OLLAMA_MEM_LIMIT=6g` にして `docker compose up -d` → `gemma4:12b` でチャット → Ollama が OOM で再起動（`docker compose ps` の RESTARTS 増加）、画面にバナー → 復帰後に解除、WSL のシェルが操作可能。終わったら `24g` に戻す
- [ ] **Step 5: ユーザーに依頼**：Windows で `LocalLLM-start.bat` / `stop.bat` / `reset.bat` をダブルクリックして 9 章の 4・5 を確認してもらう
- [ ] **Step 6: Commit & push**　`git add -A && git commit -m "docs: README を追加" && git push`

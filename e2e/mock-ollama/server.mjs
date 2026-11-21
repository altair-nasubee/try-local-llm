// E2E 用の偽 Ollama サーバー（Node 標準の http だけで動く）。
// 本物と同じ形で /api/version・/api/tags・/api/show・/api/chat・/api/pull・/api/delete に応答し、
// テストからは /__mock/* で応答内容・ダウンロードの進み方・停止／復帰を操作する。
import http from "node:http";

const PORT = Number(process.env.PORT ?? 11434);
// コンテナの中では 0.0.0.0（公開先は compose.e2e.yaml で 127.0.0.1 に絞る）。コンテナの外で動かすときは 127.0.0.1 を渡す
const HOST = process.env.HOST ?? "0.0.0.0";

const DEFAULT_SCRIPT = { content: "OK", chunkDelayMs: 20 };
const DEFAULT_PULL = { totalBytes: 5e7, stepMs: 100 };

let state;
function reset() {
  state = {
    installed: new Map([
      ["gemma4:e4b", { size: 6.6e9, capabilities: ["completion", "vision", "thinking"] }],
      ["text-only:1b", { size: 1e9, capabilities: ["completion"] }],
    ]),
    down: false,
    script: null, // 次の /api/chat だけに使う
    pull: { ...DEFAULT_PULL },
    lastChat: null,
  };
}
reset();

// 停止したときに切るため、流れている応答を覚えておく
const activeSockets = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// 文字列を 4 文字ずつのチャンクに分ける（サロゲートペアを切らない）
function pieces(text, size = 4) {
  const chars = Array.from(text ?? "");
  const out = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out;
}

function goDown() {
  state.down = true;
  for (const s of activeSockets) s.destroy();
  activeSockets.clear();
}

async function handleChat(req, res) {
  const body = await readBody(req);
  state.lastChat = {
    model: body.model,
    think: body.think,
    options: body.options,
    messages: (body.messages ?? []).map((m) => ({ role: m.role, content: m.content, images: m.images?.length ?? 0 })),
  };
  const model = state.installed.get(body.model);
  if (!model) return sendJson(res, 404, { error: `model '${body.model}' not found` });

  const script = { ...DEFAULT_SCRIPT, ...(state.script ?? {}) };
  state.script = null;
  if (script.failWith) return sendJson(res, 500, { error: script.failWith });

  res.writeHead(200, { "content-type": "application/x-ndjson" });
  activeSockets.add(req.socket);
  // 書き込みが相手に渡るまで待てるようにする（直後に接続を切ってもチャンクが届くように）
  const write = (obj) => new Promise((resolve) => res.write(JSON.stringify(obj) + "\n", () => resolve()));
  const chunks = [
    ...pieces(script.thinking).map((t) => ({ thinking: t, content: "" })),
    ...pieces(script.content).map((c) => ({ content: c })),
  ];
  let sent = 0;
  let closed = false;
  req.on("close", () => {
    closed = true;
  });
  for (const c of chunks) {
    await sleep(script.chunkDelayMs);
    if (closed || state.down) return;
    await write({ model: body.model, created_at: now(), message: { role: "assistant", ...c }, done: false });
    sent++;
    if (script.dropAfterChunks !== undefined && sent >= script.dropAfterChunks) {
      // コンテナごと落ちた状態の再現：送ったチャンクが届くのを待ち、先に停止状態にしてから接続を切る
      await sleep(50);
      goDown();
      return;
    }
  }
  await sleep(script.chunkDelayMs);
  if (closed || state.down) return;
  write({
    model: body.model,
    created_at: now(),
    message: { role: "assistant", content: "" },
    done: true,
    done_reason: "stop",
    prompt_eval_count: script.promptEvalCount ?? 10,
    eval_count: chunks.length,
  });
  activeSockets.delete(req.socket);
  res.end();
}

async function handlePull(req, res) {
  const body = await readBody(req);
  const name = body.model ?? body.name;
  const cfg = { ...state.pull };
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  activeSockets.add(req.socket);
  const write = (obj) => res.write(JSON.stringify(obj) + "\n");
  let closed = false;
  req.on("close", () => {
    closed = true;
  });
  write({ status: "pulling manifest" });
  const digest = "sha256:" + "0".repeat(64);
  const step = Math.max(1, Math.ceil(cfg.totalBytes / 10));
  for (let done = 0; done <= cfg.totalBytes; done += step) {
    await sleep(cfg.stepMs);
    if (closed || state.down) return;
    const completed = Math.min(done, cfg.totalBytes);
    if (cfg.failAt !== undefined && completed >= cfg.failAt) {
      write({ error: "max retries exceeded: unexpected EOF" });
      activeSockets.delete(req.socket);
      return res.end();
    }
    write({ status: `pulling ${digest.slice(7, 19)}`, digest, total: cfg.totalBytes, completed });
  }
  for (const status of ["verifying sha256 digest", "writing manifest", "success"]) {
    await sleep(cfg.stepMs);
    if (closed || state.down) return;
    write({ status });
  }
  state.installed.set(name, { size: cfg.totalBytes, capabilities: ["completion"] });
  activeSockets.delete(req.socket);
  res.end();
}

async function handleMock(req, res, path) {
  const body = req.method === "POST" ? await readBody(req) : {};
  switch (path) {
    case "/__mock/reset":
      for (const s of activeSockets) s.destroy();
      activeSockets.clear();
      reset();
      return sendJson(res, 200, { ok: true });
    case "/__mock/script":
      state.script = body;
      return sendJson(res, 200, { ok: true });
    case "/__mock/pull":
      state.pull = { ...DEFAULT_PULL, ...body };
      return sendJson(res, 200, { ok: true });
    case "/__mock/down":
      goDown();
      return sendJson(res, 200, { ok: true });
    case "/__mock/up":
      state.down = false;
      return sendJson(res, 200, { ok: true });
    case "/__mock/last-chat":
      return sendJson(res, 200, state.lastChat);
    default:
      return sendJson(res, 404, { error: "unknown mock path" });
  }
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path.startsWith("/__mock/")) return handleMock(req, res, path);
  // 停止中は応答せずに接続を切る（本物の接続拒否・切断と同じく、呼び出し側の fetch が例外になる）
  if (state.down) return req.socket.destroy();

  const route = `${req.method} ${path}`;
  switch (route) {
    case "GET /api/version":
      return sendJson(res, 200, { version: "0.0.0-mock" });
    case "GET /api/tags":
      return sendJson(res, 200, {
        models: [...state.installed].map(([name, m]) => ({
          name,
          model: name,
          size: m.size,
          digest: "0".repeat(64),
          modified_at: now(),
        })),
      });
    case "POST /api/show": {
      const body = await readBody(req);
      const m = state.installed.get(body.model ?? body.name);
      if (!m) return sendJson(res, 404, { error: `model '${body.model}' not found` });
      return sendJson(res, 200, { capabilities: m.capabilities, details: {}, model_info: {} });
    }
    case "POST /api/chat":
      return handleChat(req, res);
    case "POST /api/pull":
      return handlePull(req, res);
    case "DELETE /api/delete": {
      const body = await readBody(req);
      const name = body.model ?? body.name;
      if (!state.installed.delete(name)) return sendJson(res, 404, { error: `model '${name}' not found` });
      res.writeHead(200);
      return res.end();
    }
    default:
      return sendJson(res, 404, { error: "not found" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`mock ollama listening on ${HOST}:${PORT}`);
});

// keep-alive の接続が残っていても、すぐに終わる
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close();
    server.closeAllConnections();
    process.exit(0);
  });
}

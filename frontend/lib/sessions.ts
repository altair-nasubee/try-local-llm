// セッション履歴のファイル保存。1 セッション = ${dataDir}/sessions/<id>/session.json（画像も同じフォルダ）
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import type { Session, SessionSummary } from "@/lib/types";
import { isValidImageFile, isValidSessionId } from "@/lib/validate";

const TITLE_MAX = 20;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const sessionsDir = () => path.join(getConfig().dataDir, "sessions");

// 形式チェック済みの ID からだけパスを作る（フォルダ外を指させない）
function sessionDir(id: string): string {
  if (!isValidSessionId(id)) throw new Error(`invalid session id: ${id}`);
  return path.join(sessionsDir(), id);
}

export function imagePath(id: string, file: string): string {
  if (!isValidImageFile(file)) throw new Error(`invalid image file: ${file}`);
  return path.join(sessionDir(id), file);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function newId(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rand = Array.from(randomBytes(6), (b) => chars[b % chars.length]).join("");
  return `${date}-${time}-${rand}`;
}

function makeTitle(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return t("session.imageOnlyTitle");
  const chars = Array.from(compact); // サロゲートペアを途中で切らない
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX).join("") + "…" : compact;
}

export async function createSession(model: string, firstUserText: string): Promise<Session> {
  const now = new Date();
  const session: Session = {
    id: newId(now),
    title: makeTitle(firstUserText),
    model,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    messages: [],
  };
  await saveSession(session);
  return session;
}

// 一時ファイルに書いてから置き換える（書きかけを読ませない）。保存後に古いセッションを消す。
// mustExist のときは、フォルダが無ければ（利用者が削除済みなら）保存しない
export async function saveSession(s: Session, opts: { mustExist?: boolean } = {}): Promise<boolean> {
  const dir = sessionDir(s.id);
  if (opts.mustExist && !(await exists(dir))) return false;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "session.json");
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, file);
  await prune(s.id);
  return true;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function isSession(v: unknown): v is Session {
  const s = v as Session;
  return (
    !!s &&
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.model === "string" &&
    typeof s.updatedAt === "string" &&
    Array.isArray(s.messages)
  );
}

export async function getSession(id: string): Promise<Session | null> {
  if (!isValidSessionId(id)) return null;
  try {
    const s = JSON.parse(await readFile(path.join(sessionDir(id), "session.json"), "utf8"));
    return isSession(s) && s.id === id ? s : null;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  let names: string[];
  try {
    names = await readdir(sessionsDir());
  } catch {
    return [];
  }
  const sessions = await Promise.all(names.filter(isValidSessionId).map(getSession));
  return sessions
    .filter((s): s is Session => s !== null)
    .map(({ id, title, model, updatedAt }) => ({ id, title, model, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteSession(id: string): Promise<void> {
  await rm(sessionDir(id), { recursive: true, force: true });
}

// 最終更新日時の新しい順に sessionLimit 件だけ残す。keepId（表示中のセッション）は消さない
export async function prune(keepId: string): Promise<void> {
  const limit = getConfig().sessionLimit;
  const all = await listSessions();
  const keepExists = all.some((s) => s.id === keepId);
  const others = all.filter((s) => s.id !== keepId);
  const room = Math.max(0, keepExists ? limit - 1 : limit);
  for (const s of others.slice(room)) await deleteSession(s.id);
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function magicMatches(type: string, b: Uint8Array): boolean {
  const at = (i: number, bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  switch (type) {
    case "image/png":
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return at(0, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
    default:
      return false;
  }
}

// PNG / JPEG / WebP（中身の先頭バイトも確認）、10MB まで
export function validateImage(file: { type: string; bytes: Uint8Array }): { ok: true } | { ok: false; reason: "type" | "size" } {
  if (!(file.type in EXT) || !magicMatches(file.type, file.bytes)) return { ok: false, reason: "type" };
  if (file.bytes.byteLength > IMAGE_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

export function imageContentType(file: string): string {
  const ext = path.extname(file).slice(1);
  return Object.keys(EXT).find((type) => EXT[type] === ext) ?? "application/octet-stream";
}

// 画像を保存し、ファイル名（img-<n>.<ext>）を返す
export async function saveImage(id: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<string> {
  const ext = EXT[file.type];
  if (!ext) throw new Error(`unsupported image type: ${file.type}`);
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true });
  const used = (await readdir(dir))
    .map((f) => /^img-(\d+)\./.exec(f)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  const name = `img-${used.length ? Math.max(...used) + 1 : 1}.${ext}`;
  await writeFile(path.join(dir, name), file.bytes, { flag: "wx" });
  return name;
}

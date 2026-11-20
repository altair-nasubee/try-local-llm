// API が受け取る識別子の形式チェック。合わなければ 400 を返す（パスの書き換えでフォルダ外を読ませないため）

const SESSION_ID = /^\d{8}-\d{6}-[a-z0-9]{6}$/;
const IMAGE_FILE = /^img-\d+\.(png|jpg|webp)$/;
// 各区切りは英数字で始める（".." を通さない）。hf.co/<user>/<repo>:<tag> のため大文字と 3 段までの / を許す
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){0,2}:[A-Za-z0-9][A-Za-z0-9._-]*$/;
// models.yaml の families（ollama.com/library/<family>/tags の URL に使う）
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const isValidSessionId = (id: string): boolean => SESSION_ID.test(id);
export const isValidImageFile = (name: string): boolean => IMAGE_FILE.test(name);
export const isValidModelName = (name: string): boolean => MODEL_NAME.test(name);
export const isValidFamily = (family: string): boolean => FAMILY.test(family);

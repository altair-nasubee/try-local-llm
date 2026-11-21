// 空き容量。Ollama のモデル保存先と同じ WSL の仮想ディスク上にある dataDir で測る（spec 11-3）
import { statfs } from "node:fs/promises";

export async function freeBytes(path: string): Promise<number> {
  const s = await statfs(path);
  return s.bavail * s.bsize;
}

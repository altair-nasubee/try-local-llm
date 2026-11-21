import { readFile } from "node:fs/promises";
import { apiError } from "@/lib/api";
import { imageContentType, imagePath } from "@/lib/sessions";
import { isValidImageFile, isValidSessionId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  if (!isValidSessionId(id) || !isValidImageFile(file)) return apiError(400, "invalid_path");
  let bytes: Buffer;
  try {
    bytes = await readFile(imagePath(id, file));
  } catch {
    return apiError(404, "not_found");
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": imageContentType(file),
      // 保存後の画像は変わらない
      "cache-control": "private, max-age=86400",
      // 宣言した形式以外として解釈させない
      "x-content-type-options": "nosniff",
    },
  });
}

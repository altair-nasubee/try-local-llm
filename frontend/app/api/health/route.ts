import { isUp } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ollamaUp: await isUp() }, { headers: { "cache-control": "no-store" } });
}

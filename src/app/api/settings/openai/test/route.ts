import { handle } from "@/server/lib/api";
import { testOpenAiConnection } from "@/server/services/openai";

export const runtime = "nodejs";

export async function POST() {
  return handle(async () => testOpenAiConnection());
}

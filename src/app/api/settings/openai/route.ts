import { z } from "zod";
import { handle } from "@/server/lib/api";
import { clearOpenAiKey, describeOpenAiKey, setOpenAiKey } from "@/server/services/settings";

export const runtime = "nodejs";

const keySchema = z.object({
  apiKey: z.string().min(10, "API anahtari cok kisa"),
  storageMode: z.enum(["memory", "encrypted"]).default("memory"),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = keySchema.parse(await request.json());
    await setOpenAiKey(body.apiKey, body.storageMode);
    return describeOpenAiKey();
  });
}

export async function DELETE() {
  return handle(async () => {
    await clearOpenAiKey();
    return describeOpenAiKey();
  });
}

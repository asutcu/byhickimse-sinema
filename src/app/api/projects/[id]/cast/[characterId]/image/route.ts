import { z } from "zod";
import { handle } from "@/server/lib/api";
import { generateCharacterImageWithFlow } from "@/server/services/character-flow";

export const runtime = "nodejs";
export const maxDuration = 900;

type Params = { params: Promise<{ id: string; characterId: string }> };

const schema = z.object({ customPrompt: z.string().optional() });

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id, characterId } = await params;
    const body = schema.parse(await request.json().catch(() => ({})));
    return generateCharacterImageWithFlow(id, body.customPrompt, characterId);
  });
}

import { z } from "zod";
import { handle } from "@/server/lib/api";
import { applyCharacterNote, getOrCreateMainCharacter } from "@/server/services/character";
import { generateCharacterImageWithFlow } from "@/server/services/character-flow";

export const runtime = "nodejs";
export const maxDuration = 900;

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  customPrompt: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = schema.parse(await request.json().catch(() => ({})));
    const main = await getOrCreateMainCharacter(id);
    const note = (body.notes || main.storyNote || "").trim();
    if (note) await applyCharacterNote(id, note);
    // Sitedeki tum resim uretimi Flow / Nano Banana Pro ile yapilir.
    return generateCharacterImageWithFlow(id, body.customPrompt);
  });
}

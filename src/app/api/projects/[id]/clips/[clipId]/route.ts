import { z } from "zod";
import { handle } from "@/server/lib/api";
import { updateClipDialogue } from "@/server/services/clips";
import { updateClipShot } from "@/server/services/cast";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; clipId: string }> };

const patchSchema = z
  .object({
    dialogue: z.string().min(1, "Klip metni bos olamaz"),
    shotType: z.enum(["narrator", "cutaway", "tt_selfie", "tt_local", "tt_pov", "tt_wide"]),
    characterId: z.string().nullable(),
    sceneDescription: z.string(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Guncellenecek alan yok" });

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { clipId } = await params;
    const body = patchSchema.parse(await request.json());

    if (body.shotType !== undefined || body.characterId !== undefined || body.sceneDescription !== undefined) {
      await updateClipShot(clipId, {
        shotType: body.shotType,
        characterId: body.characterId,
        sceneDescription: body.sceneDescription,
      });
    }
    if (body.dialogue !== undefined) return updateClipDialogue(clipId, body.dialogue);

    return { updated: true };
  });
}

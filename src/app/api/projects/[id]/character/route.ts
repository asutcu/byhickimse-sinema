import { z } from "zod";
import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import {
  applyCharacterNote,
  getOrCreateMainCharacter,
  updateCharacterProfile,
  approveCharacterImage,
} from "@/server/services/character";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const main = await getOrCreateMainCharacter(id);
    const sides = await prisma.characterProfile.findMany({ where: { projectId: id, role: "side" }, orderBy: { createdAt: "asc" } });
    return { main, sides };
  });
}

const patchSchema = z
  .object({
    name: z.string(),
    age: z.number().int().min(18, "Karakter yasi 18'in altina ayarlanamaz").max(99),
    nationalityLook: z.string(),
    hair: z.string(),
    faceFeatures: z.string(),
    makeup: z.string(),
    wardrobe: z.string(),
    bodyFraming: z.string(),
    sittingPose: z.string(),
    gestureLevel: z.string(),
    voiceCharacter: z.string(),
    emotionTone: z.string(),
    environment: z.string(),
    lighting: z.string(),
    cameraAngle: z.string(),
    lensLook: z.string(),
    background: z.string(),
    negativePrompt: z.string(),
    flowCharacterReference: z.string(),
    storyNote: z.string(),
  })
  .partial();

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    if (typeof body.storyNote === "string" && body.storyNote.trim() && Object.keys(body).every((key) => key === "storyNote")) {
      return applyCharacterNote(id, body.storyNote);
    }
    const main = await getOrCreateMainCharacter(id);
    return updateCharacterProfile(main.id, body);
  });
}

/** Uretilen karakter gorselini onayla */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const main = await getOrCreateMainCharacter(id);
    return approveCharacterImage(main.id);
  });
}

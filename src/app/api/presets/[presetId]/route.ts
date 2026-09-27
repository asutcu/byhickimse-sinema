import { z } from "zod";
import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { applyPresetToProject } from "@/server/services/presets";

export const runtime = "nodejs";

type Params = { params: Promise<{ presetId: string }> };

/** Preset detayi (dista aktarma icin payload dahil). */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { presetId } = await params;
    return prisma.channelPreset.findUniqueOrThrow({ where: { id: presetId } });
  });
}

const applySchema = z.object({ projectId: z.string().min(1) });

/** Preseti projeye uygula. */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { presetId } = await params;
    const body = applySchema.parse(await request.json());
    await applyPresetToProject(presetId, body.projectId);
    return { applied: true };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { presetId } = await params;
    await prisma.channelPreset.delete({ where: { id: presetId } });
    return { deleted: true };
  });
}

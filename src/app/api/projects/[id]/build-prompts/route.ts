import { z } from "zod";
import { handle } from "@/server/lib/api";
import { buildPromptsForProject } from "@/server/services/clips";
import { prisma } from "@/server/db";
import { polishNarratorSpokenLines } from "@/server/services/narrator-film";

export const runtime = "nodejs";
export const maxDuration = 1200;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    polishSpokenLines: z.boolean().optional(),
    freshFaces: z.boolean().optional(),
  })
  .optional();

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    if (body?.polishSpokenLines) {
      const project = await prisma.project.findUnique({ where: { id }, select: { templateType: true } });
      if (project?.templateType === "narrator") {
        await polishNarratorSpokenLines(id);
      }
    }
    if (body?.freshFaces) {
      const project = await prisma.project.findUnique({ where: { id }, select: { templateType: true } });
      // Zaman Yolcusu kadrosu (sunucu, hayvan, donem yerlisi) modern komsu yuzuyle ezilmez.
      if (project?.templateType !== "time_travel") {
        const { refreshNarratorFacesAndPrompts } = await import("@/server/services/clips");
        return refreshNarratorFacesAndPrompts(id);
      }
    }
    return buildPromptsForProject(id);
  });
}

import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { extractCast, listCast } from "@/server/services/cast";

export const runtime = "nodejs";
export const maxDuration = 1200;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return listCast(id);
  });
}

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const project = await prisma.project.findUniqueOrThrow({ where: { id }, select: { templateType: true } });
    if (project.templateType === "time_travel") {
      // Anlatici film plani Zaman Yolcusu cekim planini ezmesin; yeniden plan klip bolmede yazilir.
      const { planTimeTravelClips } = await import("@/server/services/time-travel");
      const clips = await planTimeTravelClips(id);
      const cast = await prisma.characterProfile.count({ where: { projectId: id, role: "side" } });
      return { castCount: cast, cutawayCount: clips.length };
    }
    return extractCast(id);
  });
}

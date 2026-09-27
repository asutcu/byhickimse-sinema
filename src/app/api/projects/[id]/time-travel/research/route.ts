import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { researchProjectTopic } from "@/server/services/time-travel";

export const runtime = "nodejs";
export const maxDuration = 600;

type Params = { params: Promise<{ id: string }> };

/** Yolculugun konusunu yeniden arastirir; donem, yer ve arastirma dosyasi guncellenir. */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const project = await prisma.project.findUniqueOrThrow({ where: { id }, select: { templateType: true } });
    if (project.templateType !== "time_travel") throw new Error("Bu işlem yalnızca Zaman Yolcusu projelerinde kullanılır.");
    return researchProjectTopic(id);
  });
}

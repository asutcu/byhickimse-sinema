import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { listLocalMusicFiles } from "@/server/services/longform";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const project = await prisma.project.findUniqueOrThrow({ where: { id }, select: { slug: true } });
    return { files: listLocalMusicFiles(project.slug) };
  });
}

import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { getOrCreateMainCharacter, saveUploadedCharacterImage } from "@/server/services/character";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("Dosya bulunamadi (form alani: file)");
    const buffer = Buffer.from(await file.arrayBuffer());
    const main = await getOrCreateMainCharacter(id);
    return saveUploadedCharacterImage(project, main.id, { name: file.name, buffer });
  });
}

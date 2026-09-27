import { prisma } from "@/server/db";
import { recordEvent } from "@/server/lib/logger";

/**
 * Islenen promptlar kalicidir: bolme / plan yenileme / beat rebuild / varyant
 * gibi yikici islemlerden HEMEN once klip promptlari bu arsive kopyalanir.
 * Baska islemler eski kaydi degistirmez — her arsiv satiri o anin fotografi.
 */
export async function archiveClipPrompts(
  projectId: string,
  reason: string,
  options?: { languageVariant?: string }
): Promise<number> {
  const clips = await prisma.clip.findMany({
    where: {
      projectId,
      ...(options?.languageVariant ? { languageVariant: options.languageVariant } : {}),
    },
    select: {
      index: true,
      languageVariant: true,
      dialogue: true,
      imagePrompt: true,
      prompt: true,
      sceneDescription: true,
    },
    orderBy: { index: "asc" },
  });
  const rows = clips.filter((c) => c.prompt.trim() || c.imagePrompt.trim() || c.dialogue.trim());
  if (rows.length === 0) return 0;
  await prisma.promptArchive.createMany({
    data: rows.map((c) => ({
      projectId,
      languageVariant: c.languageVariant,
      clipIndex: c.index,
      dialogue: c.dialogue,
      imagePrompt: c.imagePrompt,
      prompt: c.prompt,
      sceneDescription: c.sceneDescription,
      reason,
    })),
  });
  await recordEvent({
    projectId,
    step: "arsiv",
    message: `${rows.length} klip promptu arsivlendi (${reason}) — hicbir prompt kaybolmaz`,
  });
  return rows.length;
}

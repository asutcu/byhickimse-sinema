import { z } from "zod";
import { prisma } from "@/server/db";
import { structuredCall } from "@/server/services/openai";
import { getSettings, wpmForPace } from "@/server/services/settings";
import { buildClipPrompt } from "@/server/services/prompt-builder";
import { recordEvent } from "@/server/lib/logger";
import { archiveClipPrompts } from "@/server/services/prompt-archive";

/**
 * Coklu dil ciktisi: mevcut sahne/klip setinden secilen hedef dilde
 * yerellestirilmis diyaloglar uretir; ayni proje altinda ayri bir
 * "dil varyanti" olarak saklanir. Otomasyon o varyant icin tekrar kosulur.
 */

const translationSchema = z.object({
  clips: z.array(
    z.object({
      index: z.number().int().min(1),
      dialogue: z.string().min(1),
    })
  ),
});

/** Dil varyanti olusturur: diyaloglar yerellestirilir, promptlar yeniden uretilir. */
export async function createLanguageVariant(projectId: string, targetLanguage: string): Promise<{ variant: string; clipCount: number }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const character = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
  const sourceClips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  if (sourceClips.length === 0) throw new Error("Kaynak klip seti bos. Once ana dilde klipleri olusturun.");

  const variant = targetLanguage
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  if (!variant || variant === "primary") throw new Error("Gecersiz hedef dil adi");

  await recordEvent({ projectId, step: "variant", message: `Dil varyanti olusturuluyor: ${targetLanguage}` });

  const sourceList = sourceClips.map((c) => `${c.index}. ${c.dialogue}`).join("\n");
  const result = await structuredCall<z.infer<typeof translationSchema>>({
    system: `Sen video diyaloglarini yerellestiren bir uzmansin.
- Hedef dil: ${targetLanguage}
- Birebir ceviri DEGIL, dogal konusma diline yerellestirme yap
- Karakterin kisiligini, merak kancalarini ve duygusal tonu KORU
- Cumle sayisi ve uzunluk dagilimi kaynakla benzer kalsin (klip sureleri ayni)
- Yonetmen talimati ekleme; yalnizca konusulacak metni yaz`,
    user: `Kaynak diyaloglar (klip numarasiyla):\n${sourceList.slice(0, 50_000)}`,
    schemaName: "localized_dialogues",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        clips: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              index: { type: "integer" },
              dialogue: { type: "string" },
            },
            required: ["index", "dialogue"],
          },
        },
      },
      required: ["clips"],
    },
    zodSchema: translationSchema,
    maxOutputTokens: 24_000,
  });

  const settings = await getSettings();
  const wpm = wpmForPace(settings, project.speechPace);

  // Eski varyanti temizle ve yeniden olustur (once promptlari arsivle)
  await archiveClipPrompts(projectId, `dil varyanti yeniden olusturuldu (${variant})`, { languageVariant: variant });
  await prisma.clip.deleteMany({ where: { projectId, languageVariant: variant } });
  let created = 0;
  const projectForPrompt = { ...project, speechLanguage: targetLanguage };
  for (const source of sourceClips) {
    const translated = result.clips.find((c) => c.index === source.index);
    const dialogue = translated?.dialogue ?? source.dialogue;
    const words = dialogue.trim().split(/\s+/).filter(Boolean).length;
    const clipData = {
      projectId,
      languageVariant: variant,
      index: source.index,
      dialogue,
      sceneDescription: source.sceneDescription,
      imagePrompt: source.imagePrompt,
      sceneImagePath: source.sceneImagePath,
      emotionLabel: source.emotionLabel,
      curiosityScore: source.curiosityScore,
      hasHook: source.hasHook,
      voiceTone: source.voiceTone,
      estimatedWords: words,
      estimatedDurationSeconds: Number(((words / wpm) * 60).toFixed(1)),
      status: "pending" as const,
      prompt: "",
    };
    const createdClip = await prisma.clip.create({ data: clipData });
    const prompt = buildClipPrompt({
      project: projectForPrompt,
      character,
      clip: createdClip,
      isFirstClip: createdClip.index === 1,
    });
    await prisma.clip.update({ where: { id: createdClip.id }, data: { prompt } });
    created++;
  }

  await recordEvent({ projectId, step: "variant", message: `Dil varyanti hazir: ${variant} (${created} klip, promptlar uretildi)` });
  return { variant, clipCount: created };
}

/** Projedeki dil varyantlarini listeler. */
export async function listLanguageVariants(projectId: string): Promise<Array<{ variant: string; clipCount: number; completedCount: number }>> {
  const clips = await prisma.clip.findMany({ where: { projectId }, select: { languageVariant: true, status: true } });
  const map = new Map<string, { clipCount: number; completedCount: number }>();
  for (const clip of clips) {
    const entry = map.get(clip.languageVariant) ?? { clipCount: 0, completedCount: 0 };
    entry.clipCount++;
    if (clip.status === "completed") entry.completedCount++;
    map.set(clip.languageVariant, entry);
  }
  return Array.from(map.entries()).map(([variant, counts]) => ({ variant, ...counts }));
}

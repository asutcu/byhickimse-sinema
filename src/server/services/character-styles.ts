import { z } from "zod";
import fs from "node:fs";
import type { CharacterProfile } from "@prisma/client";
import { prisma } from "@/server/db";
import { recordEvent } from "@/server/lib/logger";

/**
 * Tarz dolabi (kids kaldirildi). Listeleme / onay / aktiflestirme / silme
 * mevcut JSON kayitlari icin duruyor; uretim API'leri hata firlatir.
 */

export type StyleGenerationMethod = "openai" | "flow";

export const styleClosetEntrySchema = z.object({
  id: z.string(),
  slot: z.number().int().min(2),
  label: z.string(),
  occasion: z.string().default(""),
  outfitDetail: z.string().default(""),
  imagePrompt: z.string().default(""),
  imagePath: z.string().nullable().default(null),
  approved: z.boolean().default(false),
  createdAt: z.string(),
});

export type StyleClosetEntry = z.infer<typeof styleClosetEntrySchema>;

export type StyleSuggestion = {
  label: string;
  occasion: string;
  outfitDetail: string;
  imagePrompt: string;
  signatureProp: string;
};

type DnaCard = {
  name: string;
  outfitDetail: string;
  styleLabel: string;
  imagePrompt: string;
};

function parseCloset(raw: string | null | undefined): StyleClosetEntry[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = z.array(styleClosetEntrySchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.sort((a, b) => a.slot - b.slot) : [];
  } catch {
    return [];
  }
}

async function saveCloset(characterId: string, entries: StyleClosetEntry[]): Promise<StyleClosetEntry[]> {
  const sorted = [...entries].sort((a, b) => a.slot - b.slot);
  await prisma.characterProfile.update({
    where: { id: characterId },
    data: { styleCloset: JSON.stringify(sorted) },
  });
  return sorted;
}

function nextSlot(entries: StyleClosetEntry[]): number {
  const max = entries.reduce((m, e) => Math.max(m, e.slot), 1);
  return Math.max(2, max + 1);
}

function readBaseDna(character: Pick<CharacterProfile, "dnaCard" | "name" | "imagePrompt" | "baseWardrobePrompt">): DnaCard {
  try {
    if (character.dnaCard && character.dnaCard !== "{}") {
      const parsed = JSON.parse(character.dnaCard) as Partial<DnaCard>;
      return {
        name: parsed.name || character.name || "Karakter",
        outfitDetail: parsed.outfitDetail || character.baseWardrobePrompt || "",
        styleLabel: parsed.styleLabel || "Mevcut tarz",
        imagePrompt: parsed.imagePrompt || character.imagePrompt || "",
      };
    }
  } catch {
    /* ignore */
  }
  return {
    name: character.name || "Karakter",
    outfitDetail: character.baseWardrobePrompt || "",
    styleLabel: "Mevcut tarz",
    imagePrompt: character.imagePrompt || "",
  };
}

export async function listCharacterStyles(projectId: string): Promise<{
  active: { name: string; imagePath: string | null; approved: boolean; outfitDetail: string };
  closet: StyleClosetEntry[];
}> {
  const character = await prisma.characterProfile.findFirstOrThrow({ where: { projectId, role: "main" } });
  const dna = readBaseDna(character);
  return {
    active: {
      name: character.name,
      imagePath: character.referenceImagePath,
      approved: character.imageApproved,
      outfitDetail: dna.outfitDetail || character.baseWardrobePrompt || "",
    },
    closet: parseCloset(character.styleCloset),
  };
}

export async function suggestOutfitStyles(_projectId: string, _count = 3): Promise<StyleSuggestion[]> {
  throw new Error("Tarz dolabi kaldirildi");
}

export async function suggestAndGenerateOutfitStyles(
  _projectId: string,
  _count = 3,
  _method: StyleGenerationMethod = "openai"
): Promise<{ closet: StyleClosetEntry[]; created: StyleClosetEntry[]; failed: string[] }> {
  throw new Error("Tarz dolabi kaldirildi");
}

export async function generateOutfitStyle(
  _projectId: string,
  _suggestion: StyleSuggestion,
  _method: StyleGenerationMethod = "openai"
): Promise<StyleClosetEntry> {
  throw new Error("Tarz dolabi kaldirildi");
}

export async function approveOutfitStyle(projectId: string, styleId: string): Promise<StyleClosetEntry> {
  const character = await prisma.characterProfile.findFirstOrThrow({ where: { projectId, role: "main" } });
  const closet = parseCloset(character.styleCloset);
  const idx = closet.findIndex((e) => e.id === styleId);
  if (idx < 0) throw new Error("Tarz bulunamadi");
  closet[idx] = { ...closet[idx], approved: true };
  await saveCloset(character.id, closet);
  await recordEvent({
    projectId,
    step: "character",
    message: `Yedek tarz onaylandi: slot ${closet[idx].slot} — ${closet[idx].label}`,
  });
  return closet[idx];
}

export async function activateOutfitStyle(
  projectId: string,
  styleId: string
): Promise<{ activeSlot: number; archived?: StyleClosetEntry }> {
  const character = await prisma.characterProfile.findFirstOrThrow({ where: { projectId, role: "main" } });
  const dna = readBaseDna(character);
  let closet = parseCloset(character.styleCloset);
  const target = closet.find((e) => e.id === styleId);
  if (!target) throw new Error("Tarz bulunamadi");
  if (!target.imagePath || !fs.existsSync(target.imagePath)) throw new Error("Tarz gorseli yok");
  if (!target.approved) throw new Error("Once tarzi onaylayin");

  let archived: StyleClosetEntry | undefined;
  if (character.referenceImagePath && fs.existsSync(character.referenceImagePath)) {
    archived = {
      id: `archived_${Date.now().toString(36)}`,
      slot: nextSlot(closet),
      label: dna.styleLabel?.trim() || "Onceki aktif",
      occasion: "Aktif yapilmadan once kaydedilen ana tarz",
      outfitDetail: dna.outfitDetail || character.baseWardrobePrompt || "",
      imagePrompt: character.imagePrompt || "",
      imagePath: character.referenceImagePath,
      approved: character.imageApproved,
      createdAt: new Date().toISOString(),
    };
    closet = [...closet, archived];
  }

  closet = closet.filter((e) => e.id !== styleId);

  let dnaPayload: Record<string, unknown> = {
    ...dna,
    outfitDetail: target.outfitDetail,
    imagePrompt: target.imagePrompt,
    styleLabel: target.label,
  };
  try {
    const prev = JSON.parse(character.dnaCard || "{}") as Record<string, unknown>;
    if (prev.storyGear) dnaPayload = { ...dnaPayload, storyGear: prev.storyGear };
  } catch {
    /* ignore */
  }

  await prisma.characterProfile.update({
    where: { id: character.id },
    data: {
      referenceImagePath: target.imagePath,
      imageApproved: true,
      imagePrompt: target.imagePrompt,
      baseWardrobePrompt: target.outfitDetail,
      wardrobe: target.outfitDetail,
      dnaCard: JSON.stringify(dnaPayload),
      styleCloset: JSON.stringify(closet.sort((a, b) => a.slot - b.slot)),
    },
  });

  await recordEvent({
    projectId,
    step: "character",
    message: `Yedek tarz aktif: ${target.label}`,
  });
  return { activeSlot: 1, archived };
}

export async function deleteOutfitStyle(projectId: string, styleId: string): Promise<void> {
  const character = await prisma.characterProfile.findFirstOrThrow({ where: { projectId, role: "main" } });
  const closet = parseCloset(character.styleCloset).filter((e) => e.id !== styleId);
  await saveCloset(character.id, closet);
  await recordEvent({ projectId, step: "character", message: `Yedek tarz silindi: ${styleId}` });
}

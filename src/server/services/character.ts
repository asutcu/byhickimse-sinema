import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CharacterProfile, Project } from "@prisma/client";
import { sanitizeCelebrityLikenessForFlow } from "@/lib/flow-prompt-safety";
import {
  flowLocaleCastLock,
  localeNationalityLook,
  localePackForSpeech,
  speechCastStoryLock,
  speechLocaleTag,
} from "@/lib/speech-cast-locale";
import { NETSHORT_FEMALE_WARDROBE_DEFAULT } from "@/server/services/cast";
import { prisma } from "@/server/db";
import { structuredCall } from "@/server/services/openai";
import { ensureProjectDirs, nextAvailablePath } from "@/server/lib/paths";
import { recordEvent } from "@/server/lib/logger";

/**
 * Karakter profili, Karakter Kilidi ve referans gorsel yonetimi.
 */

export const ALLOWED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

/** Ana karakteri getirir; yoksa varsayilan degerlerle olusturur. */
export async function getOrCreateMainCharacter(projectId: string): Promise<CharacterProfile> {
  const existing = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
  if (existing) return existing;
  return prisma.characterProfile.create({ data: { projectId, role: "main" } });
}

/** Yas kontrolu: 18 alti kabul edilmez; yetiskin varsayilani 25. */
export function normalizeAge(age: number | undefined): number {
  if (!age || age < 18) return 25;
  return age;
}

/**
 * Karakter Kilidi promptlarini profil alanlarindan uretir.
 * Bu metinler her klipte AYNEN kullanilir; hikaye parcasi disinda degismez.
 */
function looksLikeAnimatedCast(profile: CharacterProfile): boolean {
  const blob = [
    profile.baseAppearancePrompt,
    profile.imagePrompt,
    profile.wardrobe,
    profile.baseWardrobePrompt,
  ].join(" ");
  return /3d animated|2d anime|pixar|cartoon|cgi\b|\bfur\b|mascot|\banime\b/i.test(blob);
}

function coverFemaleWardrobe(wardrobe: string, gender: string | null | undefined): string {
  if (gender === "male") return wardrobe;
  const raw = wardrobe.replace(/\s+/g, " ").trim();
  if (/cardigan|blazer|wool coat|\bcoat\b|trousers|modest office|bodycon|club dress|plunge|lingerie/i.test(raw)) {
    return NETSHORT_FEMALE_WARDROBE_DEFAULT;
  }
  const cleaned = sanitizeCelebrityLikenessForFlow(raw);
  return cleaned || NETSHORT_FEMALE_WARDROBE_DEFAULT;
}

export function buildCharacterLock(profile: CharacterProfile): {
  baseAppearancePrompt: string;
  baseWardrobePrompt: string;
  baseEnvironmentPrompt: string;
  baseCameraPrompt: string;
  baseVoicePrompt: string;
} {
  // Kadro (side) karakterleri: cast.ts zaten cinsiyet, sac, goz, ten ve
  // yapi bilgisini tek tek belirtilmis, ic ice gecmis tam bir gorunum
  // metni olarak uretti (bkz. composeCastAppearance). Burada fragmanlardan
  // yeniden kurmaya calismak bu bilgiyi KAYBEDER — ornegin cinsiyet
  // asagida "woman" olarak sabitlenirdi ve "Sinan" gibi erkek bir kadro
  // karakteri kadin yuzuyle uretilirdi. O yuzden side karakterler icin
  // saklanan alanlari OLDUGU GIBI kullaniyoruz.
  if (profile.role === "side") {
    return {
      baseAppearancePrompt: profile.baseAppearancePrompt || profile.imagePrompt || "",
      baseWardrobePrompt: looksLikeAnimatedCast(profile)
        ? profile.wardrobe || profile.baseWardrobePrompt || ""
        : coverFemaleWardrobe(profile.wardrobe || profile.baseWardrobePrompt || "", profile.gender),
      baseEnvironmentPrompt: profile.environment || profile.baseEnvironmentPrompt || "",
      baseCameraPrompt: "Fixed tripod camera. No cuts, no zoom, no camera movement, no angle change.",
      baseVoicePrompt: profile.voiceCharacter || profile.baseVoicePrompt || "",
    };
  }

  const appearance: string[] = [];
  const sex = profile.gender === "male" ? "male" : "female";
  appearance.push(`A ${profile.age}-year-old adult ${sex === "male" ? "MAN" : "WOMAN"} (${sex})`);
  if (profile.nationalityLook) appearance.push(profile.nationalityLook);
  if (profile.hair) appearance.push(`with ${profile.hair}`);
  if (profile.faceFeatures) appearance.push(profile.faceFeatures);
  if (profile.makeup) appearance.push(`makeup: ${profile.makeup}`);
  if (profile.role === "main" && profile.storyNote.trim()) {
    appearance.push(`must match this brief exactly: ${profile.storyNote.trim()}`);
  }

  const camera: string[] = [];
  if (profile.bodyFraming) camera.push(profile.bodyFraming);
  if (profile.cameraAngle) camera.push(profile.cameraAngle);
  if (profile.lensLook) camera.push(`lens: ${profile.lensLook}`);
  camera.push("Fixed tripod camera. No cuts, no zoom, no camera movement, no angle change.");

  const environment: string[] = [];
  if (profile.environment) environment.push(profile.environment);
  if (profile.sittingPose) environment.push(`${profile.gender === "male" ? "He" : "She"} is ${profile.sittingPose}`);
  if (profile.lighting) environment.push(`Lighting: ${profile.lighting}`);
  if (profile.background) environment.push(`Background: ${profile.background}`);

  const voice: string[] = [];
  if (profile.voiceCharacter) voice.push(profile.voiceCharacter);
  if (profile.emotionTone) voice.push(`emotional tone: ${profile.emotionTone}`);
  if (profile.gestureLevel) voice.push(`gesture level: ${profile.gestureLevel}`);

  return {
    baseAppearancePrompt: appearance.join(", ") + ".",
    baseWardrobePrompt: looksLikeAnimatedCast(profile)
      ? profile.wardrobe || ""
      : coverFemaleWardrobe(profile.wardrobe || "", profile.gender),
    baseEnvironmentPrompt: environment.join(". "),
    baseCameraPrompt: camera.join(". "),
    baseVoicePrompt: voice.join(", "),
  };
}

/**
 * Ses kilidinden sabit duygu tonu parcasini cikarir.
 *
 * Ayni karakterle yeni film acildiginda ses KIMLIGI (tini, aksan, tempo) korunur
 * ama eski filmden gelen sabit duygu tonu tasinmaz — duygu her klipte sahnenin
 * kendi senaryosundan gelir.
 */
export function stripEmotionTonePhrase(voicePrompt: string | null | undefined): string {
  return (voicePrompt || "")
    .replace(/,?\s*emotional tone:[^,.]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,.\s]+/, "")
    .replace(/[,\s]+$/, "")
    .trim();
}

/** Profili gunceller ve Karakter Kilidi promptlarini yeniden uretir. */
export async function updateCharacterProfile(
  characterId: string,
  data: Partial<
    Pick<
      CharacterProfile,
      | "name"
      | "age"
      | "adult"
      | "gender"
      | "nationalityLook"
      | "hair"
      | "faceFeatures"
      | "makeup"
      | "wardrobe"
      | "bodyFraming"
      | "sittingPose"
      | "gestureLevel"
      | "voiceCharacter"
      | "emotionTone"
      | "environment"
      | "lighting"
      | "cameraAngle"
      | "lensLook"
      | "background"
      | "negativePrompt"
      | "flowCharacterReference"
      | "storyNote"
    >
  >
): Promise<CharacterProfile> {
  const normalizedAge = data.age !== undefined ? normalizeAge(data.age) : undefined;
  const updated = await prisma.characterProfile.update({
    where: { id: characterId },
    data: { ...data, ...(normalizedAge !== undefined ? { age: normalizedAge, adult: true } : {}) },
  });
  const lock = buildCharacterLock(updated);
  return prisma.characterProfile.update({ where: { id: characterId }, data: lock });
}

export const characterNoteExpandSchema = z.object({
  name: z.string().min(1),
  age: z.number().int(),
  gender: z.enum(["female", "male"]),
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
});

export type ExpandedCharacterNote = z.infer<typeof characterNoteExpandSchema>;

const NOTE_EXPAND_JSON: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    age: { type: "integer" },
    gender: { type: "string", enum: ["female", "male"] },
    nationalityLook: { type: "string" },
    hair: { type: "string" },
    faceFeatures: { type: "string" },
    makeup: { type: "string" },
    wardrobe: { type: "string" },
    bodyFraming: { type: "string" },
    sittingPose: { type: "string" },
    gestureLevel: { type: "string" },
    voiceCharacter: { type: "string" },
    emotionTone: { type: "string" },
    environment: { type: "string" },
    lighting: { type: "string" },
    cameraAngle: { type: "string" },
    lensLook: { type: "string" },
    background: { type: "string" },
    negativePrompt: { type: "string" },
  },
  required: [
    "name",
    "age",
    "gender",
    "nationalityLook",
    "hair",
    "faceFeatures",
    "makeup",
    "wardrobe",
    "bodyFraming",
    "sittingPose",
    "gestureLevel",
    "voiceCharacter",
    "emotionTone",
    "environment",
    "lighting",
    "cameraAngle",
    "lensLook",
    "background",
    "negativePrompt",
  ],
};

/** OpenAI yoksa veya cagri dusurse notu kilide yine de gommek icin yedek. */
export function fallbackExpandCharacterNote(
  note: string,
  existingName?: string,
  language?: string
): ExpandedCharacterNote {
  const brief = note.replace(/\s+/g, " ").trim();
  const pack = localePackForSpeech(language);
  const name = existingName?.trim() || (speechLocaleTag(language) === "tr" ? "Lena" : pack.femaleNames[0]);
  return {
    name,
    age: 25,
    gender: "female",
    nationalityLook: localeNationalityLook(language),
    hair: /saç|sac|hair|blond|sarı|sari/i.test(brief)
      ? brief
      : "shoulder-length natural blonde or light-brown waves, softly styled, a few flyaways",
    faceFeatures: /yüz|yuz|face|göz|goz|bebek/i.test(brief)
      ? brief
      : "everyday neighbor adult face — slight asymmetry, natural eyes, not a catalog model",
    makeup: "little or no makeup",
    wardrobe: /kıyafet|kiyafet|giy|etek|skirt|crop|bluz|elbise|mini|açık|acik/i.test(brief)
      ? brief
      : "short summer dress or mini skirt with a thin blouse, slightly open neckline, sandals — everyday light clothes, no lingerie",
    bodyFraming: "full body visible, slim petite adult proportions",
    sittingPose: "standing then seated as the scene requires, relaxed adult posture",
    gestureLevel: "subtle",
    voiceCharacter: "calm warm adult female voice",
    emotionTone: "natural, scene-led",
    environment: "clean cinematic interior matching the story",
    lighting: "even diffused fill, no window, no lamp, no blown-out white",
    cameraAngle: "eye-level fixed camera",
    lensLook: "natural 35mm photographic look",
    background: "uncluttered, no readable text",
    negativePrompt: "no child, no teen, no underage, no nudity, no text, no watermark, no logo",
  };
}

export function flowHandleFromName(name: string): string {
  const cleaned = name.replace(/^@+/, "").replace(/[^\p{L}\p{N}]+/gu, "").trim();
  return cleaned ? `@${cleaned}` : "";
}

/** Kullanici notasini sahne kilidi alanlarina cevirir (Ingilizce uretim alanlari). */
export async function expandCharacterNote(
  note: string,
  options?: { existingName?: string; language?: string; genre?: string }
): Promise<ExpandedCharacterNote> {
  const brief = note.replace(/\s+/g, " ").trim();
  if (!brief) throw new Error("Karakter notu bos");
  try {
    const result = await structuredCall<ExpandedCharacterNote>({
      system: `You expand a short informal character note into a complete adult character bible for NetShort short-drama video.
Rules:
- Adult only. Age must be 23-28 for women (prefer 25). Men 30-42.
- Women (DEFAULT): age 25, ordinary everyday neighbor face (natural eyes; brown, chestnut, black or grown-out blonde; NOT a catalog model), little makeup, short summer dress or mini skirt with a thin top and a slightly open neckline, sandals. FORBIDDEN: deep cleavage, clubwear, bodycon, lingerie, modest office suit, cardigan, wool coat, trousers, schoolgirl, nudity. Do not name a real person or an ethnic "type".
- Keep EVERY user detail if the note explicitly contradicts (honor the note). If vague, FORCE the everyday light-clothes look above.
- Do not invent a different person. Do not make women look like models or campaign faces. Do not write the words celebrity, famous, or influencer.
- Fields are English production phrases, not Turkish labels.
- name: short given name matching the speech-language name lock; reuse existing name if provided. Turkish names only when the story language is Turkish.
- hair / faceFeatures / wardrobe must be detailed enough for a still photo (color, length, texture, fit, fabric).
- bodyFraming: how much body is visible; honor the note if it asks for full body.
- cameraAngle default "eye-level fixed camera"; lensLook default "natural 35mm".
- lighting: even diffused fill only. Forbidden: window, lamp in frame, blown-out white, high-key studio.
- negativePrompt: block children, text, watermark, extra people, nudity.`,
      user: [
        `User note: ${brief}`,
        options?.existingName ? `Existing name (keep unless note names someone else): ${options.existingName}` : "",
        options?.language ? `Story language: ${options.language}` : "",
        speechCastStoryLock(options?.language),
        options?.language
          ? `nationalityLook / face: ${flowLocaleCastLock(options.language, "female", options.existingName) || "everyday city neighbor, original invented face."}`
          : "",
        options?.genre ? `Genre: ${options.genre}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      schemaName: "character_note_expand",
      jsonSchema: NOTE_EXPAND_JSON,
      zodSchema: characterNoteExpandSchema,
      maxOutputTokens: 4_000,
    });
    return {
      ...result,
      name:
        result.name.trim() ||
        options?.existingName?.trim() ||
        (speechLocaleTag(options?.language) === "tr" ? "Lena" : localePackForSpeech(options?.language).femaleNames[0]),
      age: normalizeAge(result.age),
      nationalityLook: result.nationalityLook?.trim() || localeNationalityLook(options?.language),
    };
  } catch {
    return fallbackExpandCharacterNote(brief, options?.existingName, options?.language);
  }
}

export async function applyCharacterNote(projectId: string, note: string): Promise<CharacterProfile> {
  const brief = note.replace(/\s+/g, " ").trim();
  if (!brief) throw new Error("Karakter notu bos");
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const main = await getOrCreateMainCharacter(projectId);
  const expanded = await expandCharacterNote(brief, {
    existingName: main.name,
    language: project.speechLanguage,
    genre: project.genre,
  });
  const { name, age, gender, ...rest } = expanded;
  return updateCharacterProfile(main.id, {
    ...rest,
    name,
    age,
    gender,
    storyNote: brief,
    flowCharacterReference: flowHandleFromName(name) || main.flowCharacterReference,
  });
}

/** Kullanicinin yukledigi referans gorselini proje klasorune kopyalar. */
export async function saveUploadedCharacterImage(
  project: Project,
  characterId: string,
  file: { name: string; buffer: Buffer }
): Promise<CharacterProfile> {
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
    throw new Error(`Desteklenmeyen gorsel bicimi: ${ext}. Desteklenen: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}`);
  }
  if (file.buffer.length < 1024) throw new Error("Gorsel dosyasi cok kucuk veya bos");
  if (file.buffer.length > 25 * 1024 * 1024) throw new Error("Gorsel dosyasi 25MB sinirini asiyor");

  const root = ensureProjectDirs(project.slug);
  const target = nextAvailablePath(path.join(root, "character", `reference${ext}`));
  fs.writeFileSync(target, file.buffer);

  const character = await prisma.characterProfile.update({
    where: { id: characterId },
    data: { referenceImagePath: target, imageApproved: true },
  });
  await prisma.generatedAsset.create({
    data: { projectId: project.id, kind: "character_image", path: target, bytes: file.buffer.length, meta: JSON.stringify({ source: "upload" }) },
  });
  await recordEvent({ projectId: project.id, step: "character", message: `Karakter referans gorseli yuklendi (${path.basename(target)})` });
  return character;
}

/** Uretilen gorseli onaylar (Flow otomasyonu onaysiz gorselle baslamaz). */
export async function approveCharacterImage(characterId: string): Promise<CharacterProfile> {
  return prisma.characterProfile.update({ where: { id: characterId }, data: { imageApproved: true } });
}

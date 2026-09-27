import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/server/db";
import { structuredCall } from "@/server/services/openai";
import { recordEvent } from "@/server/lib/logger";
import { ensureProjectDirs } from "@/server/lib/paths";
import {
  castMemberSchema,
  composeCastAppearance,
  NETSHORT_FEMALE_HAIR_DEFAULT,
  NETSHORT_FEMALE_WARDROBE_DEFAULT,
  NETSHORT_MALE_WARDROBE_DEFAULT,
  normalizeNetShortFemaleCast,
  normalizeNetShortMaleCast,
  type CastMember,
} from "@/server/services/cast";
import { resolveCastGender } from "@/lib/turkish-given-name-gender";
import { flowHandleFromName } from "@/server/services/character";
import {
  appendFlowLocaleCast,
  localeNationalityLook,
  speechCastGenderHint,
  speechCastStoryLock,
} from "@/lib/speech-cast-locale";
import { narratorGenreFilmBlock, resolveNarratorGenre, isNarratorHardConflictGenre, NARRATOR_NETSHORT_VISUAL_LOCK, NARRATOR_NETSHORT_FEMALE_LOOK_LOCK } from "@/lib/narrator-genres";
import { NETSHORT_CORPUS_VISUAL_BEATS, netShortEmotionPaletteBlock } from "@/lib/netshort-corpus";
import { netShortBeatsPromptBlock, netShortEmotionsVisualLock, netShortFlowEmotionCue } from "@/lib/netshort-summaries";
import { stripEmbeddedOnscreenTextTails } from "@/lib/flow-prompt-compact";
import {
  findCastInText,
  onScreenCastForClipBeat,
  resolveCastMemberByName,
  textMentionsCastName,
} from "@/lib/cast-clip-match";
import { extractProperNames } from "@/lib/longform-netshort-stills";
import { wpmForPace, getSettings } from "@/server/services/settings";
import { countWords, estimateSpeechSeconds } from "@/server/services/story";
import {
  maxWordsForClipSeconds,
  minWordsForClipSeconds,
  speechFillRatioFor,
} from "@/server/services/splitter";

/**
 * Sinema anlatici film plani.
 * Su an VOICE-OVER ONLY: tum klipler cutaway (hikaye dunyasi); anlatici kadin
 * kamerada yok, ref gorseli yok — yalnizca dis ses.
 */

export const NARRATOR_WORLD_LOCK_MARKER = "NARRATOR WORLD LOCK";
/** Eski GPT sahne partisi boyutu — sahneler artik yerelde yazilir; sabit test/uyumluluk icin durur. */
export const NARRATOR_FILM_PLAN_CHUNK = 8;
/** Hikaye kadrosu tavanı — 4 olunca sekreter/tanik (Asya) disarida kaliyordu. */
export const NARRATOR_MAX_SIDE_CAST = 6;
/** Anlatici talking-head + ref gorseli kapali (simdilik). */
export const NARRATOR_VOICE_OVER_ONLY = true;

export const narratorWorldBibleSchema = z.object({
  era: z.string().default(""),
  timeOfDay: z.string().default(""),
  weather: z.string().default(""),
  locations: z.array(z.string()).default([]),
  signatureProps: z.array(z.string()).default([]),
  worldLock: z.string().min(20),
  /** Hikaye degisince cache gecersiz — eski kadro/dunya yeni metni ezmesin. */
  storyFingerprint: z.string().optional(),
});

export type NarratorWorldBible = z.infer<typeof narratorWorldBibleSchema>;

const worldAndCastSchema = z.object({
  world: narratorWorldBibleSchema,
  cast: z.array(castMemberSchema),
});

function stubCastMemberFromName(name: string): CastMember {
  const gender = resolveCastGender(name, "female");
  const female = gender === "female";
  return {
    name,
    storyRole: "hikaye kadrosu",
    storyNote: "",
    gender,
    age: female ? 25 : 34,
    build: "average adult build",
    hairDetail: female ? NETSHORT_FEMALE_HAIR_DEFAULT : "short dark brown hair, neatly cut",
    eyeColor: female ? "green" : "brown",
    skinTone: female ? "fair light" : "olive tan",
    distinctFeature: "",
    accessories: "",
    appearancePrompt: `A named adult ${female ? "woman" : "man"} from this story, original fictional person, clearly on screen.`,
    wardrobePrompt: female ? NETSHORT_FEMALE_WARDROBE_DEFAULT : NETSHORT_MALE_WARDROBE_DEFAULT,
    voiceNote: "",
  };
}

/** GPT 4 kisilik tavanda sekreter/tanigi dusurmesin; hikayedeki isimler kadroya girer. */
export function mergeStoryNamesIntoCastMembers(cast: CastMember[], storyText: string): CastMember[] {
  const merged = [...cast];
  const have = new Set(merged.map((member) => member.name.trim().toLocaleLowerCase("tr-TR")));
  for (const name of extractProperNames(storyText)) {
    const key = name.trim().toLocaleLowerCase("tr-TR");
    if (!key || have.has(key)) continue;
    merged.push(stubCastMemberFromName(name));
    have.add(key);
  }
  return merged.slice(0, NARRATOR_MAX_SIDE_CAST);
}

async function persistStoryNamesToCast(projectId: string, storyText: string): Promise<number> {
  const existing = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  const have = new Set(existing.map((row) => row.name.trim().toLocaleLowerCase("tr-TR")));
  const firstName = (value: string) => value.trim().split(/\s+/)[0]?.toLowerCase() || "";
  const genderColorIndex: Record<"male" | "female", number> = { male: 0, female: 0 };
  for (const row of existing) {
    genderColorIndex[row.gender === "male" ? "male" : "female"] += 1;
  }
  const room = Math.max(0, NARRATOR_MAX_SIDE_CAST - existing.length);
  if (room === 0) return 0;
  const missing = extractProperNames(storyText).filter((name) => {
    const key = name.trim().toLocaleLowerCase("tr-TR");
    if (!key || have.has(key)) return false;
    if (existing.some((row) => firstName(row.name) === firstName(name))) return false;
    return true;
  }).slice(0, room);
  let added = 0;
  for (const name of missing) {
    const stub = stubCastMemberFromName(name);
    const gender = stub.gender;
    const colorSeed = genderColorIndex[gender];
    genderColorIndex[gender] += 1;
    const member = gender === "male" ? normalizeNetShortMaleCast(stub, colorSeed) : normalizeNetShortFemaleCast(stub, colorSeed);
    const appearance = composeCastAppearance(member, colorSeed);
    await prisma.characterProfile.create({
      data: {
        projectId,
        role: "side",
        name: member.name,
        age: member.age,
        adult: true,
        gender: member.gender,
        hair: member.hairDetail,
        faceFeatures: [member.eyeColor, member.skinTone, member.build].filter(Boolean).join(", "),
        storyRole: member.storyRole,
        storyNote: member.storyNote,
        voiceCharacter: member.voiceNote,
        wardrobe: member.wardrobePrompt,
        baseAppearancePrompt: appearance,
        baseWardrobePrompt: member.wardrobePrompt,
        imagePrompt: appearance,
        negativePrompt: "no text, no watermark, no logo, no child, no teen, no underage, no nudity",
      },
    });
    have.add(name.trim().toLocaleLowerCase("tr-TR"));
    added += 1;
  }
  return added;
}

const filmClipPlanSchema = z.object({
  clipIndex: z.number().int().min(1),
  characterName: z.string().default(""),
  /** Ikinci yuz (opsiyonel) — max 2 kisi; bos = tek kisi. */
  secondCharacterName: z.string().default(""),
  /** 1-4 — kadrajdaki isimli yuz sayisi (VO'da kac isim varsa). */
  castCount: z.number().int().min(1).max(4).default(1),
  scenePrompt: z.string().min(20),
  camera: z.string().default(""),
  lighting: z.string().default(""),
  secondBySecond: z.string().default(""),
  /** Sahnenin duygusu (Turkce kisa etiket) — kliplerin durgun kalmasini engeller. */
  emotion: z.string().default(""),
  /** Duygunun yuz/beden oyunculugu (Ingilizce yonetmen notu). */
  performance: z.string().default(""),
  /** Klipte fiziksel olarak NE hareket ediyor (Ingilizce). */
  motion: z.string().default(""),
  /** Dis sesin bu klibteki tonu (Turkce). */
  narrationTone: z.string().default(""),
  /** interior | exterior | threshold — mekan turu. */
  settingType: z.string().default(""),
  /** INGILIZCE tam mekan: mimari, zemin, tavan/gokyuzu, disarinin/icerinin devamı. */
  environment: z.string().default(""),
  /** INGILIZCE katmanli arka plan: on/orta/arka, uzak yasam. */
  background: z.string().default(""),
  /** INGILIZCE set esyalari, asınma, bitki, arac, iz. */
  setDressing: z.string().default(""),
  /** INGILIZCE hava/atmosfer: yagmur, toz, buhar, isik rengi. */
  atmosphere: z.string().default(""),
});

function castMemberJson(language: string | null | undefined): Record<string, unknown> {
  const nameLock = speechCastStoryLock(language);
  return {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: `Karakterin adi; hikayede ad yoksa konusma diline uygun bir ozel isim uret. ${nameLock}`,
    },
    storyRole: { type: "string", description: "Hikayedeki rolu, Turkce (or. 'anlaticinin kizi', 'komsu')" },
    storyNote: { type: "string", description: "Tek cumlelik tanitim (Turkce)" },
    gender: {
      type: "string",
      enum: ["male", "female"],
      description: `Karakterin cinsiyeti. Hikaye metnindeki zamir/ifadelerden VE isimden cikar. ${speechCastGenderHint(language)} Tek kadinsa female. Asla cift cinsiyet / iki kisi yazma.`,
    },
    age: { type: "integer", description: "Adult age. Female: 23-28 (prefer 25). Male: 30-42 typical." },
    build: { type: "string", description: "ENGLISH. Body build. Female: slim petite soft curves." },
    hairDetail: {
      type: "string",
      description: "ENGLISH. Exact hair. Everyday color and cut — brown, chestnut, black, or grown-out blonde. Not salon-glam.",
    },
    eyeColor: { type: "string", description: "ENGLISH. Exact eye color." },
    skinTone: { type: "string", description: "ENGLISH. Exact skin tone. Female: fair/porcelain preferred." },
    distinctFeature: { type: "string", description: "ENGLISH. Distinguishing feature or empty." },
    accessories: { type: "string", description: "ENGLISH. Every accessory a real eye would notice, or empty." },
    appearancePrompt: {
      type: "string",
      description:
        "ENGLISH. Photorealistic paragraph. Female: ordinary pretty adult woman 23-28, light natural makeup, neighbor face. 40-80 words. Adults only.",
    },
    wardrobePrompt: {
      type: "string",
      description:
        "ENGLISH. Female: everyday light clothes — short summer dress or mini skirt, thin top, slightly open neckline, sandals. Age 23-28, ordinary neighbor face, little makeup. FORBIDDEN: deep cleavage, clubwear, bodycon, lingerie, modest office, wool coat, trousers, nudity. Do not name a real person or an ethnic type. Male: everyday shirt and jeans.",
    },
    voiceNote: { type: "string", description: "Turkce ses/ton notu" },
  },
  required: [
    "name",
    "storyRole",
    "storyNote",
    "gender",
    "age",
    "build",
    "hairDetail",
    "eyeColor",
    "skinTone",
    "distinctFeature",
    "accessories",
    "appearancePrompt",
    "wardrobePrompt",
    "voiceNote",
  ],
  };
}

/** Talking-head / koltuk sablonu mu? Eski ozel sablonlar film yolunu ezmesin. */
export function isTalkingHeadTemplate(template: string): boolean {
  return /She remains seated|same room, chair|Fixed tripod camera|Do not make her stand up|Do not change the character's face, clothing, hairstyle, location or camera/i.test(
    template
  );
}

export function buildNarratorWorldLock(world: NarratorWorldBible): string {
  const locations = world.locations.map((l) => l.trim()).filter(Boolean);
  const props = world.signatureProps.map((p) => p.trim()).filter(Boolean);
  return [
    `${NARRATOR_WORLD_LOCK_MARKER}:`,
    world.worldLock.replace(/\s+/g, " ").trim(),
    world.era.trim() ? `Era: ${world.era.trim()}.` : "",
    world.timeOfDay.trim() ? `Time of day: ${world.timeOfDay.trim()}.` : "",
    world.weather.trim() ? `Weather: ${world.weather.trim()}.` : "",
    locations.length ? `Recurring locations (keep identical): ${locations.join("; ")}.` : "",
    props.length ? `Signature props (same object every appearance): ${props.join("; ")}.` : "",
    "MIXED FEATURE FILM: NARRATOR takes show the storyteller woman ON CAMERA in a lived-in confession space. CUTAWAY takes show the story world; in those takes she is NOT in frame.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Plan alanlarindan tam mekan bloklari — mevcut SHOT/CAMERA/duygu sirasina dokunmaz, sona eklenir. */
export function formatNarratorWorldDetail(options: {
  settingType?: string;
  environment?: string;
  background?: string;
  setDressing?: string;
  atmosphere?: string;
}): string {
  const setting = options.settingType?.replace(/\s+/g, " ").trim().toLowerCase() || "";
  const settingLabel =
    setting === "exterior" ? "exterior" : setting === "threshold" ? "threshold" : setting === "interior" ? "interior" : "";
  return [
    settingLabel ? `[SETTING] ${settingLabel}` : "",
    options.environment?.trim()
      ? `[ENVIRONMENT] ${options.environment.replace(/\s+/g, " ").trim()}`
      : "",
    options.background?.trim()
      ? `[BACKGROUND LAYERS] ${options.background.replace(/\s+/g, " ").trim()}`
      : "",
    options.setDressing?.trim()
      ? `[SET DRESSING] ${options.setDressing.replace(/\s+/g, " ").trim()}`
      : "",
    options.atmosphere?.trim()
      ? `[ATMOSPHERE] ${options.atmosphere.replace(/\s+/g, " ").trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function mixNarratorShotTypes(
  total: number,
  options?: { cutawayHeavy?: boolean; voiceOverOnly?: boolean }
): Array<"narrator" | "cutaway"> {
  const n = Math.max(1, Math.floor(total));
  if (options?.voiceOverOnly ?? NARRATOR_VOICE_OVER_ONLY) {
    return Array.from({ length: n }, () => "cutaway" as const);
  }
  if (n === 1) return ["narrator"];
  if (n === 2) return ["narrator", "cutaway"];
  // NetShort: hikaye dunyasi agirlikli; anlatici her 4. + final.
  const period = options?.cutawayHeavy ? 4 : 3;
  const out: Array<"narrator" | "cutaway"> = [];
  for (let i = 1; i <= n; i++) {
    const periodic = i % period === 1;
    const isLast = i === n;
    out.push(periodic || isLast ? "narrator" : "cutaway");
  }
  return out;
}

export function composeNarratorFilmImagePrompt(options: {
  worldLock: string;
  sceneDescription: string;
  dialogue: string;
  clipSeconds?: number;
  previousScene?: string;
  previousShotType?: string;
  shotType?: string;
  camera?: string;
  lighting?: string;
  secondBySecond?: string;
  onScreenCastLock?: string;
  emotion?: string;
  performance?: string;
  motion?: string;
  settingType?: string;
  environment?: string;
  background?: string;
  setDressing?: string;
  atmosphere?: string;
}): string {
  const seconds = Math.max(4, Math.min(20, Math.round(options.clipSeconds || 8)));
  const scene = options.sceneDescription.replace(/\s+/g, " ").trim();
  const dial = options.dialogue.replace(/\s+/g, " ").trim();
  const wordLock = [
    "STORY-WORD VISUAL LOCK:",
    "Stage people, places, weather and props named in SHOT. Speech is AUDIO only — never paint letters onto the frame.",
    dial ? `Spoken line (audio, never subtitle): "${dial.slice(0, 320)}".` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shotType = options.shotType === "narrator" ? "narrator" : "cutaway";
  const prevType = options.previousShotType === "narrator" ? "narrator" : options.previousShotType ? "cutaway" : "";
  const bridge =
    options.previousScene?.trim() && shotType && prevType && shotType !== prevType
      ? `[BRIDGE] Soft cut in the SAME continuous film — keep era, weather, wardrobe and lighting. Previous beat: ${options.previousScene.replace(/\s+/g, " ").trim().slice(0, 160)}`
      : options.previousScene?.trim()
        ? `[MATCH-ON-ACTION] This clip STARTS from the final second of the previous take — same place, same wardrobe, same hair, same lighting and time of day. Open a NEW location ONLY if the narration itself moves there. No teleport, no re-dress, no new photoshoot. Previous beat: ${options.previousScene.replace(/\s+/g, " ").trim().slice(0, 160)}`
        : "";
  const raw = [
    options.worldLock.trim(),
    shotType === "narrator"
      ? "[NARRATOR ON CAMERA] The storyteller woman is IN FRAME, speaking this line to camera in a lived-in room. Confession take — not a beauty ad, not a voice-over plate."
      : "[CUTAWAY] The narrator woman is NOT in this shot. Picture is dramatized story world under her voice-over.",
    "[CAST SIZE] Named faces = people named in the VO (1-4). Original fictional adults. Anonymous crowd FORBIDDEN.",
    "[ACTION→REACTION] Prefer one clear ACTION (power/humiliation/slap/shove/paper) or one REACTION close-up — not both diluted. Next clip answers this beat.",
    "[POWER] Status crush visible: look-down, lean-in, turn-away victory, slammed door. NO blood, NO weapons, NO killing.",
    scene ? `[SHOT] ${scene}` : "",
    options.onScreenCastLock?.trim() ? `[ON-SCREEN CAST LOCK] ${options.onScreenCastLock.trim()}` : "",
    options.emotion?.trim() ? `[EMOTION BEAT] ${options.emotion.trim()}` : "",
    `[NETSHORT EMOTION LOCK] ${netShortFlowEmotionCue(options.emotion)}`,
    options.performance?.trim() ? `[PERFORMANCE] ${options.performance.replace(/\s+/g, " ").trim()}` : "",
    options.motion?.trim() ? `[MOTION] ${options.motion.replace(/\s+/g, " ").trim()}` : "",
    options.camera?.trim() ? `[CAMERA] ${options.camera.trim()}` : "",
    options.lighting?.trim() ? `[LIGHTING] ${options.lighting.trim()}` : "",
    options.secondBySecond?.trim()
      ? `[TIMELINE ${seconds}s] ${options.secondBySecond.replace(/\s+/g, " ").trim()}`
      : "",
    bridge,
    formatNarratorWorldDetail(options),
    wordLock,
  ]
    .filter(Boolean)
    .join("\n");
  return raw;
}

/**
 * Sahne plani eksik mi? Yalnizca sceneDescription yoksa OpenAI gerekir.
 * emotion / [ENVIRONMENT] eksigi yerel compose ile doldurulabilir — tum filmi
 * yeniden planlatip yari yolda birakmasin.
 */
export function clipNeedsNarratorFilmPlan(clip: {
  status: string;
  sceneDescription?: string | null;
  emotionLabel?: string | null;
  imagePrompt?: string | null;
  shotType?: string | null;
}): boolean {
  if (clip.status === "completed") return false;
  return !clip.sceneDescription?.trim();
}

function loadWorldBible(slug: string): NarratorWorldBible | null {
  try {
    const file = worldFilePath(slug);
    if (!fs.existsSync(file)) return null;
    return narratorWorldBibleSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Film plani yokken prompt uretimini hic kirmaz: diyalogdan yerel cutaway sahnesi.
 * NetShort gorsel kilitleri imagePrompt'a gomulur; nihai Flow promptu yine buildClipPrompt'tan gelir.
 */
export function buildLocalNarratorSceneFallback(input: {
  dialogue: string;
  clipSeconds?: number;
  worldLock?: string;
  castHint?: string;
}): { sceneDescription: string; imagePrompt: string; emotionLabel: string } {
  const vo = input.dialogue.replace(/\s+/g, " ").trim().slice(0, 220);
  const who = input.castHint?.trim()
    ? `${input.castHint.trim()} on screen`
    : "story figures with unreadable faces if unnamed";
  const sceneDescription =
    `Contemporary NetShort drama cutaway. ${who}. Physical beat matching voice-over: "${vo || "tense pause"}". Lived-in Turkish city location, no readable text, narrator woman NOT in frame.`;
  const worldLock =
    input.worldLock?.trim() ||
    [
      `${NARRATOR_WORLD_LOCK_MARKER}: contemporary Turkish city NetShort drama; consistent wardrobe/lighting; no on-screen text.`,
      NARRATOR_NETSHORT_VISUAL_LOCK,
      NARRATOR_NETSHORT_FEMALE_LOOK_LOCK,
    ].join("\n");
  const imagePrompt = composeNarratorFilmImagePrompt({
    worldLock,
    sceneDescription,
    dialogue: input.dialogue,
    clipSeconds: input.clipSeconds || 8,
    shotType: "cutaway",
    emotion: "gergin",
    performance: "Body language shifts within the clip; no frozen tableau.",
    motion: "Slight handheld push-in; subject moves or turns.",
    settingType: "interior",
    environment: "Lived-in modern interior or city threshold with depth and practical lights.",
    background: "Foreground prop edge, mid-ground action, distant city or room life soft.",
    setDressing: "Everyday props without readable logos or letters.",
    atmosphere: "Cool evening practical light, soft haze.",
  });
  return { sceneDescription, imagePrompt, emotionLabel: "gergin" };
}

function defaultNarratorWorld(storyFingerprint: string): NarratorWorldBible {
  return {
    era: "contemporary",
    timeOfDay: "evening",
    weather: "clear",
    locations: ["luxury apartment", "city office", "car interior"],
    signatureProps: ["phone", "glass", "car keys"],
    worldLock:
      "Contemporary Turkish-city NetShort drama. Recurring luxury apartment, glass office, night car. Same wardrobe and practical lighting across clips. Narrator woman never on camera. No readable text.",
    storyFingerprint,
  };
}

function localFilmClipPlan(
  clip: { index: number; dialogue: string },
  onScreen: Array<{ name: string }>,
  clipSeconds: number,
  worldLock: string
): z.infer<typeof filmClipPlanSchema> {
  const filled = buildLocalNarratorSceneFallback({
    dialogue: clip.dialogue,
    clipSeconds,
    worldLock,
    castHint: onScreen[0]?.name,
  });
  return {
    clipIndex: clip.index,
    characterName: onScreen[0]?.name || "",
    secondCharacterName: onScreen[1]?.name || "",
    castCount: Math.max(1, Math.min(4, onScreen.length || 1)),
    scenePrompt: filled.sceneDescription,
    camera: "handheld push-in, eye-level",
    lighting: "practical interior, one key light",
    secondBySecond: "",
    emotion: filled.emotionLabel,
    performance: "Body language shifts within the clip; no frozen tableau.",
    motion: "Subject turns or steps; slight camera move.",
    narrationTone: "sakin yikici",
    settingType: "interior",
    environment: "Lived-in modern interior or city threshold with depth and practical lights.",
    background: "Foreground prop edge, mid-ground action, distant room or street life.",
    setDressing: "Everyday props without readable logos or letters.",
    atmosphere: "Cool evening practical light, soft haze.",
  };
}

/** Proje klasorundeki world.json'dan world lock (prompt/yerel yedek icin). */
export function resolveCachedNarratorWorldLock(slug: string): string {
  const world = loadWorldBible(slug);
  if (!world) return "";
  try {
    return buildNarratorWorldLock(world);
  } catch {
    return world.worldLock?.trim() || "";
  }
}

/** Hikaye degisince eski film-plan cache'ini gecersiz kil (fingerprint uyusmasin). */
export function invalidateNarratorWorldCache(slug: string): void {
  const world = loadWorldBible(slug);
  if (!world) return;
  try {
    persistWorldBible(slug, { ...world, storyFingerprint: `stale:${Date.now()}` });
  } catch {
    // dosya yoksa sessiz
  }
}

/** En az 3 taslak klip varsa ve hicbiri kameradaki anlatici degilse karisik cekim icin yeniden planla. */
export function pendingNeedNarratorMix(
  pending: Array<{ shotType?: string | null; status?: string }>
): boolean {
  // Voice-over only: tum cutaway dogru — anlatici ref / talking-head zorlama.
  if (NARRATOR_VOICE_OVER_ONLY) return false;
  const open = pending.filter((c) => c.status !== "completed");
  if (open.length < 3) return false;
  return open.every((c) => c.shotType !== "narrator");
}

/** Isimle kadro esle: birebir, sonra icerir (Ahmet / Ahmet Kaya). */
export function resolveNarratorCastMember<T extends { name: string }>(
  rawName: string | null | undefined,
  members: T[]
): T | undefined {
  return resolveCastMemberByName(rawName, members);
}

/** Tam ad veya (kadroda tek olan) ilk ad — "Ali" / "kalibre" yanlis eslesmesin. */
export function textMentionsNarratorName(text: string, name: string): boolean {
  return textMentionsCastName(text, name);
}

/** Sahne/diyalog metninde gecen kadro uyeleri (sira: once birincil, sonra metin sirasi). */
export function findNarratorCastInText<T extends { name: string }>(
  text: string,
  members: T[],
  primary?: T | null
): T[] {
  return findCastInText(text, members, primary);
}

/** Prompt icin yan kadro: anlatici (main) haric, sahnede adi gecenler; birincil kisi cikarilir. */
export function narratorSupportingCastForPrompt<T extends { id: string; name: string; role: string }>(
  members: T[],
  clip: {
    sceneDescription?: string | null;
    imagePrompt?: string | null;
    dialogue?: string | null;
    shotType?: string | null;
  },
  sceneCharacter?: T | null
): T[] {
  if (clip.shotType === "narrator") return [];
  const sides = members.filter((m) => m.role !== "main");
  const primary = sceneCharacter && sceneCharacter.role !== "main" ? sceneCharacter : undefined;
  return findNarratorCastInText(
    `${clip.sceneDescription || ""}\n${clip.imagePrompt || ""}\n${clip.dialogue || ""}`,
    sides,
    primary
  ).filter((m) => !sceneCharacter || m.id !== sceneCharacter.id);
}

/** Flow'a yuklenecek on+arka sheet'ler. Kesitte anlatici yok; itirafta yalnizca ana kadin. */
export function collectNarratorOnScreenSheets<
  T extends { id: string; name: string; role: string; referenceImagePath: string | null },
>(input: {
  cast: T[];
  characterId?: string | null;
  sceneDescription?: string | null;
  imagePrompt?: string | null;
  dialogue?: string | null;
  shotType?: string | null;
}): { sheetPaths: string[]; selectedNames: string[]; missingNames: string[]; onScreen: T[] } {
  if (input.shotType === "narrator") {
    const main = input.cast.find((c) => c.role === "main");
    const onScreen = main ? [main] : [];
    const sheetPaths: string[] = [];
    const selectedNames: string[] = [];
    const missingNames: string[] = [];
    for (const m of onScreen) {
      const p = m.referenceImagePath?.trim();
      if (p && fs.existsSync(p)) {
        sheetPaths.push(p);
        selectedNames.push(m.name.trim());
      } else if (m.name.trim()) {
        missingNames.push(m.name.trim());
      }
    }
    return { sheetPaths, selectedNames, missingNames, onScreen };
  }
  const sides = input.cast.filter((c) => c.role !== "main");
  const primary = input.characterId
    ? input.cast.find((c) => c.id === input.characterId && c.role !== "main")
    : undefined;
  const onScreen = findNarratorCastInText(
    `${input.sceneDescription || ""}\n${input.imagePrompt || ""}\n${input.dialogue || ""}`,
    sides,
    primary
  );
  const sheetPaths: string[] = [];
  const selectedNames: string[] = [];
  const missingNames: string[] = [];
  for (const m of onScreen) {
    const p = m.referenceImagePath?.trim();
    if (p && fs.existsSync(p)) {
      if (!sheetPaths.includes(p)) {
        sheetPaths.push(p);
        selectedNames.push(m.name.trim());
      }
    } else if (m.name.trim()) {
      missingNames.push(m.name.trim());
    }
  }
  return { sheetPaths, selectedNames, missingNames, onScreen };
}

/**
 * Flow referanslari — yuz bozulmasin:
 * - Sahnedeki kisinin sheet'i VARSA yalnizca o sheet(ler). Onceki son kare KARISMAZ
 *   (aksiyon karesi + baska/ayni yuz sheet'i Flow'u iki kisi sanir).
 * - Sahnede kimse yoksa onceki son kare (mekan/isik surekliligi).
 * - Anlatici portresi asla eklenmez.
 */
export function pickNarratorFilmReferencePaths(input: {
  previousLastFrame?: string | null;
  sceneCharacterImage?: string | null;
  sceneCharacterImages?: string[];
  usePrevLastFrame?: boolean;
  useReference?: boolean;
}): string[] {
  const sheets: string[] = [];
  if (input.useReference !== false) {
    for (const raw of [...(input.sceneCharacterImages ?? []), input.sceneCharacterImage ?? ""]) {
      const next = raw?.trim();
      if (next && !sheets.includes(next)) sheets.push(next);
    }
  }
  if (sheets.length > 0) return sheets.slice(0, 3);
  if (input.usePrevLastFrame !== false && input.previousLastFrame?.trim()) {
    return [input.previousLastFrame.trim()];
  }
  return [];
}

function worldFilePath(slug: string): string {
  return path.join(ensureProjectDirs(slug), "story", "world.json");
}

function persistWorldBible(slug: string, world: NarratorWorldBible): void {
  fs.writeFileSync(worldFilePath(slug), JSON.stringify(world, null, 2), "utf8");
}

function isPrismaMissingRecord(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025";
}

/** Clip update — kayit silinmisse (yeniden bolme yarisi) atla, tum plani dusurme. */
async function safeClipUpdate(
  clipId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    await prisma.clip.update({ where: { id: clipId }, data: data as never });
    return true;
  } catch (err) {
    if (isPrismaMissingRecord(err)) return false;
    // Orphan characterId FK: null'la tekrar dene
    const msg = err instanceof Error ? err.message : String(err);
    if (/Foreign key constraint|foreign key/i.test(msg) && "characterId" in data) {
      try {
        await prisma.clip.update({
          where: { id: clipId },
          data: { ...data, characterId: null } as never,
        });
        return true;
      } catch (err2) {
        if (isPrismaMissingRecord(err2)) return false;
        throw err2;
      }
    }
    throw err;
  }
}

/** Bu klip VO'sunda (ve gerekirse onceki cümle zamirinde) kim var — plan ismi yok sayilir. */
function onScreenForClip<T extends { id: string; name: string; storyRole?: string | null }>(
  clipDialogue: string,
  cast: T[],
  previousDialogue?: string
): T[] {
  return onScreenCastForClipBeat(clipDialogue || "", cast, previousDialogue);
}

/** Hikaye metni parmak izi — ayni dunya/kadro yalnizca ayni hikayede resume edilir. */
export function narratorStoryFingerprint(storyText: string): string {
  const s = storyText.replace(/\s+/g, " ").trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

/** Hikayeyi gercek sinema sahnelerine cevirir: kadro + dunya + karisik anlatici/cutaway.
 * force=true: yeni hikaye / "Film planini yenile" — eski world+kadro cache'ini yok say, taslak sahneleri sifirla.
 */
export async function planNarratorFilm(
  projectId: string,
  options?: { force?: boolean }
): Promise<{ castCount: number; cutawayCount: number }> {
  const force = Boolean(options?.force);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(
      "Proje bulunamadi — sekme eski veya proje silinmis. Guncel projeyi acip Film planini yenileyin."
    );
  }
  if (project.templateType !== "narrator") {
    throw new Error("Film plani yalnizca anlatici sablonunda calisir");
  }

  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  let clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  if (clips.length === 0) throw new Error("Once hikayeyi kliplere bolun");

  // Zorla yenile: tamamlanmamis kliplerin eski sahne/kadrosunu sil — yeni hikaye yazilsin.
  // Silmeden ONCE mevcut promptlar kalici arsive kopyalanir (tamamlanmis klipler zaten dokunulmaz).
  if (force) {
    const { archiveClipPrompts } = await import("@/server/services/prompt-archive");
    await archiveClipPrompts(projectId, "film plani zorla yenilendi", { languageVariant: "primary" });
    await prisma.clip.updateMany({
      where: {
        projectId,
        languageVariant: "primary",
        status: { not: "completed" },
      },
      data: {
        sceneDescription: "",
        imagePrompt: "",
        emotionLabel: "",
        voiceTone: "",
        characterId: null,
        prompt: "",
      },
    });
    clips = await prisma.clip.findMany({
      where: { projectId, languageVariant: "primary" },
      orderBy: { index: "asc" },
    });
  }

  // VO-only: eski "talking-head" kalintilarini hemen cutaway yap — yoksa UI "kimse yok / mekan"
  // derken sahne metninde Emre/Asli gorunur; sheet de yuklenmez.
  if (NARRATOR_VOICE_OVER_ONLY) {
    await prisma.clip.updateMany({
      where: {
        projectId,
        languageVariant: "primary",
        status: { not: "completed" },
        shotType: "narrator",
      },
      data: { shotType: "cutaway" },
    });
    for (const c of clips) {
      if (c.status !== "completed" && c.shotType === "narrator") c.shotType = "cutaway";
    }
  }

  const completed = clips.filter((c) => c.status === "completed").length;
  const draftClips = clips.filter((c) => c.status !== "completed");
  const clipSeconds = project.clipSeconds || 8;
  const hardDrama = isNarratorHardConflictGenre(project.genre);
  const mix = mixNarratorShotTypes(clips.length, {
    voiceOverOnly: NARRATOR_VOICE_OVER_ONLY,
    cutawayHeavy: hardDrama,
  });
  const filmGenreBlock = narratorGenreFilmBlock(project.genre);
  const visualLocks = [
    NARRATOR_NETSHORT_VISUAL_LOCK,
    NETSHORT_CORPUS_VISUAL_BEATS,
    netShortBeatsPromptBlock(6),
    netShortEmotionsVisualLock(4),
    // Sinema klipleri de gorsel anlati ile AYNI paletten duygu secer.
    netShortEmotionPaletteBlock(),
  ].join("\n");
  const storyText = (story?.fullStory || clips.map((c) => c.dialogue).join(" ")).slice(0, 6_000);
  const storyFp = narratorStoryFingerprint(storyText);

  await recordEvent({
    projectId,
    step: "cast",
    message: `Film plani hazirlaniyor (${clips.length} klip, ${draftClips.length} taslak · VO-only${force ? " · ZORLA YENI HIKAYE" : ""} · hizli)`,
  });

  // Onceki plandan kalan orphan characterId'leri temizle
  const { scrubOrphanClipCharacterIds } = await import("@/server/services/clips");
  await scrubOrphanClipCharacterIds(projectId);

  const existingSide = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  const cachedWorld = loadWorldBible(project.slug);
  const missingSceneCount = draftClips.filter((c) => clipNeedsNarratorFilmPlan(c)).length;
  const sameStory = Boolean(cachedWorld?.storyFingerprint && cachedWorld.storyFingerprint === storyFp);
  const reuseWorldAndCast =
    sameStory && Boolean(cachedWorld?.worldLock?.trim()) && existingSide.length > 0;

  let worldLock: string;
  if (reuseWorldAndCast && cachedWorld) {
    await recordEvent({
      projectId,
      step: "cast",
      message: force
        ? "Ayni hikaye — kadro/dunya duruyor, sahneler yerelde yazilacak (OpenAI sahne turu yok)"
        : `Film plani devam (ayni hikaye): ${missingSceneCount} eksik sahne — dunya/kadro korundu`,
    });
    persistWorldBible(project.slug, { ...cachedWorld, storyFingerprint: storyFp });
    worldLock = buildNarratorWorldLock(cachedWorld);
  } else {
    if (cachedWorld && !sameStory) {
      await recordEvent({
        projectId,
        step: "cast",
        level: "warning",
        message: "Hikaye degismis — eski dunya/kadro cache atildi, kadro GPT ile yenilenecek",
      });
    }
    try {
    const worldAndCast = await structuredCall<z.infer<typeof worldAndCastSchema>>({
      system: `Sen NetShort kisa-dram gorsel yonetmenisin. Film VOICE-OVER ONLY: anlatici kadin KADRAJDA YOK — yalnizca dis ses. Tum klipler hikaye dunyasi (cutaway).

${visualLocks}

${NARRATOR_NETSHORT_FEMALE_LOOK_LOCK}

GOREV 1 — DUNYA (modern sehir):
- era contemporary; timeOfDay + weather.
- locations: luks araba/ofis, dugun flashback veya magaza, yasayan ev. Soyut "bir ev" YASAK.
- signatureProps: divorce papers, hotel key card (okunur yazi YOK), office glass, city night.
- worldLock INGILIZCE 60-100 kelime. Klipler arasi AYNI dunya.
- BU HIKAYEYE OZEL yaz — onceki filmlerin kadro/mekanini kopyalama.

GOREV 2 — KADRO (anlatici YOK, en fazla ${NARRATOR_MAX_SIDE_CAST} yetiskin; her kayit TAM OLARAK 1 kisi):
- Bu hikayedeki isimler/roller (es, sekreter, aile…). Metindeki adlari kullan. Hikayede gecmeyen kisi UYDURMA.
- ${speechCastStoryLock(project.speechLanguage)}
- Her kayit TEK yetiskin. Cift/es/sevgili AYRI kayitlar olsun; ayni kayitta iki yuz/iki beden YOK.
- CINSIYET NET: hikayedeki zamir ve isme uy. Tek kadinsa gender=female (kadin yuzu, kadin kiyafeti). Tek erkekse gender=male.
- ${speechCastGenderHint(project.speechLanguage)}
- KADINLAR: yas 23-28, dogal guzel HANIMEFENDI (ozgun kurgu yuz; BEBEK SURAT YASAK, cirkin de YASAK). Unlu adi ve etnik tip etiketi YASAK. HAFIF MINI veya diz ustu zarif etek/elbise SERBEST; zarif topuklu serbest. Dekolte/crop/kulup/ic camasir YASAK. Hirka, kaban, muhafazakar ofis zorunlu degil; ciplaklik YASAK.
- ERKEKLER: 30-42, siradan sehir erkegi. Gunluk gomlek/jean. Sac/goz/ten/kiyafet SOMUT. Isimler tutarli.
- ZORUNLU CESITLILIK: Ayni cinsiyetteki kadro uyeleri BIRBIRINE BENZEMESIN. Her karakterin sac rengi/stili, goz rengi, ten tonu VE kiyafet rengi digerlerinden ACIKCA FARKLI olsun (or. bir kadin sarisin-mavi goz ise digeri kumral/kizil-yesil goz olsun; bir erkek lacivert gomlek ise digeri kahve/yesil tonda olsun). Ayni hikayede iki kadin veya iki erkek varsa aralarindaki farki appearancePrompt ve wardrobePrompt icinde ACIKCA yaz — kopyala-yapistir yuz/kiyafet YASAK.

YASAK: anlaticiyi kadroya ekleme. Yatak/porno/ciplaklik. Ergen/okul. Gercek kisi adi. Eski projeden kalma isim kopyalama. Prompta unlu/celebrity/fenomen kelimesi YAZMA. Ayni cinsiyetteki iki karaktere ayni sac/goz/kiyafet rengini verme.`,
      user: `Video: ${project.title || project.name}
Tur: ${resolveNarratorGenre(project.genre).label}
${filmGenreBlock}
Ozet: ${story?.summary || "-"}

HIKAYE (BUNA GORE YENI KADRO + DUNYA — eski kadroyu tekrarlama):
${storyText}`,
      schemaName: "narrator_world_cast",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          world: {
            type: "object",
            additionalProperties: false,
            properties: {
              era: { type: "string" },
              timeOfDay: { type: "string" },
              weather: { type: "string" },
              locations: { type: "array", items: { type: "string" } },
              signatureProps: { type: "array", items: { type: "string" } },
              worldLock: { type: "string" },
            },
            required: ["era", "timeOfDay", "weather", "locations", "signatureProps", "worldLock"],
          },
          cast: { type: "array", items: castMemberJson(project.speechLanguage) },
        },
        required: ["world", "cast"],
      },
      zodSchema: worldAndCastSchema,
      maxOutputTokens: 4_000,
      reasoningEffort: "low",
      timeoutMs: 45_000,
    });

    persistWorldBible(project.slug, { ...worldAndCast.world, storyFingerprint: storyFp });
    worldLock = buildNarratorWorldLock(worldAndCast.world);

    const gptCast = mergeStoryNamesIntoCastMembers(worldAndCast.cast as CastMember[], storyText);
    const existing = existingSide;
    const keepIds = new Set<string>();
    const firstName = (value: string) => value.trim().split(/\s+/)[0]?.toLowerCase() || "";
    // Cinsiyete ozel sayac: ayni cinsiyetteki kadro uyeleri farkli kiyafet
    // rengi alsin (GPT ayni renk/yuz yazsa bile kod tarafinda cesitlilik zorlanir).
    const genderColorIndex: Record<"male" | "female", number> = { male: 0, female: 0 };
    for (const rawMember of gptCast) {
      const gender = resolveCastGender(rawMember.name, rawMember.gender);
      const gendered = { ...rawMember, gender };
      const colorSeed = genderColorIndex[gender];
      genderColorIndex[gender] += 1;
      const member =
        gender === "male"
          ? normalizeNetShortMaleCast(gendered, colorSeed)
          : normalizeNetShortFemaleCast(gendered, colorSeed);
      const match =
        existing.find((c) => c.name.toLowerCase() === member.name.toLowerCase()) ||
        existing.find((c) => firstName(c.name) && firstName(c.name) === firstName(member.name));
      const appearance = appendFlowLocaleCast(
        composeCastAppearance(member, colorSeed),
        project.speechLanguage,
        gender,
        member.name
      );
      const data = {
        name: member.name,
        age: member.age,
        adult: true,
        gender: member.gender,
        nationalityLook: localeNationalityLook(project.speechLanguage),
        hair: member.hairDetail,
        faceFeatures: [member.eyeColor, member.skinTone, member.build].filter(Boolean).join(", "),
        storyRole: member.storyRole,
        storyNote: member.storyNote,
        voiceCharacter: member.voiceNote,
        wardrobe: member.wardrobePrompt,
        baseAppearancePrompt: appearance,
        baseWardrobePrompt: member.wardrobePrompt,
        imagePrompt: appearance,
        negativePrompt: "no text, no watermark, no logo, no child, no teen, no underage, no nudity",
        flowCharacterReference: flowHandleFromName(member.name),
      };
      if (match) {
        await prisma.characterProfile.update({ where: { id: match.id }, data });
        keepIds.add(match.id);
      } else {
        const created = await prisma.characterProfile.create({ data: { projectId, role: "side", ...data } });
        keepIds.add(created.id);
      }
    }
    // Yeni hikaye / force: eski isimleri (sheet olsa bile hikayede yoksa) temizle — completed yoksa.
    // Sheet'li ama isim degismisse: sheet kaybolmasin diye referansli olanlari tut (onceki davranis);
    // force + completed===0 ise referanssizlari sil; force'ta hikayede olmayan referanslilari da sil (yeni hikaye).
    if (completed === 0) {
      const toDelete = existing
        .filter((old) => {
          if (keepIds.has(old.id)) return false;
          const hasSheet = Boolean(old.referenceImagePath?.trim() || old.flowCharacterReference?.trim());
          if (!force && hasSheet) return false;
          return true;
        })
        .map((old) => old.id);
      if (toDelete.length > 0) {
        await prisma.clip.updateMany({
          where: { characterId: { in: toDelete } },
          data: { characterId: null },
        });
        await prisma.characterProfile.deleteMany({ where: { id: { in: toDelete } } });
      }
    }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (cachedWorld) {
        persistWorldBible(project.slug, { ...cachedWorld, storyFingerprint: storyFp });
        worldLock = buildNarratorWorldLock(cachedWorld);
      } else {
        const fallback = defaultNarratorWorld(storyFp);
        persistWorldBible(project.slug, fallback);
        worldLock = buildNarratorWorldLock(fallback);
      }
      await recordEvent({
        projectId,
        step: "cast",
        level: "warning",
        message: `Kadro/dunya GPT atlandi — yerel/cache ile devam: ${detail}`,
      });
    }
  }

  const addedNames = await persistStoryNamesToCast(projectId, storyText);
  if (addedNames > 0) {
    await recordEvent({
      projectId,
      step: "cast",
      message: `Hikayedeki ${addedNames} isim kadroya eklendi (GPT tavaninda dusmustu)`,
    });
  }

  const cast = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });

  const clipsByIndex = new Map(clips.map((c) => [c.index, c]));
  const planned = new Map<number, z.infer<typeof filmClipPlanSchema>>();
  // Resume: zaten planli klipleri tekrar cagirma; onceki sahne baglami icin sakla.
  for (const clip of clips) {
    if (!clip.sceneDescription?.trim() || !clip.emotionLabel?.trim()) continue;
    if (!/\[ENVIRONMENT\]/i.test(clip.imagePrompt || "")) continue;
    planned.set(clip.index, {
      clipIndex: clip.index,
      characterName: "",
      secondCharacterName: "",
      castCount: 1,
      scenePrompt: clip.sceneDescription,
      camera: "",
      lighting: "",
      secondBySecond: "",
      emotion: clip.emotionLabel,
      performance: "",
      motion: "",
      narrationTone: clip.voiceTone || "",
      settingType: "",
      environment: "",
      background: "",
      setDressing: "",
      atmosphere: "",
    });
  }

  const toPlan = draftClips.filter((c) => clipNeedsNarratorFilmPlan(c));
  await recordEvent({
    projectId,
    step: "cast",
    message: `Sahne plani yerel: ${toPlan.length}/${draftClips.length} taslak (OpenAI sahne turu yok)`,
  });

  async function persistClipPlan(
    clip: (typeof clips)[number],
    plan: z.infer<typeof filmClipPlanSchema> | undefined
  ) {
    const shotType = mix[clip.index - 1] ?? "cutaway";
    const isNarratorTake = shotType === "narrator";
    const scenePrompt = plan?.scenePrompt?.trim() || clip.sceneDescription.trim();
    if (!scenePrompt) return;
    const prevClipRow = clipsByIndex.get(clip.index - 1);
    const prevDialogue = prevClipRow?.dialogue || "";
    const onScreen = isNarratorTake ? [] : onScreenForClip(clip.dialogue, cast, prevDialogue);
    const member = onScreen[0];

    const actionBit = [plan?.performance?.trim(), plan?.motion?.trim()].filter(Boolean).join(" / ").slice(0, 140);
    const onScreenCastLock = isNarratorTake
      ? "NARRATOR ON CAMERA: only the storyteller woman."
      : onScreen.length
        ? [
            `ON-SCREEN (${onScreen.length} named face${onScreen.length > 1 ? "s" : ""}):`,
            ...onScreen.map((m, i) => {
              const lead = i === 0 && member?.id === m.id ? "LEAD" : "ALSO";
              const look = (m.baseAppearancePrompt || m.name).slice(0, 120);
              const wardrobe = m.baseWardrobePrompt ? ` | ${m.baseWardrobePrompt.slice(0, 60)}` : "";
              const does = actionBit && i === 0 ? ` | ACT: ${actionBit}` : "";
              return `${lead} ${m.name}: ${look}${wardrobe}${does}`;
            }),
          ].join(" ")
        : "No named cast — anonymous extras only, faces unreadable. Do not invent a new recurring person.";
    const prevPlan = planned.get(clip.index - 1);
    const prevScene = prevPlan?.scenePrompt || prevClipRow?.sceneDescription || "";
    const previousShotType = mix[clip.index - 2] || prevClipRow?.shotType || "";
    const imagePrompt = composeNarratorFilmImagePrompt({
      worldLock,
      sceneDescription: scenePrompt,
      dialogue: clip.dialogue,
      clipSeconds,
      previousScene: clip.index > 1 ? prevScene : "",
      previousShotType,
      shotType,
      camera: plan?.camera,
      lighting: plan?.lighting,
      secondBySecond: plan?.secondBySecond,
      onScreenCastLock,
      emotion: plan?.emotion || clip.emotionLabel,
      performance: plan?.performance,
      motion: plan?.motion,
      settingType: plan?.settingType,
      environment: plan?.environment,
      background: plan?.background,
      setDressing: plan?.setDressing,
      atmosphere: plan?.atmosphere,
    });

    const ok = await safeClipUpdate(clip.id, {
      shotType,
      characterId: (onScreen[0] ?? member)?.id ?? null,
      sceneDescription: scenePrompt,
      imagePrompt,
      emotionLabel: plan?.emotion?.trim() || clip.emotionLabel || "gergin",
      voiceTone: plan?.narrationTone?.trim() || clip.voiceTone,
      prompt: "",
    });
    if (!ok) return;
    clip.shotType = shotType;
    clip.sceneDescription = scenePrompt;
    clip.imagePrompt = imagePrompt;
    clip.emotionLabel = plan?.emotion?.trim() || clip.emotionLabel || "gergin";
    clip.characterId = (onScreen[0] ?? member)?.id ?? null;
  }

  for (const clip of toPlan) {
    const prevDialogue = clipsByIndex.get(clip.index - 1)?.dialogue || "";
    const onScreen = onScreenForClip(clip.dialogue, cast, prevDialogue);
    const plan = localFilmClipPlan(clip, onScreen, clipSeconds, worldLock);
    planned.set(clip.index, plan);
    await persistClipPlan(clip, plan);
  }

  // Shot type + characterId yeniden bagla; sahnesiz kalanlari yerel yedekle doldur.
  let cutawayCount = 0;
  let narratorCount = 0;
  let relinked = 0;
  let filledLocal = 0;
  const freshCast = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  for (const clip of clips) {
    if (clip.status === "completed") {
      if (clip.shotType === "narrator") narratorCount++;
      else cutawayCount++;
      continue;
    }
    const shotType = mix[clip.index - 1] ?? "cutaway";

    const prevDialogue = clips.find((c) => c.index === clip.index - 1)?.dialogue || "";
    const onScreen =
      shotType === "narrator" ? [] : onScreenForClip(clip.dialogue || "", freshCast, prevDialogue);
    const hint = onScreen[0];

    if (!clip.sceneDescription?.trim()) {
      const filled = buildLocalNarratorSceneFallback({
        dialogue: clip.dialogue,
        clipSeconds,
        worldLock,
        castHint: hint?.name,
      });
      const ok = await safeClipUpdate(clip.id, {
        shotType,
        sceneDescription: filled.sceneDescription,
        imagePrompt: filled.imagePrompt,
        emotionLabel: filled.emotionLabel,
        characterId: hint?.id ?? null,
        prompt: "",
      });
      if (ok) {
        clip.sceneDescription = filled.sceneDescription;
        clip.imagePrompt = filled.imagePrompt;
        clip.emotionLabel = filled.emotionLabel;
        clip.characterId = hint?.id ?? null;
        clip.shotType = shotType;
        filledLocal++;
      }
    }

    const nextCharacterId = shotType === "narrator" ? null : hint?.id ?? null;
    const patch: { shotType?: string; characterId?: string | null } = {};
    if (clip.shotType !== shotType) patch.shotType = shotType;
    if ((clip.characterId || null) !== nextCharacterId) {
      patch.characterId = nextCharacterId;
      if (nextCharacterId) relinked++;
    }
    if (Object.keys(patch).length > 0) {
      const ok = await safeClipUpdate(clip.id, patch);
      if (ok) {
        if (patch.shotType) clip.shotType = patch.shotType;
        if (patch.characterId !== undefined) clip.characterId = patch.characterId;
      }
    }
    if (shotType === "narrator") narratorCount++;
    else cutawayCount++;
  }

  await recordEvent({
    projectId,
    step: "cast",
    message: `${freshCast.length} kadro, ${cutawayCount} film sahnesi + ${narratorCount} talking-head${relinked > 0 ? ` · ${relinked} klip karaktere baglandi` : ""}${filledLocal > 0 ? ` · ${filledLocal} sahne yerel dolduruldu` : ""}${completed > 0 ? ` (${completed} tamamlanmis korundu)` : ""}`,
  });

  return { castCount: freshCast.length, cutawayCount };
}

const narratorSpokenPolishSchema = z.object({
  lines: z.array(
    z.object({
      clipIndex: z.number().int().min(1),
      dialogue: z.string().min(8),
      voiceTone: z.string().default(""),
      emotionLabel: z.string().default(""),
      visualActing: z.string().default(""),
    })
  ),
});

function patchImagePromptTag(source: string, tag: string, value: string): string {
  const nextValue = value.replace(/\s+/g, " ").trim();
  if (!nextValue) return source;
  const re = new RegExp(`\\[${tag}\\]\\s*[^\\[]*`, "i");
  if (re.test(source)) return source.replace(re, `[${tag}] ${nextValue} `);
  return `${source.trim()}\n[${tag}] ${nextValue}`;
}

/**
 * Sinema anlatici: splitter'dan kalan "X, dedi" / sahne taslagi karisik
 * satirlari, 10 sn'de soylenebilir birinci sahis itirafa cevirir.
 * Iliski turlerinde NetShort ton (sakin yikici + donus); klip sayisi/sira degismez.
 */
export async function polishNarratorSpokenLines(projectId: string): Promise<{ updated: number }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.templateType !== "narrator") {
    throw new Error("Bu duzeltme yalnizca sinema anlatici projeleri icindir");
  }
  const hard = isNarratorHardConflictGenre(project.genre);
  const settings = await getSettings();
  const wpm = wpmForPace(settings, project.speechPace);
  const fill = speechFillRatioFor("narrator");
  const maxWords = maxWordsForClipSeconds(project.clipSeconds || 10, wpm, fill);
  const minWords = minWordsForClipSeconds(project.clipSeconds || 10, wpm, fill);
  // Tamamlanan klip dokunulmaz (videosu uretildi); duzeltme oncesi promptlar arsivlenir.
  {
    const { archiveClipPrompts } = await import("@/server/services/prompt-archive");
    await archiveClipPrompts(projectId, "diyalog ton duzeltme", { languageVariant: "primary" });
  }
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary", status: { not: "completed" } },
    orderBy: { index: "asc" },
    select: {
      id: true,
      index: true,
      dialogue: true,
      sceneDescription: true,
      voiceTone: true,
      shotType: true,
      emotionLabel: true,
      imagePrompt: true,
    },
  });
  if (clips.length === 0) return { updated: 0 };

  const CHUNK = 8;
  let updated = 0;
  for (let start = 0; start < clips.length; start += CHUNK) {
    const batch = clips.slice(start, start + CHUNK);
    const prev = start > 0 ? clips[start - 1] : null;
    const list = batch
      .map(
        (c) =>
          `Klip ${c.index} [${c.shotType || "cutaway"}]\nSahne: ${c.sceneDescription || "(yok)"}\nDuygu: ${c.emotionLabel || "(yok)"}\nMevcut: "${c.dialogue}"`
      )
      .join("\n\n");
    const heatRules = hard
      ? `
NETSHORT TON (iliski kisa dramasi):
- Melodramli hüzün şiiri YASAK. Surekli bagirma/kufur yagmuru da YASAK.
- Omurga sozleri: sakin yikici karar, pişkin ihanet, donuste soguk zafer, pismanlik.
- Bu 8'li partide EN AZ 1 sakin yikici cumle ruhu; EN AZ 1 status/donus veya pismanlik dokunusu.
- ${netShortEmotionPaletteBlock()}
- voiceTone: ses yonetmeni (controlled cold; bitter smile; quiet devastating; regret crack).
- visualActing: Ingilizce 18-40 kelime: cold stare, turning away, luxury contrast, controlled smile — not endless shout-face.`
      : `
- ${netShortEmotionPaletteBlock()}
- voiceTone: ses yonetmeni notu; NetShort duygusal darbe OK.
- visualActing: Ingilizce kisa beden oyunu; conflict OK.`;
    const result = await structuredCall({
      system: `Sen sinema anlatici diyalog duzeltmenisin. Cikti yalnizca JSON.

KURALLAR:
- Tek ses: evli kadin, BIRINCI SAHIS. Kameraya veya ic monolog.
- "Isim:" yok. "Deniz, dedi" ucuncu sahis YASAK.
- Her satir SESLI SOYLENECEK soz. Yonetmen notu KARISTIRMA.
- Dil: ${project.speechLanguage}. Cikti yalnizca bu dilde olsun; baska dile kayma.
- Her klip ${minWords}-${maxWords} kelime (hedef ${maxWords}). ${project.clipSeconds || 10} sn.
- Anlami koru: ayni olay, ayni nesne. Yeni olay yok.
- TEMPO: klip 2-5 ozellikle HIZLI NetShort ritm (uzun-uzun-KISA). "Oturdum dusundum" / uzun duygu ozeti YASAK; her satirda darbe veya yeni bilgi.
- emotionLabel / voiceTone / visualActing her klip icin doldur.
${heatRules}
- Klipler ARDISIK tek film.
- Parantez yok.
${heatRules}`,
      user: `${prev ? `Onceki klip ${prev.index} sozu (devam ettir): "${prev.dialogue}"\n\n` : ""}Film: ${project.title}
Tur: ${resolveNarratorGenre(project.genre).label}

${list}

clipIndex birebir eslessin.`,
      schemaName: "narrator_spoken_polish",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                clipIndex: { type: "integer" },
                dialogue: { type: "string" },
                voiceTone: { type: "string" },
                emotionLabel: { type: "string" },
                visualActing: { type: "string" },
              },
              required: ["clipIndex", "dialogue", "voiceTone", "emotionLabel", "visualActing"],
            },
          },
        },
        required: ["lines"],
      },
      zodSchema: narratorSpokenPolishSchema,
      maxOutputTokens: 8_000,
      reasoningEffort: "low",
      timeoutMs: 180_000,
    });

    const byIndex = new Map(result.lines.map((l) => [l.clipIndex, l]));
    for (const clip of batch) {
      const line = byIndex.get(clip.index);
      const nextDialogue = (line?.dialogue || clip.dialogue).replace(/\s+/g, " ").trim();
      if (!nextDialogue) continue;
      const words = countWords(nextDialogue);
      const voiceTone = line?.voiceTone?.trim() || clip.voiceTone;
      const emotionLabel = line?.emotionLabel?.trim() || clip.emotionLabel;
      let imagePrompt = stripEmbeddedOnscreenTextTails(clip.imagePrompt || "");
      if (emotionLabel) imagePrompt = patchImagePromptTag(imagePrompt, "EMOTION BEAT", emotionLabel);
      if (line?.visualActing?.trim()) {
        imagePrompt = patchImagePromptTag(imagePrompt, "PERFORMANCE", line.visualActing.trim());
      }
      await prisma.clip.update({
        where: { id: clip.id },
        data: {
          dialogue: nextDialogue,
          voiceTone,
          emotionLabel,
          imagePrompt,
          estimatedWords: words,
          estimatedDurationSeconds: estimateSpeechSeconds(words, wpm),
          prompt: "",
        },
      });
      updated += 1;
    }
  }

  await recordEvent({
    projectId,
    step: "prompts",
    message: hard
      ? `${updated} klip diyalogu NetShort tona cekildi (sakin yikici / donus / pismanlik; ${minWords}-${maxWords} kelime).`
      : `${updated} klip diyalogu konusulabilir birinci sahisa cekildi (${minWords}-${maxWords} kelime / ${project.clipSeconds || 10}s).`,
  });
  return { updated };
}

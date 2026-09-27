import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Project, Story } from "@prisma/client";
import { prisma } from "@/server/db";
import { structuredCall } from "@/server/services/openai";
import { computeTargetWords, countWords, estimateSpeechSeconds, saveStory, seedNamedPeopleAsCast, type StoryPayload } from "@/server/services/story";
import { curiosityRulesForLongform } from "@/server/services/curiosity";
import { describeTtsSecrets, getSettings, ttsSettingsView, wpmForPace } from "@/server/services/settings";
import { generateLongformStillsWithFlow } from "@/server/services/longform-stills-flow";
import { resolveFlowImageModel } from "@/lib/flow-generation-settings";
import { hydrateProjectFlowImageModel } from "@/server/lib/flow-image-model-store";

import { archiveClipPrompts } from "@/server/services/prompt-archive";
import { ensureProjectDirs, safeProjectPath } from "@/server/lib/paths";
import { recordEvent } from "@/server/lib/logger";
import { assembleLongform } from "@/server/services/ffmpeg";
import { renderKenBurnsSegment } from "@/server/services/ken-burns";
import { synthesizeSpeech, sanitizeLongformSpeech, type SentenceTimestamp } from "@/server/services/tts";
import { buildSrtContent, buildFilmStyleSrtCues, buildSrtCuesFromTimestamps } from "@/server/services/srt";
import {
  assertLongformContinuing,
  finishLongformJob,
  isLongformCancelledError,
  isLongformCancelRequested,
  longformAbortSignal,
  startLongformJob,
  updateLongformJob,
} from "@/server/services/longform-jobs";
import {
  estimateLongformStillCount,
  formatLongformCastBudget,
  isLongformDramaGenre,
  longformGenreById,
  longformImageSourceLabel,
  longformNamedCastBudget,
  longformSettingsSource,
  parseLongformSettings,
  resolveLongformGenre,
  serializeLongformSettings,
  type LongformGenre,
  type LongformSettings,
} from "@/lib/longform-catalog";
import { longformEncodeProfile, longformFrameSize, longformResolutionInfo } from "@/lib/longform-render";
import { narratorGenreStoryBlock } from "@/lib/narrator-genres";
import { speechCastStoryLock, speechOutputLanguageLock } from "@/lib/speech-cast-locale";
import { ELEVENLABS_VOICE_ID, ttsProviderInfo } from "@/lib/tts-catalog";
import { resolveElevenLabsVoice } from "@/server/services/elevenlabs-voices";
import { applyTtsPerformance, ttsPerformanceFor } from "@/lib/tts-performance";
import { buildLongformBeatVisuals, collectStillReferenceSheets, extractProperNames, guessTurkishGivenNameGender, isLikelyPersonName, STILL_SHEET_LOCK, stripTurkishPossessive } from "@/lib/longform-netshort-stills";
import { longformStillStyleText } from "@/server/services/prompt-builder";
import { ensureStillFrontReference } from "@/lib/still-front-crop";
import { prepareLiveActionFlowPrompt } from "@/lib/flow-prompt-safety";
import { filmCityFor, REALITY_LOCK_TAG, realityLockBlock } from "@/lib/reality-lock";
import { getOrCreateMainCharacter } from "@/server/services/character";
import { ensureCastLooks, uniqueLookForIndex } from "@/server/services/cast";
import {
  buildLongformFingerprint,
  isLongformProduceStep,
  parseLongformFingerprint,
  imageSourceChanged,
  shouldRebuildBeats,
  shouldRebuildMix,
  shouldRebuildSegments,
  shouldRebuildVoice,
  stillFileName,
  type LongformProduceStep,
} from "@/lib/longform-pipeline";

export type LongformActRole = "opening" | "act" | "closing";

export interface LongformActPlan {
  index: number;
  role: LongformActRole;
  label: string;
  targetWords: number;
  cliffhanger: boolean;
}

export interface LongformBeatDraft {
  narration: string;
  estimatedSeconds: number;
  wordCount: number;
}

const LONGFORM_SYSTEM_RULES = `
Sen, YouTube icin 15-60 dakikalik DIS SES belgeseli yazan usta bir belgesel yazarisin.

SADECE SES METNI YAZ. Gorsel / slayt / kamera / altyazi tarif etme.

ZORUNLU:
- Anlatim UCUNCU TEKIL. Kameraya konusma yok. "ben / biz / merhaba" yok. "Isim:" etiketi yok.
- fullText / fullStory: yalnizca agizdan okunacak cumleler. Parantez, sahne notu, yonetmen talimati YASAK.
- Tek omurga: ayni soru / dosya / sir. Her kisa parca yeni mini-hikaye acmasin.
- Kelime hedefine +-%12 uy. Dil, kullanicinin sectigi konusma dili olsun.
- Son bolum ana soruyu kapatir. "Devam edecek" yok.
`.trim();

const LONGFORM_DRAMA_SYSTEM_RULES = `
Sen, YouTube icin uzun DIS SES iliski kisa-dramı (NetShort ruhu) yazan anlatici-senaristsin.

SADECE SES METNI. Gorsel/kamera tarif etme.

ZORUNLU:
- BIRINCI TEKIL. Anlatici ekranda yok. "Merhaba ben..." yok. "Ayse:" yok.
- fullText: yalnizca okunacak cumleler. Parantez YASAK.
- Omurga: ihanet/asagilanma → sakin yikici karar → zaman/guc atlamasi → donus → pismanlik.
- Goz detayi: ofis, araba, dugun flashback, luks vs bosluk.
- ISIMLER: kisileri OZEL ISIMLE yaz — konusma diline uygun yetiskin adlar. 'kocam/o' yetmez. Kadro sureye gore genis olsun; ayni 2 yuzle 10 dakikayi doldurma. Isimler tekrar etsin — kareler bu adlara gore kurulur.
- ETKI→TEPKI: eylem cumlesi + hemen ardindan yuz/beden tepkisi. Kalabalik sofra YASAK.
- DUYGU: donuk asagilanma, hakaretle asagilama, ezme hamlesi, soguk kin, pişkin ustunluk, status zaferi, pismanlik bogulmasi — yumusak hüzün şiiri YASAK.
- SERTLIK: kamusal kucultme + fiziksel ustunluk (omuz itme, kagit firlatma, kahve dokme) + acimasiz pişkinlik SAHNEYE yazilir; finalde ayni jestler tersine doner. Kan/silah/oldurme YASAK.
- Yatak/porno YASAK. 18 yas alti yok. Kelime +-%12. Son bolum kapansin.

SURUKLEYICILIK:
- Ozet degil sahne. Sakin yikici cumleler bagirma yagmurundan gucludur.
- Pişkin ihanet + donuste soguk zafer. Status cevirisi zorunlu.
- Her bolum zincire halka + duygusal darbe.
`.trim();

function longformPovLine(genre: { pov: "first" | "third"; label: string }): string {
  return genre.pov === "first"
    ? `KISI: birinci tekil (ben). "${genre.label}" belgesel ucuncu tekil kilidine UYMA.`
    : `KISI: ucuncu tekil belgesel sesi. "ben / merhaba" YOK.`;
}

function longformStorySystem(
  genre: Pick<LongformGenre, "id" | "label" | "narrationTone">,
  language?: string | null
): string {
  if (!isLongformDramaGenre(genre.id)) {
    return `${LONGFORM_SYSTEM_RULES}\n\n${speechCastStoryLock(language)}\n\n${speechOutputLanguageLock(language)}`;
  }
  const lockKey = genre.id === "ozel" ? genre.label : genre.id;
  const lock = narratorGenreStoryBlock(lockKey);
  return [
    LONGFORM_DRAMA_SYSTEM_RULES,
    speechCastStoryLock(language),
    speechOutputLanguageLock(language),
    `Tur / ton: ${genre.narrationTone}`,
    genre.id === "ozel"
      ? `ZORUNLU OZEL TUR: Senaryo "${genre.label}" kelimesine gore yazilsin. Bu kelime hikayenin omurgasi olsun; katalog turune kayma.`
      : "",
    lock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const outlinePersonSchema = z.object({
  name: z.string().min(2),
  storyRole: z.string().min(2),
  gender: z.enum(["male", "female"]),
});

const outlineSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  hook: z.string(),
  contentWarnings: z.array(z.string()),
  characterVoiceNotes: z.string(),
  namedPeople: z.array(outlinePersonSchema).default([]),
  acts: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      promisedQuestion: z.string(),
    })
  ),
});

const actTextSchema = z.object({
  fullText: z.string().min(1),
  closingLine: z.string(),
});

const OUTLINE_JSON: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    hook: { type: "string" },
    contentWarnings: { type: "array", items: { type: "string" } },
    characterVoiceNotes: { type: "string" },
    namedPeople: {
      type: "array",
      description: "Hikayedeki isimli yuzler (anlatici ben haric). Drama icin sure butcesine gore 5-7 kisi (10 dk).",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          storyRole: { type: "string" },
          gender: { type: "string", enum: ["male", "female"] },
        },
        required: ["name", "storyRole", "gender"],
      },
    },
    acts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          promisedQuestion: { type: "string" },
        },
        required: ["title", "summary", "promisedQuestion"],
      },
    },
  },
  required: ["title", "summary", "hook", "contentWarnings", "characterVoiceNotes", "namedPeople", "acts"],
};

const ACT_JSON: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    fullText: { type: "string" },
    closingLine: { type: "string" },
  },
  required: ["fullText", "closingLine"],
};

function guessStoryNameGender(name: string): "male" | "female" {
  return guessTurkishGivenNameGender(name);
}

/** Plan kadrosu + hikaye metnindeki isimler; sure butcesine sigdirilir. */
export function mergeLongformNamedPeople(
  planned: Array<{ name: string; storyRole: string; gender: "male" | "female" }>,
  storyText: string,
  maxCast: number
): Array<{ name: string; storyRole: string; gender: "male" | "female" }> {
  const out: Array<{ name: string; storyRole: string; gender: "male" | "female" }> = [];
  const seen = new Set<string>();
  const add = (person: { name: string; storyRole: string; gender: "male" | "female" }) => {
    const name = stripTurkishPossessive(person.name.replace(/\s+/g, " ").trim());
    const key = name.toLowerCase();
    if (!isLikelyPersonName(name) || seen.has(key) || out.length >= Math.max(1, maxCast)) return;
    seen.add(key);
    out.push({ name, storyRole: person.storyRole.trim() || "hikaye kisisi", gender: person.gender });
  };
  for (const person of planned) add(person);
  for (const name of extractProperNames(storyText)) {
    add({ name, storyRole: "hikaye kisisi", gender: guessStoryNameGender(name) });
  }
  return out;
}

/** Kare promptunda "Mert (adult man)" yazilabilmesi icin isim -> cinsiyet. */
function castGenderMap(
  cast: Array<{ name: string; gender: string }>
): Record<string, "male" | "female"> {
  const map: Record<string, "male" | "female"> = {};
  for (const member of cast) {
    const key = foldCastNameKey(member.name);
    if (!key) continue;
    map[key] = member.gender === "female" ? "female" : "male";
  }
  return map;
}

/** guessTurkishGivenNameGender ile ayni anahtar bicimi (İ/I duyarli). */
function foldCastNameKey(name: string): string {
  return stripTurkishPossessive(name)
    .trim()
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase();
}

async function longformCastRoster(
  projectId: string
): Promise<{ roster: string[]; leadName: string; castGenders: Record<string, "male" | "female"> }> {
  const cast = await prisma.characterProfile.findMany({
    where: { projectId, role: { in: ["main", "side"] } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  const lead = cast.find((c) => c.role === "main");
  const leadName = lead?.name.trim() || "Anlatıcı";
  const roster = cast.map((c) => c.name.trim()).filter(isLikelyPersonName);
  if (leadName && !roster.some((n) => n.toLowerCase() === leadName.toLowerCase())) roster.unshift(leadName);
  return { roster, leadName, castGenders: castGenderMap(cast) };
}

/** Ana karakteri birinci tekil yuz yapar, hikaye isimlerini kadroya yazar, cop isimleri siler. */
async function ensureLongformCastReady(
  projectId: string
): Promise<{ roster: string[]; leadName: string; castGenders: Record<string, "male" | "female"> }> {
  const main = await getOrCreateMainCharacter(projectId);
  if (!main.name.trim()) {
    await prisma.characterProfile.update({
      where: { id: main.id },
      data: { name: "Anlatıcı", storyRole: main.storyRole || "birinci tekil anlatıcı" },
    });
  }
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  if (story?.fullStory.trim()) {
    await seedNamedPeopleAsCast(projectId, mergeLongformNamedPeople([], story.fullStory, 10));
  }
  const wanted = new Set(
    (story?.fullStory.trim() ? mergeLongformNamedPeople([], story.fullStory, 10) : []).map((p) =>
      p.name.trim().toLowerCase()
    )
  );
  const junk = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  for (const side of junk) {
    const canonical = stripTurkishPossessive(side.name).trim();
    const duplicate =
      canonical &&
      canonical.toLowerCase() !== side.name.trim().toLowerCase() &&
      junk.find(
        (other) =>
          other.id !== side.id && stripTurkishPossessive(other.name).trim().toLowerCase() === canonical.toLowerCase()
      );
    const extra =
      wanted.size > 0 &&
      !wanted.has(side.name.trim().toLowerCase()) &&
      !wanted.has(canonical.toLowerCase());
    const drop = Boolean(duplicate) || !isLikelyPersonName(side.name) || extra;
    if (!drop) {
      if (canonical && canonical !== side.name.trim() && isLikelyPersonName(canonical) && !side.referenceImagePath) {
        await prisma.characterProfile.update({ where: { id: side.id }, data: { name: canonical } });
      }
      continue;
    }
    await prisma.clip.updateMany({ where: { characterId: side.id }, data: { characterId: null } });
    if (side.referenceImagePath && fs.existsSync(side.referenceImagePath)) {
      fs.rmSync(side.referenceImagePath, { force: true });
    }
    await prisma.characterProfile.delete({ where: { id: side.id } }).catch(() => {});
  }
  const sidesAfter = await prisma.characterProfile.findMany({
    where: { projectId, role: "side" },
    orderBy: { createdAt: "asc" },
  });
  for (let i = 0; i < sidesAfter.length; i++) {
    const side = sidesAfter[i];
    const expected = guessTurkishGivenNameGender(side.name);
    const text = `${side.baseAppearancePrompt} ${side.imagePrompt}`.toLowerCase();
    const lookWrong =
      expected !== side.gender ||
      (expected === "female" && /\bman\b/.test(text) && !/\bwoman\b/.test(text)) ||
      (expected === "male" && /\bwoman\b/.test(text) && !/\bman\b/.test(text));
    if (!lookWrong) continue;
    if (side.referenceImagePath && fs.existsSync(side.referenceImagePath)) {
      fs.rmSync(side.referenceImagePath, { force: true });
    }
    const look = uniqueLookForIndex(i, expected, 0);
    await prisma.characterProfile.update({
      where: { id: side.id },
      data: {
        gender: expected,
        age: look.age,
        hair: look.hair,
        faceFeatures: look.faceFeatures,
        wardrobe: look.wardrobe,
        baseAppearancePrompt: look.appearance,
        baseWardrobePrompt: look.wardrobe,
        imagePrompt: look.appearance,
        referenceImagePath: null,
        imageApproved: false,
        flowCharacterReference: "",
      },
    });
  }
  await ensureCastLooks(projectId);
  return longformCastRoster(projectId);
}

export function planLongformActs(durationSeconds: number, wpm: number): LongformActPlan[] {
  const minutes = Math.max(5, durationSeconds / 60);
  const safeWpm = Math.max(60, wpm);
  const totalWords = Math.max(200, Math.round((durationSeconds / 60) * safeWpm));
  const middleCount = minutes <= 15 ? 3 : minutes <= 20 ? 4 : minutes <= 30 ? 5 : minutes <= 45 ? 6 : 8;
  const openingWords = Math.max(80, Math.round(totalWords * 0.1));
  const closingWords = Math.max(80, Math.round(totalWords * 0.1));
  const remaining = Math.max(middleCount * 80, totalWords - openingWords - closingWords);
  const perMiddle = Math.round(remaining / middleCount);
  const acts: LongformActPlan[] = [
    { index: 1, role: "opening", label: "Acilis kancasi", targetWords: openingWords, cliffhanger: true },
  ];
  let elapsedWords = openingWords;
  for (let i = 0; i < middleCount; i++) {
    elapsedWords += perMiddle;
    const elapsedMin = elapsedWords / safeWpm;
    const nearWindow = Math.abs(elapsedMin % 10) < (perMiddle / safeWpm) * 1.2 || Math.abs((elapsedMin % 10) - 10) < 1.5;
    acts.push({
      index: acts.length + 1,
      role: "act",
      label: `Bolum ${i + 1}`,
      targetWords: perMiddle,
      cliffhanger: i === middleCount - 1 || nearWindow,
    });
  }
  acts.push({
    index: acts.length + 1,
    role: "closing",
    label: "Kapanis",
    targetWords: closingWords,
    cliffhanger: false,
  });
  return acts;
}

export function splitNarrationIntoBeats(text: string, intervalSeconds: number, wpm: number): LongformBeatDraft[] {
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [];
  const wordsPerBeat = Math.max(8, Math.round((Math.max(10, intervalSeconds) / 60) * Math.max(60, wpm)));
  const beats: LongformBeatDraft[] = [];
  let buffer: string[] = [];
  let words = 0;
  const flush = () => {
    if (buffer.length === 0) return;
    const narration = buffer.join(" ");
    const wordCount = countWords(narration);
    beats.push({
      narration,
      wordCount,
      estimatedSeconds: Math.max(8, Math.round((wordCount / Math.max(60, wpm)) * 60)),
    });
    buffer = [];
    words = 0;
  };
  for (const sentence of sentences) {
    const wc = countWords(sentence);
    if (words + wc > wordsPerBeat && buffer.length > 0) flush();
    buffer.push(sentence);
    words += wc;
  }
  flush();
  return beats;
}

const STILL_NO_TEXT =
  "[SABIT KURAL — ALTYAZI YOK] Absolute rule: zero written characters, zero typography, zero numbers on signs, zero captions, subtitles, watermarks, logos, UI, phone-screen messages, or posters with readable words. Same ban on still 1 and still 1000.";

/** Konusma metnini ekran yazisi gibi cizdirmemek icin kisa gorsel ipucu. */
export function visualCuesFromNarration(narration: string): string {
  const cleaned = narration
    .replace(/["""''«»]/g, "")
    .replace(/\([^)]{0,80}\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter((w) => w.length > 2);
  return tokens.slice(0, 16).join(" ").slice(0, 120);
}

export function fallbackImagePrompt(narration: string, visualLock: string): string {
  const cues = visualCuesFromNarration(narration);
  return [
    "[STILL BEAT] Single cinematic 16:9 still, one place, a few objects, natural light.",
    visualLock,
    cues ? `Physical scene implied by this spoken moment (objects and place only, never as written words): ${cues}.` : "",
    "Do not paint speech, quotes, or letters. Adult figures only if implied; no minors.",
    STILL_NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: items.length === 0 ? 0 : n }, () => worker()));
  return results;
}

export function longformDirs(slug: string) {
  const root = ensureProjectDirs(slug);
  return {
    root,
    longform: path.join(root, "longform"),
    stills: path.join(root, "longform", "stills"),
    segments: path.join(root, "longform", "segments"),
    output: path.join(root, "output"),
    publish: path.join(root, "output", "publish"),
  };
}

/** TTS/voice artigi muzik sanilmasin diye. */
export function isLongformMusicFileName(name: string): boolean {
  if (!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return false;
  if (/^voice(?:-raw)?(?:[-.]|\.wav$)/i.test(name)) return false;
  if (/^tts-part[-.]/i.test(name)) return false;
  return true;
}

export function listLocalMusicFiles(projectSlug?: string): Array<{ fileName: string; path: string; source: "shared" | "project" }> {
  const found: Array<{ fileName: string; path: string; source: "shared" | "project" }> = [];
  const scan = (dir: string, source: "shared" | "project") => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!isLongformMusicFileName(name)) continue;
      found.push({ fileName: name, path: path.join(dir, name), source });
    }
  };
  scan(path.join(process.cwd(), "music"), "shared");
  if (projectSlug) scan(path.join(safeProjectPath(projectSlug), "music"), "project");
  return found;
}

function resolveMusicPath(project: Project, settings: LongformSettings): string | null {
  if (!settings.musicEnabled) return null;
  const files = listLocalMusicFiles(project.slug);
  if (settings.musicFileName) {
    const match = files.find((f) => f.fileName === settings.musicFileName);
    if (match) return match.path;
  }
  const genre = longformGenreById(settings.genreId);
  const moodHit = files.find((f) => f.fileName.toLowerCase().includes(genre.musicMood.toLowerCase()));
  return moodHit?.path ?? files[0]?.path ?? null;
}

function settingsOf(project: Project): LongformSettings {
  return parseLongformSettings(longformSettingsSource(project as { longformSettings?: string; seriesHook?: string }));
}

function assertLongformProject(project: Project): void {
  if (project.templateType !== "longform") {
    throw new Error("Bu islem yalnizca uzun form sablonunda calisir");
  }
}

export async function generateLongformStory(projectId: string): Promise<Story> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  assertLongformProject(project);
  const app = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  const lf = settingsOf(project);
  const genre = resolveLongformGenre(lf, project.genre);
  if (genre.id === "ozel" && /^(ozel|özel)$/i.test(genre.label)) {
    throw new Error("Ozel tur icin bir ad yazin — hikaye o kelimeye gore yazilir");
  }
  const wpm = wpmForPace(app, project.speechPace || genre.defaultPace);
  const targetWords = project.targetWordCount > 0 ? project.targetWordCount : computeTargetWords(project.targetDurationSeconds, wpm);
  const plan = planLongformActs(project.targetDurationSeconds, wpm);
  const castBudget = longformNamedCastBudget(project.targetDurationSeconds);
  const castRange = formatLongformCastBudget(castBudget);
  const drama = isLongformDramaGenre(genre.id);

  await recordEvent({
    projectId,
    step: "longform",
    message: `Uzun form senaryo basladi (${plan.length} bolum, ~${targetWords} kelime, kadro ${castRange})`,
  });
  updateLongformJob(projectId, { phase: "story", message: "Bolum plani yaziliyor" });

  const outline = await structuredCall<z.infer<typeof outlineSchema>>({
    system: `${longformStorySystem(genre, project.speechLanguage)}\n\n${curiosityRulesForLongform(genre.id)}`,
    user: [
      "GOREV: yalnizca BOLUM PLANI (JSON). Tam senaryo / ses metni YAZMA.",
      longformPovLine(genre),
      `Video basligi / konu: ${project.title || project.name}`,
      `Konu omurgasi: ${project.topic}`,
      `Tur: ${genre.label} — ${genre.narrationTone}`,
      `Dil: ${project.speechLanguage}`,
      speechOutputLanguageLock(project.speechLanguage),
      `Hedef sure: ${project.targetDurationSeconds} sn (~${targetWords} kelime, ${Math.round(project.targetDurationSeconds / 60)} dk)`,
      `Tam ${plan.length} bolum: 1=acilis kancasi, son=kapanis, aradakiler gelisme.`,
      "Her bolum: kisa baslik, 1-2 cumle ozet, promisedQuestion (o bolumun acik sorusu).",
      "Son bolumun promisedQuestion alani kapanisi anlatsin (yeni soru acma).",
      "PLAN SURUKLEYICI OLSUN: her bolum ozeti SOMUT bir olay/sahne icersin (kim, nerede, ne yapti) — duygu ozeti degil.",
      "Bolumler NetShort merdiveni izlesin: kanit, sakin yikici karar, zaman/guc atlamasi, status donusu, pismanlik, kapanis. Ayni durumu tekrarlayan bolum olmasin.",
      "Ortadaki bolumlerde tempo dusmesin: her birinde hikayeyi ceviren gelisme (yeni kanit, sakin darbe, donus hazirligi, skandal).",
      drama
        ? `KADRO (namedPeople): anlatici "ben" HARIC ${castRange} isimli yetiskin. 10 dk icin 2-3 kisi YASAK. Ornek roller: es/sevgili, ucuncu kisi, aile (kayinvalide/kardes), tanik/dost, donuste yeni ask, patron/avukat. Her isim unique, konusma diline uygun ozel isim; rol yaz. ${speechCastStoryLock(project.speechLanguage)} Bu kadro TUM bolumlerde donecek.`
        : "namedPeople: belgeselde gecen gercek ozel isimler varsa yaz; yoksa bos dizi.",
      project.openingHook ? `Kullanici kancasi: ${project.openingHook}` : "",
      project.avoidList ? `ISTENMEYEN: ${project.avoidList}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    schemaName: "longform_outline",
    jsonSchema: OUTLINE_JSON,
    zodSchema: outlineSchema,
    maxOutputTokens: 8_000,
  });

  const parts: string[] = [];
  let previousEnding = "";
  for (let i = 0; i < plan.length; i++) {
    assertLongformContinuing(projectId);
    const act = plan[i];
    const outlineAct = outline.acts[i] ?? outline.acts[outline.acts.length - 1];
    updateLongformJob(projectId, {
      phase: "story",
      message: `Senaryo: ${act.label} (${i + 1}/${plan.length})`,
    });
    const piece = await structuredCall<z.infer<typeof actTextSchema>>({
        system: `${longformStorySystem(genre, project.speechLanguage)}\n\n${curiosityRulesForLongform(genre.id)}`,
      user: [
        `GOREV: bu bolumun SES METNI. fullText yalnizca okunacak cumleler.`,
        `Bolum: ${act.label} (${act.role}) ${i + 1}/${plan.length}. Hedef ~${act.targetWords} kelime (+-%12).`,
        longformPovLine(genre),
        `Dil: ${project.speechLanguage}`,
        speechOutputLanguageLock(project.speechLanguage),
        `Tur / ton: ${genre.label}. ${genre.narrationTone}`,
        `Film basligi: ${outline.title}`,
        `Film ozeti: ${outline.summary}`,
        `Acilis kancasi (tum film): ${outline.hook}`,
        `Bu bolumun ozeti: ${outlineAct?.summary || act.label}`,
        act.role === "closing"
          ? "Bu SON bolum. Ana soruyu kapat. Yeni soru / devam edecek YASAK. promisedQuestion yok say."
          : `Bu bolumun acik sorusu (sonraki bolumde cevaplanacak): ${outlineAct?.promisedQuestion || ""}`,
        act.role === "opening" ? `Ilk cumleler kanca ile AYNI olsun: ${outline.hook}` : "",
        act.role === "closing" ? "Yuzlesme veya karar + kisa sonrasi. Yumuşak ama KAPALI bitir." : "",
        act.cliffhanger && act.role !== "closing"
          ? "Bolumu yumusak bir acik iz ile bitir (eksik belge, kapi, isim). Yapay 'ama o gece' kalibi YASAK."
          : "",
        previousEnding ? `ONCEKI BOLUMUN SONU (buradan devam et, tekrarlama):\n${previousEnding}` : "",
        project.avoidList ? `ISTENMEYEN: ${project.avoidList}` : "",
        [
          "BU BOLUMDE ZORUNLU (surukleyicilik):",
          "- En az 2 SAHNE olsun (yer + saat + somut eylem). Ozet gecme, olayi yasat.",
          "- En az 3 somut nesne/kanit gecsin; en az 2 duyu (ses, koku, dokunma, isik) kullan.",
          "- En az 1 mikro-gerilim: zaman baskisi, bekleme veya yakalanma riski.",
          "- Duygular beden tepkisiyle anlatilsin (el titremesi, nefes, mide), soyut duygu kelimesiyle degil.",
          "- Gerilim dorugunda 3-6 kelimelik kisa cumleler kullan; cumle uzunlugunu degistir.",
          "- Onceki bolumdeki bilgiyi TEKRARLAMA; hikayeyi bir adim ILERLET.",
          drama
            ? `- Kisileri ozel isimle yaz. SABIT KADRO: ${
                outline.namedPeople.length
                  ? outline.namedPeople.map((p) => `${p.name} (${p.storyRole})`).join(", ")
                  : `${castRange} isimli yuz`
              }. Bu bolumde en az 2 isimli yuz gecsin. Kadro ${castBudget.min} kisiden azsa BU BOLUMDE yeni bir isim sok (aile, tanik, yeni ask, patron). Ayni 2 kisiyle tum filmi doldurma.`
            : "- Kisileri ozel isimle tekrarla. Bu bolumde en az bir isimli yuz gecsin.",
          "- Bir eylem + bir yuz tepkisi yaz (etki→tepki). NetShort duygu: ezme / sakin yikici / status / pismanlik.",
        ].join("\n"),
        "YASAK: parantez ici sahne, kamera, 'Isim:', madde isareti, Ingilizce yonergesi.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      schemaName: "longform_act",
      jsonSchema: ACT_JSON,
      zodSchema: actTextSchema,
      maxOutputTokens: 12_000,
    });
    parts.push(piece.fullText.trim());
    previousEnding = piece.closingLine || piece.fullText.trim().slice(-400);
  }

  const fullStory = parts.join("\n\n");
  const payload: StoryPayload = {
    title: outline.title,
    summary: outline.summary,
    hook: outline.hook,
    fullStory,
    estimatedWords: countWords(fullStory),
    estimatedDurationSeconds: estimateSpeechSeconds(countWords(fullStory), wpm),
    language: project.speechLanguage,
    contentWarnings: outline.contentWarnings,
    characterVoiceNotes: outline.characterVoiceNotes || genre.narrationTone,
    namedPeople: mergeLongformNamedPeople(outline.namedPeople, fullStory, castBudget.max).map((person) => ({
      ...person,
      look: "",
      costume: "",
    })),
  };
  const story = await saveStory(project, payload, wpm);
  const dirs = longformDirs(project.slug);
  fs.writeFileSync(path.join(dirs.longform, "acts.json"), JSON.stringify({ plan, outline }, null, 2), "utf8");
  await recordEvent({
    projectId,
    step: "longform",
    message: `Uzun form senaryo hazir: "${story.title}" (${story.estimatedWords} kelime, ${payload.namedPeople.length} isimli yuz)`,
  });
  return story;
}

/** Beat promptlari yerelde yazilir — ayri OpenAI turu slayti dakikalarca %33'te kitler. */
function attachBeatVisualsLocal(
  drafts: LongformBeatDraft[],
  visualLock: string,
  genreId: string,
  storyText?: string,
  roster?: string[],
  leadName?: string,
  castGenders?: Record<string, "male" | "female">,
  speechLanguage?: string | null,
  filmSeed?: string
): Array<LongformBeatDraft & { imagePrompt: string; mood: string; sceneDescription: string }> {
  const visuals = buildLongformBeatVisuals(drafts, {
    visualLock,
    genreId,
    storyText,
    roster,
    leadName,
    castGenders,
    speechLanguage,
    filmSeed,
  });
  return drafts.map((d, i) => {
    const raw = visuals[i]?.imagePrompt || fallbackImagePrompt(d.narration, visualLock);
    return {
      ...d,
      imagePrompt: isLongformDramaGenre(genreId) ? prepareLiveActionFlowPrompt(raw) : raw,
      mood: visuals[i]?.emotion || (isLongformDramaGenre(genreId) ? "gergin" : "documentary"),
      sceneDescription: visuals[i]?.sceneDescription || visuals[i]?.emotion || "documentary",
    };
  });
}

export async function generateLongformBeats(projectId: string): Promise<{ count: number }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  assertLongformProject(project);
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  if (!story?.fullStory.trim()) throw new Error("Once uzun form senaryosunu uretin");
  const app = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  const lf = settingsOf(project);
  const genre = resolveLongformGenre(lf, project.genre);
  const wpm = wpmForPace(app, project.speechPace || genre.defaultPace);
  updateLongformJob(projectId, { phase: "beats", message: "Konusma karelere bolunuyor" });

  const drafts = splitNarrationIntoBeats(story.fullStory, lf.stillIntervalSeconds, wpm);
  if (drafts.length === 0) throw new Error("Senaryodan beat uretilemedi");
  const { roster, leadName, castGenders } = await ensureLongformCastReady(projectId);
  updateLongformJob(projectId, {
    phase: "beats",
    message: `${drafts.length} parca hazir, promptlar yaziliyor`,
  });
  // Drama karelerinde sinema klipleriyle AYNI gorsel stil preseti + gerceklik katmani.
  const beatStillLock = isLongformDramaGenre(genre.id) ? longformStillStyleText(project.visualStyle) : genre.visualLock;
  const withVisuals = attachBeatVisualsLocal(
    drafts,
    beatStillLock,
    genre.id,
    story.fullStory,
    roster,
    leadName,
    castGenders,
    project.speechLanguage,
    project.id
  );

  await archiveClipPrompts(projectId, "beat listesi yeniden uretildi", { languageVariant: "primary" });
  await prisma.clip.deleteMany({ where: { projectId, languageVariant: "primary" } });
  await prisma.clip.createMany({
    data: withVisuals.map((beat, i) => ({
      projectId,
      languageVariant: "primary",
      index: i + 1,
      dialogue: beat.narration,
      shotType: "still",
      sceneDescription: beat.sceneDescription,
      imagePrompt: beat.imagePrompt,
      emotionLabel: beat.mood,
      estimatedWords: beat.wordCount,
      estimatedDurationSeconds: beat.estimatedSeconds,
      curiosityScore: i === 0 || (i + 1) % 4 === 0 ? 8 : 6,
      hasHook: i === 0 || beat.narration.includes("?"),
      status: "draft",
    })),
  });

  const dirs = longformDirs(project.slug);
  fs.writeFileSync(path.join(dirs.longform, "beats.json"), JSON.stringify(withVisuals, null, 2), "utf8");
  await prisma.project.update({ where: { id: projectId }, data: { status: "clips_ready" } });
  await recordEvent({
    projectId,
    step: "longform",
    message: `${withVisuals.length} beat hazir (~${lf.stillIntervalSeconds} sn / kare)`,
  });
  return { count: withVisuals.length };
}

export async function synthesizeLongformVoice(projectId: string): Promise<{
  voicePath: string;
  durationSeconds: number;
  timestamps: SentenceTimestamp[];
}> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  assertLongformProject(project);
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  if (clips.length === 0) throw new Error("Once beat listesini uretin");
  const lf = settingsOf(project);
  const dirs = longformDirs(project.slug);
  const appSettings = await getSettings();
  const ttsView = ttsSettingsView(appSettings);
  const elevenReady = describeTtsSecrets(appSettings).elevenlabs;
  let elevenPickName = "";
  if (elevenReady) {
    if (lf.voiceId !== ELEVENLABS_VOICE_ID) {
      lf.voiceId = ELEVENLABS_VOICE_ID;
      await prisma.project.update({
        where: { id: projectId },
        data: { longformSettings: serializeLongformSettings(lf) },
      });
    }
    try {
      const picked = await resolveElevenLabsVoice({
        settings: appSettings,
        hint: { language: project.speechLanguage, genre: project.genre },
      });
      elevenPickName = picked.name;
      ttsView.elevenLabsVoiceId = picked.voiceId;
    } catch {
      elevenPickName = "";
    }
  }
  updateLongformJob(projectId, { phase: "tts", message: "Ses (TTS) uretiliyor" });

  const timestamps: SentenceTimestamp[] = [];
  const partPaths: string[] = [];
  let cursor = 0;
  let voiceReported = false;
  for (const clip of clips) {
    assertLongformContinuing(projectId);
    updateLongformJob(projectId, {
      phase: "tts",
      message: `Ses uretiliyor (${clip.index}/${clips.length})`,
    });
    const partPath = path.join(dirs.longform, `voice-${String(clip.index).padStart(3, "0")}.wav`);
    const spoken = sanitizeLongformSpeech(clip.dialogue) || clip.dialogue.replace(/\s+/g, " ").trim();
    const performance = ttsPerformanceFor({
      emotion: clip.emotionLabel,
      voiceTone: clip.voiceTone,
      text: spoken,
      enabled: lf.ttsExpressive !== false,
      language: project.speechLanguage,
    });
    const acted = applyTtsPerformance(lf.ttsSpeed, lf.ttsPitch, performance);
    const result = await synthesizeSpeech({
      text: spoken,
      voiceId: lf.voiceId,
      speed: acted.speed,
      pitchSemitones: acted.pitchSemitones,
      performance,
      preferElevenLabs: elevenReady,
      storyGenre: project.genre,
      elevenLabsVoiceId: ttsView.elevenLabsVoiceId || undefined,
      outputPath: partPath,
      // Ses, projenin konusma diline gore secilir: Turkce anlatida Ingilizce
      // ses kullanilmaz.
      language: project.speechLanguage,
      onVoiceResolved: async (info) => {
        if (voiceReported) return;
        voiceReported = true;
        await recordEvent({
          projectId,
          step: "longform",
          level: info.switched ? "warning" : "info",
          message: info.switched
            ? `Seslendirme: ${info.reason}`
            : elevenPickName
              ? `Seslendirme: ElevenLabs · ${elevenPickName} (hikayeye gore secildi)`
              : `Seslendirme sesi: ${info.voice.label} (${ttsProviderInfo(info.voice.provider).label})`,
        });
      },
    });
    const shifted = result.timestamps.map((t) => ({
      ...t,
      startSeconds: t.startSeconds + cursor,
      endSeconds: t.endSeconds + cursor,
    }));
    timestamps.push(...shifted);
    await prisma.clip.update({
      where: { id: clip.id },
      data: { actualDurationSeconds: result.durationSeconds },
    });
    cursor += result.durationSeconds;
    partPaths.push(result.outputPath);
  }

  const { concatAudioFiles, probeDurationSeconds } = await import("@/server/services/ffmpeg");
  const voicePath = path.join(dirs.longform, "voice.wav");
  await concatAudioFiles(partPaths, voicePath);
  const durationSeconds = await probeDurationSeconds(voicePath);
  fs.writeFileSync(path.join(dirs.longform, "timestamps.json"), JSON.stringify(timestamps, null, 2), "utf8");
  await recordEvent({
    projectId,
    step: "longform",
    message: `TTS tamamlandi (${Math.round(durationSeconds)} sn, ${timestamps.length} cumle)`,
  });
  return { voicePath, durationSeconds, timestamps };
}

export async function generateLongformStills(projectId: string): Promise<{ count: number }> {
  const project = await hydrateProjectFlowImageModel(
    await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
  );
  assertLongformProject(project);
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  if (clips.length === 0) throw new Error("Once beat listesini uretin");
  const lf = settingsOf(project);
  const genre = resolveLongformGenre(lf, project.genre);
  const dirs = longformDirs(project.slug);
  const imageModel = resolveFlowImageModel(project);
  const sourceLabel = longformImageSourceLabel(lf.imageProvider, imageModel);
  const stillCast = await ensureLongformCastReady(projectId);
  if (lf.imageProvider === "flow") {
    updateLongformJob(projectId, {
      phase: "stills",
      message: "Kadro gorselleri uretiliyor — karakterler karede gorunsun diye",
    });
    const { generateMissingCastImages } = await import("@/server/services/character-flow");
    const sheets = await generateMissingCastImages(projectId, {
      autoApprove: true,
      onProgress: (message) => updateLongformJob(projectId, { phase: "stills", message }),
      assertContinuing: () => assertLongformContinuing(projectId),
    });
    if (sheets.failed.length > 0) {
      await recordEvent({
        projectId,
        step: "longform",
        level: "warning",
        message: `Kadro sheet: ${sheets.ok} hazir, ${sheets.failed.length} atlandi (${sheets.failed.join(", ")}) — kareler yine de uretilir`,
      });
    } else if (sheets.ok > 0) {
      await recordEvent({
        projectId,
        step: "longform",
        message: `Kadro sheet hazir: ${sheets.ok} karakter, kare uretimine geciliyor`,
      });
    }
    const latest = await prisma.project.findUnique({
      where: { id: projectId },
      select: { flowProjectUrl: true, reuseFlowProject: true },
    });
    if (latest?.flowProjectUrl) {
      project.flowProjectUrl = latest.flowProjectUrl;
      project.reuseFlowProject = latest.reuseFlowProject;
    }
  }
  updateLongformJob(projectId, {
    phase: "stills",
    message: `Gorseller uretiliyor (${sourceLabel}, 0/${clips.length})`,
  });

  // Drama karelerinde sinema klipleriyle AYNI gorsel stil preseti + gerceklik katmani.
  const stillLock = isLongformDramaGenre(genre.id) ? longformStillStyleText(project.visualStyle) : genre.visualLock;
  const dramaVisuals = isLongformDramaGenre(genre.id)
    ? buildLongformBeatVisuals(
        clips.map((c) => ({ narration: c.dialogue })),
        {
          visualLock: stillLock,
          genreId: genre.id,
          storyText: clips.map((c) => c.dialogue).join(" "),
          roster: stillCast.roster,
          leadName: stillCast.leadName,
          castGenders: stillCast.castGenders,
          speechLanguage: project.speechLanguage,
          filmSeed: project.id,
        }
      )
    : null;
  if (dramaVisuals) {
    await prisma.$transaction(
      clips.map((clip, i) =>
        prisma.clip.update({
          where: { id: clip.id },
          data: {
            imagePrompt: prepareLiveActionFlowPrompt(dramaVisuals[i]?.imagePrompt || clip.imagePrompt),
            emotionLabel: dramaVisuals[i]?.emotion || clip.emotionLabel,
            sceneDescription: dramaVisuals[i]?.sceneDescription || clip.sceneDescription,
          },
        })
      )
    );
  }
  const castForSheets = await prisma.characterProfile.findMany({
    where: { projectId, role: { in: ["main", "side"] } },
    select: { name: true, role: true, referenceImagePath: true },
  });
  const stillCity = filmCityFor(project.speechLanguage, project.id, clips.map((c) => c.dialogue).join(" "));
  const stillRealityLock = realityLockBlock({
    world: `present-day ${stillCity.city}, ${stillCity.country}, the same real city every frame`,
    crowd: `${stillCity.city} residents`,
    hasReferences: castForSheets.some((c) => Boolean(c.referenceImagePath)),
    still: true,
  });
  const sheetsForClip = (clip: { id: string; dialogue: string; imagePrompt?: string | null; sceneDescription?: string | null }) => {
    const idx = clips.findIndex((c) => c.id === clip.id);
    const rebuilt = dramaVisuals?.[idx];
    return collectStillReferenceSheets({
      cast: castForSheets,
      people: rebuilt?.people || [],
      narration: clip.dialogue,
      sceneDescription: rebuilt?.sceneDescription || clip.sceneDescription,
      imagePrompt: rebuilt?.imagePrompt || clip.imagePrompt,
      leadName: stillCast.leadName,
    });
  };
  const promptFor = (clip: { id: string; dialogue: string; imagePrompt?: string | null; sceneDescription?: string | null }) => {
    const rebuilt = dramaVisuals ? dramaVisuals[clips.findIndex((c) => c.id === clip.id)]?.imagePrompt : null;
    const stored = rebuilt?.trim() || clip.imagePrompt?.trim() || fallbackImagePrompt(clip.dialogue, stillLock);
    // Eski projelerde / yedek promptta tum-film gerceklik kilidi yoksa burada eklenir.
    const raw = stored.includes(REALITY_LOCK_TAG) ? stored : `${stillRealityLock}\n\n${stored}`;
    const locked = isLongformDramaGenre(genre.id) ? prepareLiveActionFlowPrompt(raw) : raw;
    const existing = sheetsForClip(clip)
      .sheetPaths.filter((p) => p && fs.existsSync(p))
      .map((p) => ensureStillFrontReference(p))
      .filter((p) => p && fs.existsSync(p));
    return existing.length > 0
      ? `${STILL_SHEET_LOCK}\n\n${locked}\n\n[OUTPUT LOCK] One 16:9 story freeze in a real place. Forbidden: character sheet, turnaround, front+back split, gray studio catalog.`
      : locked;
  };
  const stillPathFor = (clip: { index: number }) => path.join(dirs.stills, stillFileName(clip.index));

  // Tum kareler Flow / Nano Banana Pro ile uretilir; baska resim motoru yok.
  const failed: number[] = await generateLongformStillsWithFlow({
    project,
    clips,
    imageModel,
    promptFor,
    stillPathFor,
    referencesFor: (clip) =>
      sheetsForClip(clip)
        .sheetPaths.filter((p) => p && fs.existsSync(p))
        .map((p) => ensureStillFrontReference(p))
        .filter((p) => p && fs.existsSync(p)),
    onProgress: (done, failCount, currentIndex) => {
      updateLongformJob(projectId, {
        phase: "stills",
        message: `Gorseller uretiliyor (${sourceLabel}, ${done}/${clips.length})${
          currentIndex ? ` · kare #${currentIndex}` : ""
        }${failCount ? ` · ${failCount} hata` : ""}`,
      });
    },
  });

  if (failed.length > 0) {
    throw new Error(
      `${failed.length} gorsel uretilemedi (beat ${failed
        .sort((a, b) => a - b)
        .slice(0, 8)
        .join(", ")}${failed.length > 8 ? "…" : ""}). Tekrar deneyin; hazir kareler korunur.`
    );
  }
  await recordEvent({ projectId, step: "longform", message: `${clips.length} duragan kare hazir (${sourceLabel})` });
  return { count: clips.length };
}

export async function renderLongformSegments(
  projectId: string,
  options?: { forceRebuild?: boolean }
): Promise<string[]> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  assertLongformProject(project);
  const lf = settingsOf(project);
  const frame = longformFrameSize(lf.outputResolution);
  const encode = longformEncodeProfile(lf.outputResolution, lf.renderEncoder, lf.renderFps);
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  const dirs = longformDirs(project.slug);
  const paths: string[] = [];
  for (const clip of clips) {
    assertLongformContinuing(projectId);
    if (!clip.sceneImagePath || !fs.existsSync(clip.sceneImagePath)) {
      throw new Error(`Beat ${clip.index} gorseli yok`);
    }
    const segmentPath = path.join(dirs.segments, `${String(clip.index).padStart(3, "0")}.mp4`);
    const duration = clip.actualDurationSeconds || clip.estimatedDurationSeconds || 20;
    const reuse = !options?.forceRebuild && clip.videoPath && fs.existsSync(clip.videoPath);
    if (!reuse) {
      await renderKenBurnsSegment({
        imagePath: clip.sceneImagePath,
        outputPath: segmentPath,
        durationSeconds: duration,
        index: clip.index,
        width: frame.width,
        height: frame.height,
        fps: lf.renderFps,
        preset: encode.preset,
        crf: encode.crf,
        motionMode: lf.stillMotion === "kenburns" ? "kenburns" : "hold",
        runOpts: { signal: longformAbortSignal(projectId) },
      });
      await prisma.clip.update({
        where: { id: clip.id },
        data: { videoPath: segmentPath, status: "completed", actualDurationSeconds: duration },
      });
      paths.push(segmentPath);
    } else {
      paths.push(clip.videoPath as string);
    }
  }
  return paths;
}

export async function mixLongformFinal(projectId: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  assertLongformProject(project);
  const lf = settingsOf(project);
  const dirs = longformDirs(project.slug);
  const voicePath = path.join(dirs.longform, "voice.wav");
  if (!fs.existsSync(voicePath)) throw new Error("Ses dosyasi yok — once TTS calistirin");
  const resInfo = longformResolutionInfo(lf.outputResolution);
  const encode = longformEncodeProfile(lf.outputResolution, lf.renderEncoder, lf.renderFps);
  const frame = longformFrameSize(lf.outputResolution);
  const previous = readStoredFingerprint(project.slug);
  const nextFp = buildLongformFingerprint({
    settings: lf,
    storyText: (await prisma.story.findUnique({
      where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
    }))?.fullStory,
  });
  const rebuildSegments = shouldRebuildSegments(previous, nextFp);
  updateLongformJob(projectId, {
    phase: "mix",
    message: `Slayt render (${resInfo.label} ${frame.width}x${frame.height} @ ${lf.renderFps}fps)`,
  });
  const segments = await renderLongformSegments(projectId, { forceRebuild: rebuildSegments });
  const outputPath = path.join(dirs.output, "final.mp4");
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });

  let burnSrtPath: string | null = null;
  const cues = lf.subtitles.enabled
    ? buildFilmStyleSrtCues(
        clips.map((clip) => ({
          index: clip.index,
          dialogue: clip.dialogue || "",
          durationSeconds: clip.actualDurationSeconds || clip.estimatedDurationSeconds || 0,
        }))
      )
    : [];
  if (lf.subtitles.enabled) {
    if (cues.length > 0) {
      burnSrtPath = path.join(dirs.publish, "youtube-altyazi-ana-dil.srt");
      const srtBody = `\uFEFF${buildSrtContent(cues)}`;
      fs.mkdirSync(dirs.publish, { recursive: true });
      fs.writeFileSync(burnSrtPath, srtBody, "utf8");
      await prisma.generatedAsset.create({
        data: {
          projectId,
          kind: "srt",
          path: burnSrtPath,
          bytes: Buffer.byteLength(srtBody, "utf8"),
          languageVariant: "primary",
          meta: JSON.stringify({ source: "clips", style: lf.subtitles }),
        },
      });
    }
  }

  await assembleLongform({
    segmentPaths: segments,
    voicePath,
    musicPath: resolveMusicPath(project, lf),
    outputPath,
    projectId,
    burnSrtPath,
    subtitleCues: cues,
    subtitleStyle: lf.subtitles,
    outputWidth: frame.width,
    outputHeight: frame.height,
    fps: lf.renderFps,
    encodePreset: encode.preset,
    encodeCrf: encode.crf,
    audioBitrate: encode.audioBitrate,
    h264Profile: encode.profile,
    h264Level: encode.level,
    gop: encode.gop,
    timeoutMultiplier: encode.timeoutMultiplier,
    runOpts: { signal: longformAbortSignal(projectId) },
  });

  if (!lf.subtitles.enabled) {
    const tsRaw = fs.existsSync(path.join(dirs.longform, "timestamps.json"))
      ? (JSON.parse(fs.readFileSync(path.join(dirs.longform, "timestamps.json"), "utf8")) as SentenceTimestamp[])
      : [];
    if (tsRaw.length > 0) {
      const cues = buildSrtCuesFromTimestamps(tsRaw);
      const srtPath = path.join(dirs.publish, "youtube-altyazi-ana-dil.srt");
      fs.writeFileSync(srtPath, `\uFEFF${buildSrtContent(cues)}`, "utf8");
      await prisma.generatedAsset.create({
        data: {
          projectId,
          kind: "srt",
          path: srtPath,
          bytes: Buffer.byteLength(buildSrtContent(cues), "utf8"),
          languageVariant: "primary",
        },
      });
    }
  }

  await prisma.project.update({ where: { id: projectId }, data: { status: "completed" } });
  updateLongformJob(projectId, { phase: "mix", message: "Final yazildi", outputPath });
  await recordEvent({ projectId, step: "longform", message: `Final hazir: ${outputPath}` });
  return outputPath;
}

function fingerprintPath(slug: string): string {
  return path.join(longformDirs(slug).longform, "pipeline.json");
}

function readStoredFingerprint(slug: string) {
  const filePath = fingerprintPath(slug);
  if (!fs.existsSync(filePath)) return null;
  return parseLongformFingerprint(fs.readFileSync(filePath, "utf8"));
}

function writeStoredFingerprint(slug: string, settings: LongformSettings, storyText: string | null | undefined): void {
  fs.writeFileSync(
    fingerprintPath(slug),
    JSON.stringify(buildLongformFingerprint({ settings, storyText }), null, 2),
    "utf8"
  );
}

/** "Bastan uret": uretilmis her sey silinir, senaryo dahil sifirdan yazilir. */
async function resetLongformArtifacts(projectId: string, slug: string): Promise<void> {
  const dirs = longformDirs(slug);
  await archiveClipPrompts(projectId, "bastan uretim (restart)", { languageVariant: "primary" });
  await prisma.clip.deleteMany({ where: { projectId, languageVariant: "primary" } });
  await prisma.story
    .delete({ where: { projectId_languageVariant: { projectId, languageVariant: "primary" } } })
    .catch(() => {});
  for (const dir of [dirs.stills, dirs.segments]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const file of [
    path.join(dirs.longform, "voice.wav"),
    path.join(dirs.longform, "voice-raw.wav"),
    path.join(dirs.longform, "timestamps.json"),
    path.join(dirs.longform, "beats.json"),
    path.join(dirs.longform, "acts.json"),
    path.join(dirs.output, "final.mp4"),
    fingerprintPath(slug),
  ]) {
    fs.rmSync(file, { force: true });
  }
  await recordEvent({ projectId, step: "longform", message: "Bastan uretim: eski senaryo, kareler ve ses silindi" });
}

export async function runLongformProduction(
  projectId: string,
  options?: { step?: LongformProduceStep; restart?: boolean }
): Promise<{ outputPath: string | null; step: LongformProduceStep }> {
  const step = options?.step && isLongformProduceStep(options.step) ? options.step : "all";
  // "auto" = otopilot: mix (montaj/render) HARIC tum adimlar.
  const runChain = step === "all" || step === "auto";
  const restart = options?.restart === true;
  startLongformJob(projectId);
  try {
    assertLongformContinuing(projectId);
    let project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const settings = settingsOf(project);
    const dirs = longformDirs(project.slug);
    if (restart) await resetLongformArtifacts(projectId, project.slug);
    const previous = restart ? null : readStoredFingerprint(project.slug);

    if (runChain || step === "story") {
      const existing = await prisma.story.findUnique({
        where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
      });
      if (step === "story" || !existing?.fullStory.trim()) await generateLongformStory(projectId);
      if (step === "story") {
        const story = await prisma.story.findUnique({
          where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
        });
        writeStoredFingerprint(project.slug, settings, story?.fullStory);
        finishLongformJob(projectId, "done");
        return { outputPath: null, step };
      }
    }

    const story = await prisma.story.findUnique({
      where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
    });
    if (!story?.fullStory.trim()) await generateLongformStory(projectId);
    const storyAfter = await prisma.story.findUniqueOrThrow({
      where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
    });
    const nextFp = buildLongformFingerprint({ settings, storyText: storyAfter.fullStory });

    // Her asama bitince ilerleme diske yazilir: is yarida iptal olsa bile
    // sonraki calistirma kaldigi yerden devam eder, bastan baslamaz.
    const saveProgress = () => writeStoredFingerprint(project.slug, settings, storyAfter.fullStory);
    saveProgress();

    if (runChain || step === "beats") {
      const clipCount = await prisma.clip.count({ where: { projectId, languageVariant: "primary" } });
      const rebuildBeats = step === "beats" || clipCount === 0 || shouldRebuildBeats(previous, nextFp);
      if (rebuildBeats) {
        if (clipCount > 0) {
          await archiveClipPrompts(projectId, "beat rebuild (ayar/senaryo degisti)", { languageVariant: "primary" });
          await prisma.clip.deleteMany({ where: { projectId, languageVariant: "primary" } });
        }
        await generateLongformBeats(projectId);
      } else {
        await recordEvent({
          projectId,
          step: "longform",
          message: `${clipCount} beat zaten hazir; parcalama atlandi (kaldigi yerden devam)`,
        });
      }
      saveProgress();
      if (step === "beats") {
        finishLongformJob(projectId, "done");
        return { outputPath: null, step };
      }
    }

    if (runChain || step === "tts") {
      const voicePath = path.join(dirs.longform, "voice.wav");
      if (step === "tts" || !fs.existsSync(voicePath) || shouldRebuildVoice(previous, nextFp)) {
        await synthesizeLongformVoice(projectId);
      } else {
        await recordEvent({ projectId, step: "longform", message: "Ses zaten hazir; TTS atlandi (kaldigi yerden devam)" });
      }
      saveProgress();
      if (step === "tts") {
        finishLongformJob(projectId, "done");
        return { outputPath: null, step };
      }
    }

    if (runChain || step === "stills") {
      // Yalnizca kaynak/model GERCEKTEN degistiyse hazir kareler cope atilir.
      if (imageSourceChanged(previous, nextFp)) {
        await prisma.clip.updateMany({
          where: { projectId, languageVariant: "primary" },
          data: { sceneImagePath: null },
        });
        await recordEvent({
          projectId,
          step: "longform",
          message: "Gorsel kaynagi degisti; kareler yeni motorla yeniden uretilecek",
        });
      }
      await generateLongformStills(projectId);
      saveProgress();
      if (step === "stills") {
        finishLongformJob(projectId, "done");
        return { outputPath: null, step };
      }
    }

    if (step === "auto") {
      // Otopilot: montaj kullanicida. Senaryo + beat + ses + kareler hazir.
      writeStoredFingerprint(project.slug, settings, storyAfter.fullStory);
      await recordEvent({
        projectId,
        step: "longform",
        message: "Otomatik uretim tamamlandi: senaryo, parcalar, ses ve kareler hazir — MONTAJ (render) sizde.",
      });
      finishLongformJob(projectId, "done");
      return { outputPath: null, step };
    }

    const finalPath = path.join(dirs.output, "final.mp4");
    const outputPath =
      step === "mix" || step === "all"
        ? !fs.existsSync(finalPath) || shouldRebuildMix(previous, nextFp) || step === "mix"
          ? await mixLongformFinal(projectId)
          : finalPath
        : null;

    writeStoredFingerprint(project.slug, settings, storyAfter.fullStory);
    finishLongformJob(projectId, "done", outputPath ? { outputPath } : undefined);
    return { outputPath, step };
  } catch (err) {
    // Kullanici durdur dediyse arkasindan gelen HER hata (sekme kapandi,
    // sayfa gitti, timeout...) iptal sayilir — "failed" degil. Boylece
    // otopilot yeniden baslatmaz ve panel "iptal edildi" gosterir.
    if (isLongformCancelledError(err) || isLongformCancelRequested(projectId)) {
      finishLongformJob(projectId, "cancelled");
      await prisma.project.update({ where: { id: projectId }, data: { status: "draft" } }).catch(() => {});
      const cancelErr = new Error("Gorsel slayt uretimi iptal edildi");
      cancelErr.name = "LongformCancelledError";
      throw cancelErr;
    }
    const message = err instanceof Error ? err.message : String(err);
    finishLongformJob(projectId, "failed", { error: message });
    await prisma.project.update({ where: { id: projectId }, data: { status: "failed" } }).catch(() => {});
    await recordEvent({ projectId, step: "longform", level: "error", message: `Gorsel slayt uretimi hata: ${message}` });
    throw err;
  }
}

export async function getLongformSnapshot(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  assertLongformProject(project);
  const settings = settingsOf(project);
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
    select: {
      id: true,
      index: true,
      dialogue: true,
      imagePrompt: true,
      sceneDescription: true,
      sceneImagePath: true,
      videoPath: true,
      estimatedDurationSeconds: true,
      actualDurationSeconds: true,
      status: true,
    },
  });
  const dirs = longformDirs(project.slug);
  const finalPath = path.join(dirs.output, "final.mp4");
  const finalStat = fs.existsSync(finalPath) ? fs.statSync(finalPath) : null;
  return {
    settings,
    settingsJson: serializeLongformSettings(settings),
    genre: resolveLongformGenre(settings, project.genre),
    stillEstimate: estimateLongformStillCount(project.targetDurationSeconds, settings.stillIntervalSeconds),
    story: story
      ? {
          title: story.title,
          summary: story.summary,
          hook: story.hook,
          estimatedWords: story.estimatedWords,
          estimatedDurationSeconds: story.estimatedDurationSeconds,
          hasText: story.fullStory.trim().length > 0,
          excerpt: story.fullStory.replace(/\s+/g, " ").trim().slice(0, 320),
        }
      : null,
    beats: clips,
    musicFiles: listLocalMusicFiles(project.slug).map((f) => ({ fileName: f.fileName, source: f.source })),
    voiceReady: fs.existsSync(path.join(dirs.longform, "voice.wav")),
    finalReady: Boolean(finalStat && finalStat.size > 50_000),
    finalPath: finalStat ? finalPath : null,
    finalBytes: finalStat?.size ?? 0,
    finalUpdatedAt: finalStat ? finalStat.mtime.toISOString() : null,
    actualSpeechSeconds: clips.reduce(
      (sum, clip) => sum + (clip.actualDurationSeconds || clip.estimatedDurationSeconds || 0),
      0
    ),
    readyStillCount: clips.filter((clip) => clip.sceneImagePath).length,
  };
}

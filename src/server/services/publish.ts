import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/server/db";
import { structuredCall } from "@/server/services/openai";
import { generateFlowImageBuffer } from "@/server/services/flow-image";
import { getSettings } from "@/server/services/settings";
import { buildSrtContent, buildSrtCues, buildSrtCuesFromTimestamps } from "@/server/services/srt";
import { extractFrameAt, probeVideo, burnTextOntoImage } from "@/server/services/ffmpeg";
import { ensureProjectDirs, nextAvailablePath, safeProjectPath } from "@/server/lib/paths";
import { recordEvent } from "@/server/lib/logger";
import { canonicalizeSpeechLanguage, languageLabel, languageTagFor } from "@/lib/tts-catalog";
import {
  craftFlashCoverHeadlines,
  craftTitleFromBrief,
  extractListingBrief,
  fitFlashCover,
  groundListingBody,
  groundListingTitle,
  isKeywordSaladTitle,
  isWeakCoverHook,
  isWeakListingToken,
  storyLockedSearchPhrase,
  listingPromptBlock,
  looksLikeDialogueTag,
  curiosityFallback,
  type ListingBrief,
} from "@/lib/youtube-listing";

/**
 * Yayin paketi — YouTube / kanal yayini icin en yuksek model + deep reasoning.
 * Izleyici metinleri dogal insan dili; thumbnail yazisiz, CTR odakli.
 */

const chapterSchema = z.object({
  time: z.string().default("0:00"),
  label: z.string().default(""),
  beat: z.string().default(""),
});

const thumbnailConceptSchema = z.object({
  name: z.string().default("Konsept"),
  emotion: z.string().default(""),
  hook: z.string().default(""),
  prompt: z.string().default(""),
});

/** AI ciktisi icin esnek sema (eksik alanlar normalize edilir). */
const publishMetaSchema = z.object({
  titleVariants: z.array(z.string()).default([]),
  primaryTitle: z.string().default(""),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
  seoKeywords: z
    .object({
      primary: z.string().default(""),
      secondary: z.array(z.string()).default([]),
    })
    .default({ primary: "", secondary: [] }),
  targetAudience: z.string().default(""),
  thumbnailPrompt: z.string().default(""),
  /** Kapak uzerine bindirilecek kisa, ilgi cekici yazi (2-6 kelime) */
  thumbnailText: z.string().default(""),
  thumbnailConcepts: z.array(thumbnailConceptSchema).default([]),
  chapters: z.array(chapterSchema).default([]),
  pinnedComment: z.string().default(""),
  communityPost: z.string().default(""),
  shortsHooks: z.array(z.string()).default([]),
  endScreenCta: z.string().default(""),
  postingStrategy: z.string().default(""),
  uploadChecklist: z.array(z.string()).default([]),
  kidsSafetyNotes: z.string().default(""),
  contentWarnings: z.array(z.string()).default([]),
  seriesHook: z.string().default(""),
});

export type PublishMeta = z.infer<typeof publishMetaSchema> & {
  modelUsed: string;
  reasoningEffort: string;
  generatedAt: string;
};

export type PublishPackage = {
  meta: PublishMeta | null;
  thumbnails: Array<{ path: string; createdAt: string }>;
  srtPath: string | null;
  /** YouTube TR/EN/DE/ES/AR altyazi dosyalari */
  subtitleFiles: Array<{
    code: string;
    name: string;
    youtube: string;
    path: string;
    downloadName: string;
  }>;
  metaJsonPath: string | null;
  metaTxtPath: string | null;
};

export type GeneratePublishOptions = {
  /** Plan sonrasi birincil thumbnail'i otomatik uret */
  autoThumbnail?: boolean;
};

/** Yayin isleri icin en guclu uygun modeli sec (flagship + high reasoning). */
export async function resolvePublishAiModel(): Promise<{ model: string; reasoningEffort: "high" }> {
  const settings = await getSettings();
  const configured = (settings.openaiModel || "").trim();
  const model = /^(gpt-5|o3|o4|o1)/i.test(configured) ? configured : "gpt-5";
  return { model, reasoningEffort: "high" };
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildTimelineBrief(
  clips: Array<{
    index: number;
    dialogue: string;
    sceneDescription: string;
    emotionLabel: string;
    actualDurationSeconds: number | null;
    estimatedDurationSeconds: number;
  }>
): { brief: string; durations: number[]; totalSeconds: number } {
  const durations = clips.map((c) => c.actualDurationSeconds ?? c.estimatedDurationSeconds ?? 8);
  let elapsed = 0;
  const lines: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const dur = durations[i];
    const start = formatTime(elapsed);
    const end = formatTime(elapsed + dur);
    lines.push(
      `#${c.index} [${start}-${end}] duygu=${c.emotionLabel || "-"} | ${c.sceneDescription.slice(0, 120).replace(/\n/g, " ")} | diyalog: "${c.dialogue.slice(0, 100)}"`
    );
    elapsed += dur;
  }
  return { brief: lines.join("\n"), durations, totalSeconds: elapsed };
}

function cleanTitle(t: string | null | undefined): string {
  return String(t || "")
    .replace(/\s+/g, " ")
    .replace(/[!?]{2,}/g, "?")
    .replace(/[.]{3,}/g, "…")
    .trim();
}

function ensureHash(tag: string): string {
  const t = String(tag || "")
    .trim()
    .replace(/^#+/, "");
  return t ? `#${t.replace(/\s+/g, "")}` : "";
}

/** Kapak yazisi filmin konusma dilinde olur (Almanca film → Almanca kanca). */
export function filmCoverLanguage(project: { speechLanguage?: string | null; storyLanguage?: string | null }): string {
  return canonicalizeSpeechLanguage(project.speechLanguage || project.storyLanguage || "Turkish");
}

export function filmCoverLanguageLabel(language: string | null | undefined): string {
  return languageLabel(languageTagFor(language) || "tr");
}

/**
 * Kapak yazisini YouTube CTR tarzina cevirir.
 * Dil = film dili. Ornek TR: "Neler Oldu?"  DE: "Was ist passiert?"
 */
export function looksLikeEnglishOverlay(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Turkce / Almanca ozel harf varsa Ingilizce degil
  if (/[ğüşıöçĞÜŞİÖÇäöüÄÖÜß]/.test(t) && !/\b(what|happened|watch|don't|miss this)\b/i.test(t)) return false;
  const lower = t.toLowerCase();
  const englishHits =
    /\b(the|and|what|happened|wow|amazing|don't|miss|watch|now|this|that|you|will|never|believe|shocking|epic|wait|until|end|oh no|look|next|happened)\b/i.test(
      lower
    );
  if (englishHits) return true;
  if (/^[A-Za-z0-9 ?!'….,\-]+$/.test(t) && /\b(what|wow|miss|watch|happened|don't|next)\b/i.test(lower)) return true;
  return false;
}

const TR_COVER_MARK =
  /\b(neler|oldu|sakın|kaçırma|kaçirma|şimdi|simdi|izle|vay canına|ip gerildi|bunu kaçır|son şans)\b/i;
const DE_COVER_MARK = /\b(was ist|passiert|nicht zu|fassen|schau genau|verraten|geheimnis|der chef|die firma)\b/i;

/** Hedef film diline uymayan kanca (eski TR meta / Ingilizce AI). */
export function overlayLanguageMismatch(text: string, language?: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const tag = languageTagFor(language) || "tr";
  if (tag !== "en" && looksLikeEnglishOverlay(t)) return true;
  if (tag !== "tr" && (TR_COVER_MARK.test(t) || /[ğışĞİŞ]/.test(t))) return true;
  if (tag !== "de" && DE_COVER_MARK.test(t)) return true;
  return false;
}

export type CoverTopicKey = "betrayal" | "boss" | "secret" | "family" | "money" | "reveal" | "generic";

export function detectCoverTopicKey(...parts: Array<string | null | undefined>): CoverTopicKey {
  const t = parts.filter(Boolean).join(" ").toLowerCase();
  if (/ihanet|betrug|verrat|aldat|affair|cheat|unfaith|fremdgeh/i.test(t)) return "betrayal";
  if (/ceo|chef|patron|holding|firma|şirket|sirket|geschäft|geschaeft|boss|unternehmen/i.test(t)) return "boss";
  if (/sır\b|sir\b|secret|geheim|gizli|vertusch/i.test(t)) return "secret";
  if (/aile|family|familie|koca|karı|kari|ehe|husband|wife|ehemann|ehefrau/i.test(t)) return "family";
  if (/para|money|geld|miras|erbe|servet|vermögen|vermoegen/i.test(t)) return "money";
  if (/ifşa|ifsa|reveal|enthüll|enthull|ortaya çık|ortaya cik/i.test(t)) return "reveal";
  return "generic";
}

const TOPIC_COVER_HOOKS: Record<CoverTopicKey, Record<string, string[]>> = {
  betrayal: {
    tr: ["İhanet!", "O muydu?", "Yakalandı!"],
    de: ["Verraten!", "Erwischt!", "Wirklich?"],
    en: ["Betrayed!", "Caught!", "It was them?"],
    fr: ["Trahi !", "Attrapé !", "Vraiment ?"],
    es: ["¡Traición!", "¡Cazado!", "¿De verdad?"],
  },
  boss: {
    tr: ["O CEO?!", "Patron mu?", "Şirket!"],
    de: ["Der Chef?!", "Die Firma?", "Jetzt klar?"],
    en: ["The Boss?!", "The Firm?", "Him?"],
    fr: ["Le patron ?", "La firme ?", "Lui ?"],
    es: ["¿El jefe?", "¿La firma?", "¿Él?"],
  },
  secret: {
    tr: ["Sırrı!", "Gizliydi!", "Örtbas?"],
    de: ["Das Geheimnis!", "Vertuscht?", "Endlich raus?"],
    en: ["The Secret!", "Covered up?", "Out now?"],
    fr: ["Le secret !", "Caché ?", "Enfin ?"],
    es: ["¡El secreto!", "¿Tapado?", "¿Ahora?"],
  },
  family: {
    tr: ["Aile mi?", "Eşin mi?", "Evde ne?"],
    de: ["Die Ehe?", "Zu Hause?", "Wer lügt?"],
    en: ["The Marriage?", "At home?", "Who lied?"],
    fr: ["Le couple ?", "À la maison ?", "Qui ment ?"],
    es: ["¿El matrimonio?", "¿En casa?", "¿Quién miente?"],
  },
  money: {
    tr: ["Para mı?", "Miras!", "Hesap!"],
    de: ["Das Geld?", "Das Erbe!", "Die Rechnung!"],
    en: ["The Money?", "The Will!", "Pay up!"],
    fr: ["L'argent ?", "L'héritage !", "L'addition !"],
    es: ["¿El dinero?", "¡La herencia!", "¡La cuenta!"],
  },
  reveal: {
    tr: ["İşte o!", "Ortaya çıktı!", "Şimdi anla!"],
    de: ["Raus damit!", "Jetzt klar!", "Sieh hin!"],
    en: ["There it is!", "Now you see!", "Look!"],
    fr: ["Le voilà !", "Regarde !", "Enfin !"],
    es: ["¡Ahí está!", "¡Mira!", "¡Ahora!"],
  },
  generic: {
    tr: [],
    de: [],
    en: [],
    fr: [],
    es: [],
  },
};

/** YouTube icin kisa kanca havuzu — film dilinde, duygu + konu. */
export function turkishThumbnailHooks(emotion?: string): string[] {
  return thumbnailHooksForLanguage("Turkish", emotion);
}

export function thumbnailHooksForLanguage(
  language?: string,
  emotion?: string,
  topicKey: CoverTopicKey = "generic"
): string[] {
  const tag = languageTagFor(language) || "tr";
  const e = (emotion || "").toLowerCase();
  const byLang: Record<string, Record<string, string[]>> = {
    tr: {
      tense: ["Neler Oldu?", "Ip Gerildi!", "Sakın!", "Tutun!"],
      win: ["İnanılmaz!", "Başardık!", "İşte O An!"],
      curious: ["Şimdi Ne?", "Bak Buna!", "Vay Canına!"],
      sad: ["Dayan!", "Son Şans!", "Nefes Al!"],
      base: ["Bunu Kaçırma!", "Sakın Kaçırma!", "Şimdi İzle!"],
    },
    de: {
      tense: ["Was ist passiert?", "Nicht zu fassen!", "Halt fest!", "Vorsicht!"],
      win: ["Unglaublich!", "Geschafft!", "Dieser Moment!"],
      curious: ["Was jetzt?", "Schau genau hin!", "Unglaublich?"],
      sad: ["Halt durch!", "Letzte Chance!", "Tief atmen!"],
      base: ["Nicht verpassen!", "Jetzt ansehen!", "Der Moment!"],
    },
    en: {
      tense: ["What happened?", "Hold on!", "Don't look away!"],
      win: ["Unreal!", "They did it!", "That moment!"],
      curious: ["Wait, what?", "Look at this!", "No way!"],
      sad: ["Hang on!", "Last chance!", "Breathe!"],
      base: ["Don't miss this!", "Watch now!", "That beat!"],
    },
    fr: {
      tense: ["Que s'est-il passé ?", "Incroyable !", "Attention !"],
      win: ["Incroyable !", "Ils l'ont fait !", "Ce moment !"],
      curious: ["Et maintenant ?", "Regarde ça !", "Pas possible !"],
      sad: ["Tiens bon !", "Dernière chance !", "Respire !"],
      base: ["Ne rate pas ça !", "Regarde maintenant !", "Ce moment !"],
    },
    es: {
      tense: ["¿Qué pasó?", "¡No puede ser!", "¡Cuidado!"],
      win: ["¡Increíble!", "¡Lo lograron!", "¡Ese momento!"],
      curious: ["¿Y ahora?", "¡Mira esto!", "¡No puede!"],
      sad: ["¡Aguanta!", "¡Última chance!", "¡Respira!"],
      base: ["¡No te lo pierdas!", "¡Míralo ya!", "¡Ese momento!"],
    },
  };
  const pack = byLang[tag] || byLang.tr;
  let emotionHooks = pack.base;
  if (/gergin|kork|panik|kayma|kriz|tehlike|slip|fear|adrenalin|spannung|angst/i.test(e)) emotionHooks = pack.tense;
  else if (/zafer|cosku|neseli|triumph|joy|mutlu|sieg|freude/i.test(e)) emotionHooks = pack.win;
  else if (/merak|sasir|curious|shock|heyecan|neugier|überrasch|uberrasch/i.test(e)) emotionHooks = pack.curious;
  else if (/uzgun|yorgun|endise|trauer|müde|mude|sorge/i.test(e)) emotionHooks = pack.sad;

  const topicHooks = TOPIC_COVER_HOOKS[topicKey]?.[tag] || TOPIC_COVER_HOOKS[topicKey]?.tr || [];
  const merged = [...topicHooks, ...emotionHooks].filter(Boolean);
  return merged.filter((h, i) => merged.findIndex((x) => x.toLowerCase() === h.toLowerCase()) === i);
}

export function craftThumbnailOverlayText(input: {
  thumbnailText?: string;
  primaryTitle?: string;
  shortsHooks?: string[];
  emotionLabel?: string;
  /** Film dili — varsayilan Turkce */
  language?: string;
  topic?: string;
  title?: string;
  genre?: string;
  hook?: string;
  summary?: string;
  storyTitle?: string;
  /** Ayni duygu icin farkli kanca sec (ceşitlilik) */
  rotateSalt?: number;
}): string {
  const language = canonicalizeSpeechLanguage(input.language || "Turkish");
  const brief = extractListingBrief({
    storyTitle: input.storyTitle || input.title,
    projectTitle: input.title,
    topic: input.topic,
    summary: input.summary,
    hook: input.hook,
    genre: input.genre,
    language,
  });
  const flashes = craftFlashCoverHeadlines(brief, 8);
  const topicKey = detectCoverTopicKey(brief.setup, input.title, brief.genreLabel, input.genre, input.thumbnailText);
  const shortHooks = thumbnailHooksForLanguage(language, input.emotionLabel, topicKey);
  const salt = Math.abs(Math.floor(input.rotateSalt ?? 0)) % Math.max(1, flashes.length || shortHooks.length);
  const fallback = flashes[salt] || flashes[0] || shortHooks[salt] || shortHooks[0] || "Bunu görünce donacaksın";

  const custom = String(input.thumbnailText || "").replace(/\s+/g, " ").trim();
  const keepCustom =
    custom &&
    !isWeakCoverHook(custom) &&
    !overlayLanguageMismatch(custom, language) &&
    !isKeywordSaladTitle(custom);
  const fittedCustom = keepCustom ? fitFlashCover(custom) || custom : "";

  let raw = fittedCustom || fallback;
  if (overlayLanguageMismatch(raw, language) || isWeakCoverHook(raw)) raw = fallback;

  raw = raw
    .replace(/\b(bu videoda|kesfetmeye hazir|unutulmaz)\b/gi, "")
    .replace(/\b(in this video|unforgettable journey)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw || overlayLanguageMismatch(raw, language)) raw = fallback;
  return raw.replace(/[!?]{3,}/g, "!").replace(/[.]{3,}/g, "…");
}

/** 3 kapak icin birbirinden farkli, film dilinde kancalar. */
export function craftThumbnailOverlayVariants(
  input: Parameters<typeof craftThumbnailOverlayText>[0] & { count?: number }
): string[] {
  const count = Math.max(1, Math.min(5, input.count ?? 3));
  const language = canonicalizeSpeechLanguage(input.language || "Turkish");
  const brief = extractListingBrief({
    storyTitle: input.storyTitle || input.title,
    projectTitle: input.title,
    topic: input.topic,
    summary: input.summary,
    hook: input.hook,
    genre: input.genre,
    language,
  });
  const pool = craftFlashCoverHeadlines(brief, 8);
  const first = craftThumbnailOverlayText({ ...input, language, rotateSalt: input.rotateSalt ?? 0 });
  const out: string[] = [first];
  for (let i = 0; i < pool.length && out.length < count; i++) {
    const next = craftThumbnailOverlayText({
      ...input,
      thumbnailText: pool[i],
      shortsHooks: [],
      language,
      rotateSalt: i + 1,
    });
    if (!out.some((x) => x.toLowerCase() === next.toLowerCase())) out.push(next);
  }
  return out.slice(0, count);
}

const GENERIC_TAG_BAN =
  /^(youtube|#youtube|video|#video|yeni|yeni video|önerilen|onerilen|#yeni|#önerilen|#oneri|kanal|watch|new video|subscribe)$/i;

const TOPIC_SEARCH_PHRASES: Record<CoverTopicKey, Record<string, string[]>> = {
  betrayal: {
    tr: ["ihanet", "aldatma dramı", "kısa dram"],
    de: ["Fremdgehen", "Betrug Ehe", "Liebesdrama"],
    en: ["cheating drama", "betrayal short film", "affair"],
    fr: ["trahison", "infidélité", "drame"],
    es: ["infidelidad", "traición", "drama corto"],
  },
  boss: {
    tr: ["patron", "şirket draması", "ceo sır"],
    de: ["Chef", "Firma", "Holding Drama"],
    en: ["boss drama", "company secret", "ceo"],
    fr: ["patron", "entreprise", "drame"],
    es: ["jefe", "empresa", "drama"],
  },
  secret: {
    tr: ["aile sırrı", "gizli geçmiş", "örtbas"],
    de: ["Familiengeheimnis", "Vertuschung", "Geheimnis"],
    en: ["family secret", "cover up", "hidden past"],
    fr: ["secret de famille", "cachette"],
    es: ["secreto familiar", "encubrimiento"],
  },
  family: {
    tr: ["aile draması", "evlilik", "kısa film"],
    de: ["Ehe", "Familiendrama", "Kurzfilm"],
    en: ["marriage drama", "family short film"],
    fr: ["drame familial", "mariage"],
    es: ["drama familiar", "matrimonio"],
  },
  money: {
    tr: ["miras", "para kavgası", "servet"],
    de: ["Erbe", "Geld", "Vermögen"],
    en: ["inheritance", "money drama"],
    fr: ["héritage", "argent"],
    es: ["herencia", "dinero"],
  },
  reveal: {
    tr: ["gerçek ortaya çıktı", "ifşa"],
    de: ["Enthüllung", "die Wahrheit"],
    en: ["the reveal", "the truth"],
    fr: ["révélation", "la vérité"],
    es: ["la verdad", "revelación"],
  },
  generic: {
    tr: ["kısa film", "dram"],
    de: ["Kurzfilm", "Drama"],
    en: ["short film", "drama"],
    fr: ["court métrage", "drame"],
    es: ["cortometraje", "drama"],
  },
};

const CATEGORY_TAGS: Record<string, string[]> = {
  tr: ["kısa film", "dram", "anlatı"],
  de: ["Kurzfilm", "Drama", "Kurzdrama"],
  en: ["short film", "drama", "short drama"],
  fr: ["court métrage", "drame"],
  es: ["cortometraje", "drama"],
};

function uniqueTagList(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const tag = String(raw || "").replace(/\s+/g, " ").trim();
    if (!tag || tag.length < 2 || tag.length > 42) continue;
    if (GENERIC_TAG_BAN.test(tag.replace(/^#/, ""))) continue;
    if (looksLikeDialogueTag(tag) || isKeywordSaladTitle(tag) || isWeakListingToken(tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function listingBriefFromCtx(ctx: {
  language?: string;
  topic?: string;
  genre?: string;
  summary?: string;
  hook?: string;
  storyTitle?: string;
  titleFallback?: string;
}): ListingBrief {
  return extractListingBrief({
    storyTitle: ctx.storyTitle,
    projectTitle: ctx.titleFallback,
    topic: ctx.topic,
    summary: ctx.summary,
    hook: ctx.hook,
    genre: ctx.genre,
    language: ctx.language,
  });
}

function topicClauses(text: string): string[] {
  return String(text || "")
    .replace(/[|/]+/g, ",")
    .split(/[,.;:!?…\n]+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 4 && s.length <= 48);
}

/**
 * 2026 YouTube: 8-15 katmanli etiket — konu + baslik + tur.
 * Jenerik "youtube / video / yeni" yok; arama niyeti film konusundan gelir.
 */
export function topicAlignedTagPack(input: {
  title: string;
  topic?: string;
  genre?: string;
  language?: string;
  existing?: string[];
  isKids?: boolean;
  summary?: string;
  hook?: string;
  storyTitle?: string;
}): string[] {
  const langTag = languageTagFor(input.language) || "tr";
  const brief = extractListingBrief({
    storyTitle: input.storyTitle,
    projectTitle: input.title,
    topic: input.topic,
    summary: input.summary,
    hook: input.hook,
    genre: input.genre,
    language: input.language,
  });
  const topicKey = detectCoverTopicKey(brief.setup, input.title, brief.genreLabel, input.genre);
  const titlePhrase = cleanTitle(input.title).replace(/[.!?…]+$/g, "").slice(0, 42);
  const kids = input.isKids
    ? langTag === "de"
      ? ["Kinderfilm", "Familie", "Kindergeschichte", "Eltern", "Märchen"]
      : langTag === "en"
        ? ["kids film", "family", "children story", "parents", "fairytale"]
        : ["çocuk filmi", "aile", "çocuk hikayesi", "ebeveyn", "masal"]
    : [];
  const topicPhrases =
    String(input.topic || "").length <= 220 ? topicClauses(input.topic || "") : brief.tagSeeds;
  const searchPhrases = TOPIC_SEARCH_PHRASES[topicKey]?.[langTag] || TOPIC_SEARCH_PHRASES[topicKey]?.tr || [];
  const tags = uniqueTagList([
    ...brief.tagSeeds,
    titlePhrase,
    brief.genreLabel,
    ...topicPhrases,
    ...searchPhrases,
    brief.genreLabel || input.genre,
    ...(CATEGORY_TAGS[langTag] || CATEGORY_TAGS.tr),
    ...kids,
    ...(input.existing || []),
    ...searchPhrases,
    ...(CATEGORY_TAGS[langTag] || CATEGORY_TAGS.tr),
  ]);
  return tags.slice(0, 15);
}

export function topicAlignedHashtags(input: {
  title: string;
  topic?: string;
  genre?: string;
  language?: string;
  existing?: string[];
  isKids?: boolean;
  summary?: string;
  hook?: string;
  storyTitle?: string;
}): string[] {
  const tags = topicAlignedTagPack(input);
  const fromTags = tags.slice(0, 5).map((t) => ensureHash(t.replace(/\s+/g, "")));
  return uniqueTagList([...(input.existing || []).map((h) => ensureHash(h)), ...fromTags]).slice(0, 5);
}

/**
 * YouTube aciklamasini kisa-merak metnine cevirir.
 * Hedef: ~3 cumle / ~280-340 karakter govde (makale degil; 13-17 kelime nefes payi).
 */
export function forceShortCuriosityDescription(
  raw: string,
  opts: {
    title: string;
    hashtags?: string[];
    language?: string;
    setup?: string;
    nouns?: string[];
  }
): string {
  const title = String(opts.title || "Bu video");
  const trimmed = String(raw || "").replace(/\r\n/g, "\n").trim();
  const hashFromBody: string[] = [];
  const bodyLines: string[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^#\S/.test(t) && t.split(/\s+/).every((w) => w.startsWith("#"))) {
      hashFromBody.push(...t.split(/\s+/));
      continue;
    }
    bodyLines.push(t);
  }

  let body = bodyLines.join(" ").replace(/\s+/g, " ").trim();
  body = body.replace(/#\S+/g, " ").replace(/\s+/g, " ").trim();
  // CTA / abone nutuklarini at
  body = body
    .replace(/\bEğer\b[^.!?…]{0,280}[.!?…]/gi, " ")
    .replace(/\babone\s+ol[^.!?…]{0,120}[.!?…]/gi, " ")
    .replace(/\b(like|beğen|yorum yaz|paylaş|zil aç)[^.!?…]{0,80}[.!?…]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = body
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && !/abone|kaçırmamak|beğendiyseniz/i.test(s));

  // 3 kisa cumle: merak + bir nefes + izlemeye ceken kapanis
  let short = sentences.slice(0, 3).join(" ").trim();
  if (short.length > 340 && sentences.length >= 2) {
    short = sentences.slice(0, 2).join(" ").trim();
  }
  if (short.length > 360) {
    short = `${short.slice(0, 340).replace(/\s+\S*$/, "").trim()}…`;
  }
  if (short.length < 40) {
    short = curiosityFallback({
      title,
      language: opts.language,
      setup: opts.setup,
      nouns: opts.nouns,
    });
  }

  const hashes = [...(opts.hashtags || []), ...hashFromBody]
    .map((h) => ensureHash(String(h || "")))
    .filter(Boolean)
    .filter((h, i, arr) => arr.indexOf(h) === i)
    .slice(0, 6)
    .join(" ");

  return hashes ? `${short}\n\n${hashes}` : short;
}

/**
 * YouTube aciklamasini kisa + merakli tutar (forceShort sarmalayici).
 */
export function tightenCuriosityDescription(raw: string, title = "Bu video"): string {
  return forceShortCuriosityDescription(raw, { title });
}

/** AI sonucunu yayina hazir hale getirir (eksik alanlari tamamlar). */
export function normalizePublishMeta(
  raw: z.infer<typeof publishMetaSchema>,
  ctx: {
    titleFallback: string;
    isKids: boolean;
    totalSeconds: number;
    language?: string;
    topic?: string;
    genre?: string;
    summary?: string;
    hook?: string;
    storyTitle?: string;
  }
): z.infer<typeof publishMetaSchema> {
  const brief = listingBriefFromCtx(ctx);
  const primary = groundListingTitle(
    cleanTitle(raw.primaryTitle) ||
      cleanTitle(raw.titleVariants[0] || "") ||
      cleanTitle(ctx.storyTitle) ||
      cleanTitle(ctx.titleFallback) ||
      "",
    brief
  );

  let titleVariants = [
    primary,
    ...raw.titleVariants
      .map(cleanTitle)
      .filter(Boolean)
      .filter((t) => !/\(\d+\)$/.test(t))
      .map((t) => groundListingTitle(t, brief)),
  ].filter((t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
  for (let i = 0; titleVariants.length < 5 && i < 8; i++) {
    const extra = groundListingTitle(craftTitleFromBrief(brief, i), brief);
    if (!titleVariants.some((t) => t.toLowerCase() === extra.toLowerCase())) titleVariants.push(extra);
  }
  titleVariants = titleVariants.slice(0, 8);
  while (titleVariants.length < 5) {
    titleVariants.push(`${primary}${titleVariants.length === 1 ? "" : ` (${titleVariants.length})`}`);
  }

  const groundedBody = groundListingBody(raw.description.trim(), brief);
  const description = forceShortCuriosityDescription(groundedBody, {
    title: primary,
    hashtags: raw.hashtags || [],
    language: ctx.language,
    setup: brief.setup,
    nouns: brief.nouns,
  });

  let tags = uniqueTagList((raw.tags || []).map((t) => String(t || "").trim()));
  tags = topicAlignedTagPack({
    title: primary,
    topic: ctx.topic,
    genre: ctx.genre,
    language: ctx.language,
    existing: tags,
    isKids: ctx.isKids,
    summary: ctx.summary,
    hook: ctx.hook,
    storyTitle: ctx.storyTitle,
  });

  let hashtags = uniqueTagList((raw.hashtags || []).map((h) => ensureHash(String(h || ""))));
  hashtags = topicAlignedHashtags({
    title: primary,
    topic: ctx.topic,
    genre: ctx.genre,
    language: ctx.language,
    existing: hashtags,
    isKids: ctx.isKids,
    summary: ctx.summary,
    hook: ctx.hook,
    storyTitle: ctx.storyTitle,
  });

  const seo = raw.seoKeywords ?? { primary: "", secondary: [] };
  const seoPrimary =
    storyLockedSearchPhrase(String(seo.primary || "").trim(), brief) ||
    primary.split(/\s+/).slice(0, 4).join(" ");
  let seoSecondary = (seo.secondary || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (seoSecondary.length < 3) {
    seoSecondary = [...new Set([...seoSecondary, ...tags.slice(0, 6)])].slice(0, 10);
  }

  let chapters = (raw.chapters || [])
    .map((c) => ({
      time: String(c?.time || "").trim() || "0:00",
      label: String(c?.label || "").trim() || "Sahne",
      beat: String(c?.beat || "").trim(),
    }))
    .filter((c) => c.label);
  if (chapters.length < 3) {
    const mid = formatTime(Math.floor(ctx.totalSeconds / 2));
    const late = formatTime(Math.floor(ctx.totalSeconds * 0.75));
    chapters = [
      { time: "0:00", label: "Başlangıç", beat: "açılış" },
      { time: mid, label: "Orta", beat: "gelişme" },
      { time: late, label: "Son", beat: "kapanış" },
      ...chapters,
    ].slice(0, 12);
  }
  if (chapters[0]) chapters[0] = { ...chapters[0], time: "0:00" };

  let thumbnailConcepts = (raw.thumbnailConcepts || [])
    .map((c, i) => ({
      name: String(c?.name || "").trim() || `Konsept ${i + 1}`,
      emotion: String(c?.emotion || "").trim() || "merak",
      hook: String(c?.hook || "").trim() || primary,
      prompt: String(c?.prompt || "").trim(),
    }))
    .filter((c) => c.prompt.length >= 20);
  if (thumbnailConcepts.length < 3) {
    const style = ctx.isKids
      ? "Feature-quality 3D Pixar-style kids character, soft cinematic lighting"
      : "Cinematic photorealistic subject, dramatic key light";
    thumbnailConcepts = [
      {
        name: "Yüz yakını",
        emotion: "şaşkınlık",
        hook: "İlk saniye merakı",
        prompt: `${style}, extreme close-up of the main character's face filling half the frame, eyes wide with clear emotion, high contrast, shallow depth of field, 16:9 YouTube thumbnail, absolutely no text no logos no watermarks`,
      },
      {
        name: "Aksiyon anı",
        emotion: "gerilim",
        hook: "Ortadaki kriz",
        prompt: `${style}, medium-wide shot of the peak action beat, clear silhouette, saturated but natural colors, cinematic composition rule of thirds, 16:9 YouTube thumbnail, absolutely no text no logos`,
      },
      {
        name: "Duygu kapanışı",
        emotion: "rahatlama",
        hook: "Sonuç öncesi nefes",
        prompt: `${style}, warm emotional two-shot or hero portrait after tension, soft rim light, readable at small size, 16:9 YouTube thumbnail, absolutely no text no captions`,
      },
      ...thumbnailConcepts,
    ].slice(0, 5);
  }

  const thumbnailPrompt =
    String(raw.thumbnailPrompt || "").trim().length >= 20
      ? String(raw.thumbnailPrompt || "").trim()
      : thumbnailConcepts[0]?.prompt ||
        `Professional 16:9 YouTube thumbnail, clear emotional hero subject, high contrast, no text no logos`;

  const thumbnailText = craftThumbnailOverlayText({
    thumbnailText: raw.thumbnailText || "",
    primaryTitle: primary,
    shortsHooks: raw.shortsHooks || [],
    language: ctx.language,
    topic: brief.setup || ctx.topic,
    title: ctx.storyTitle || ctx.titleFallback,
    genre: ctx.genre,
    hook: ctx.hook,
    summary: ctx.summary,
    storyTitle: ctx.storyTitle,
  });

  const defaults = {
    pinnedComment:
      String(raw.pinnedComment || "").trim() ||
      (ctx.isKids
        ? "Bu bölümü birlikte mi izlediniz? En sevdiğiniz anı yoruma yazın — bir sonrakinde ona göre sürpriz yapalım."
        : "İzlediğin için teşekkürler. En çok hangi kısım aklında kaldı? Yaz, okuyorum."),
    communityPost:
      String(raw.communityPost || "").trim() ||
      `Yeni video yayında: ${primary}\nKısa bir bakış atıp ne düşündüğünü söylemen yeterli.`,
    shortsHooks:
      (raw.shortsHooks || []).filter(Boolean).length >= 3
        ? (raw.shortsHooks || []).filter(Boolean).slice(0, 6)
        : [
            "Bir saniye — bunu kaçırmayın.",
            "Tam burada her şey değişiyor.",
            "Sonuna kadar bekleyin.",
          ],
    endScreenCta:
      String(raw.endScreenCta || "").trim() ||
      "Beğendiyseniz bir sonraki bölüme geçin; kanalda devamı var.",
    postingStrategy:
      String(raw.postingStrategy || "").trim() ||
      "Akşam aile saatine denk gelecek şekilde yayınla. İlk saatte sabit yorumu ekle. Shorts kancasından birini 24 saat içinde kes.",
    uploadChecklist:
      (raw.uploadChecklist || []).filter(Boolean).length >= 6
        ? (raw.uploadChecklist || []).filter(Boolean).slice(0, 16)
        : [
            "Başlığı yapıştır",
            "Açıklamayı yapıştır (bölümler dahil)",
            "Thumbnail yükle",
            "Etiketleri ekle",
            "Sabit yorumu yayın sonrası sabitle",
            "Çocuk içeriğiyse doğru yaş / Made for Kids işaretini kontrol et",
            "Önizlemeyi telefonda kontrol et",
          ],
    targetAudience:
      String(raw.targetAudience || "").trim() ||
      (ctx.isKids
        ? "Okul öncesi / ilkokul çocukları ve onlarla birlikte izleyen ebeveynler."
        : "Hikaye ve anlatı seven genel YouTube izleyicisi."),
    seriesHook: String(raw.seriesHook || "").trim(),
    kidsSafetyNotes:
      String(raw.kidsSafetyNotes || "").trim() ||
      (ctx.isKids
        ? "Korku yok; gerilim kısa ve ekipman/takımla çözülüyor. Ebeveyn yanında izleyebilir."
        : ""),
    contentWarnings: (raw.contentWarnings || []).filter(Boolean),
  };

  return {
    titleVariants,
    primaryTitle: primary,
    description,
    tags,
    hashtags,
    seoKeywords: { primary: seoPrimary, secondary: seoSecondary },
    targetAudience: defaults.targetAudience,
    thumbnailPrompt,
    thumbnailText,
    thumbnailConcepts,
    chapters,
    pinnedComment: defaults.pinnedComment,
    communityPost: defaults.communityPost,
    shortsHooks: defaults.shortsHooks,
    endScreenCta: defaults.endScreenCta,
    postingStrategy: defaults.postingStrategy,
    uploadChecklist: defaults.uploadChecklist,
    kidsSafetyNotes: defaults.kidsSafetyNotes,
    contentWarnings: defaults.contentWarnings,
    seriesHook: defaults.seriesHook,
  };
}

/** Image modeline giden promptu profesyonel thumbnail kurallariyla guclendirir. */
export function enhanceThumbnailPrompt(
  raw: string,
  opts?: {
    isKids?: boolean;
    characterHint?: string;
    composition?: "face" | "split";
    /** Sheet / video karesi referansi var — yeni yuz uydurma */
    castLocked?: boolean;
  }
): string {
  const style = opts?.isKids
    ? "Feature-film 3D kids animation look (Pixar/DreamWorks craft), soft global illumination, expressive big eyes"
    : "High-CTR drama thumbnail still: saturated rich color grade, high contrast, dark vignette edges, dramatic motivated lighting";
  const character = [
    opts?.castLocked
      ? "Use the attached story-adult photos only. Same everyday neighbor faces and wardrobe. Do not invent a different person."
      : "",
    opts?.characterHint?.trim() ? `Hero identity lock: ${opts.characterHint.trim().slice(0, 220)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const composition =
    opts?.composition === "split"
      ? "SPLIT-CONTRAST composition: two halves of one frame telling before/after or rich/poor — left side warm and glamorous, right side cold and harsh (or vice versa). One person appears in both states OR two opposing characters face off across the split. Clear visual gap that begs a question."
      : "Composition: 1-2 adult faces LARGE in frame (40-65%), exaggerated but believable shock/anger/heartbreak expression — wide eyes, open mouth or clenched jaw; a second figure or luxury/poverty contrast element behind. Strong eye contact toward camera or the drama.";
  const core = raw.replace(/\s+/g, " ").trim();
  return [
    "Professional YouTube drama thumbnail, 16:9 landscape, ultra sharp, designed to read clearly at small mobile size.",
    style + ".",
    composition,
    "Keep the TOP band of the frame visually clean and simple (bold caption text will be added there later); keep the bottom-right corner clear for a duration badge.",
    "Lighting: hard key + colored rim (teal/orange or red accent), deep readable shadows; skin natural, not plastic.",
    character,
    `Scene brief: ${core}`,
    "Everyday adult story people, original fictional faces.",
    "ABSOLUTELY NO text, letters, numbers, logos, watermarks, UI, captions, speech bubbles, or borders.",
    "No collage grid, no stock-photo stiffness — one cohesive cinematic dramatic moment.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** YouTube / kanal yayin planini en yuksek model ile uretir. */
export async function generatePublishMetadata(
  projectId: string,
  options?: GeneratePublishOptions
): Promise<{ meta: PublishMeta; thumbnailPath: string | null }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  const character = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
  const sides = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });

  const storyText = story?.fullStory || clips.map((c) => c.dialogue).filter(Boolean).join(" ");
  if (!storyText.trim() && clips.every((c) => !c.dialogue.trim() && !c.sceneDescription.trim())) {
    throw new Error("Meta verisi uretilecek icerik yok (hikaye/diyalog/sahne bos)");
  }

  const { model, reasoningEffort } = await resolvePublishAiModel();
  const timeline = buildTimelineBrief(clips);
  const isKids = false;
  const coverLanguage = filmCoverLanguage(project);
  const coverLanguageLabel = filmCoverLanguageLabel(coverLanguage);
  const listingBrief = extractListingBrief({
    storyTitle: story?.title || project.title,
    projectTitle: project.title || project.name,
    topic: project.topic,
    summary: story?.summary,
    hook: story?.hook,
    genre: project.genre,
    language: coverLanguage,
  });
  const castLine = [character?.name, ...sides.map((s) => s.name)].filter(Boolean).join(", ");
  const characterHint = [character?.baseAppearancePrompt, character?.baseWardrobePrompt]
    .filter(Boolean)
    .join(" | ");

  await recordEvent({
    projectId,
    step: "publish",
    message: `Yayin plani uretiliyor (model=${model}, reasoning=${reasoningEffort})...`,
  });

  const result = await structuredCall<z.infer<typeof publishMetaSchema>>({
    model,
    reasoningEffort,
    maxOutputTokens: 24_000,
    timeoutMs: 600_000,
    system: `Sen deneyimli bir YouTube kanal yoneticisisin ve ayni zamanda iyi bir copywriter'sin.
Izleyiciye giden her cumle GERCEK BIR INSAN tarafindan yazilmis gibi olmali — sicak, net, sade, profesyonel.

DIL: ${project.storyLanguage || coverLanguage}

KOPYAYAZIM — 2026 YOUTUBE LISTELEME (BU HIKAYE + ARAMA + CTR):
- Konusur gibi yaz. Kisa cumleler. Somut vaat. Gereksiz sus yok.
- Yasak AI / ajans kokusu: "kesfetmeye hazir misiniz", "unutulmaz yolculuk", "bu videoda sizlerle", "etkilesimi artirin", "SEO uyumlu", "icerik zenginligi", "merak uyandiran macera sizi bekliyor", "tiklayin ve abone olun simdi".
- Yasak: !!!, emoji yigini, BUYUK HARF BAGIRMA, sahte heyecan, anahtar kelime doldurma, jenerik "drama / hikaye / izle" basligi.
- BASLIK (primaryTitle + titleVariants) — BU FILMIN KURULUMUNA kilitli:
  * Ilk 40 karakterde BU hikayenin arama ifadesi (or. Suite 908 / Blitzhochzeit / Standesamt — yalnizca metinde varsa).
  * Dogal bir cumle veya kisa baslik. "A / B / C – ..." slash yigini YASAK.
  * Jenerik kova (Ehe/Firma/Geheimnis/Chef) YASAK — bu filmde yoksa yazma.
  * 50-70 karakter; 70+ mobilde kesilir. 100 karaktere asla dolma.
  * Ayni kelimeyi 2+ kez tekrarlama. Thumbnail yazisiyla ayni cumle olmasin.
  * Clickbait tuzak / sonu soyleme / "PART 1" / "FULL MOVIE" yasak.
  * Varyantlar ayni kurulum kelimesini korur, farkli aci dener (soru / zitlik / kim).
- ACIKLAMA — ilk 150 karakter = Show more ONCESI (BU hikaye + izleme nedeni):
  * Cumle 1: kurulum (otel rezervasyonu / yildirim nikah / standesamt — metindeki somutlar).
  * Cumle 2: bir nefes, yine bu sahneden (~15 kelime). Bos "hava degisiyor" YASAK.
  * Cumle 3: "izleyince anlarsin" kapanisi.
  * Govde ~200-320 karakter. Makale, sahne sahne ozet, sonu, CEO/USB ifşası, abone nutugu YASAK.
  * Hashtagler EN SONDA, 3-5 adet, KURULUMDAN (jenerik #youtube #video YASAK).
- ETIKETLER (tags, 8-15) — kisa arama ifadesi (2-5 kelime), diyalog cumlesi degil:
  1) basliga yakin tam arama ifadesi
  2) kurulum varyasyonlari (3-5)
  3) tur + film dili (kisa film / Kurzfilm / short drama)
  4) 1-2 genis ama ilgili kategori
  * Jenerik "youtube, video, yeni, kanal" YASAK.
- seoKeywords.primary = basligin ilk 3-6 kelimesindeki arama niyeti; secondary = etiket katmani 2-3.
- Sabit yorum + community: sohbet sorusu; samimi; spoiler yok.
- Shorts kancalari: tek nefeste, konuda.
- Checklist / strateji: kisa pratik not.
- chapters: timeline MM:SS; kisa beat adi; "Bolum 1" yasak.
${
  isKids
    ? `- COCUK (${project.ageBand || "3-8"}): ebeveyn guvenmeli; yumusak, net. kidsSafetyNotes vaaz gibi degil, duzgun Turkce.`
    : "- Genel izleyici; net vaat, samimi ton."
}

THUMBNAIL NOTU:
- thumbnailText: KAPAK YAZISI — flaş / sok baslik, filmin konusma dilinde (${coverLanguage} / ${coverLanguageLabel}). 5–9 kelime, 2 satir. Resmi gorunce "neymis bu hikaye?" densin. Spoiler yok. Slash yigini yok.
  Ornek TR: "Telefonda o isim vardı". Ornek DE: "Suite 908 — auf seinem Handy".
- thumbnailPrompt / thumbnailConcepts: yedek AI gorsel promptlari (Ingilizce). Asıl kapak: videodaki GERCEK kadro karesi + thumbnailText bindirmesi. Yeni yuz uydurma.
- Konseptler duygusal farkli anlari tarif etsin (yuz / aksiyon / nefes ani).
- Karakter: ${characterHint.slice(0, 180) || "ana kahraman"}.

ALANLAR: titleVariants(5-8), primaryTitle, description, tags(8-15), hashtags(3-5), seoKeywords, targetAudience, thumbnailPrompt, thumbnailText, thumbnailConcepts(3-5), chapters(3+), pinnedComment, communityPost, shortsHooks(3-6), endScreenCta, postingStrategy, uploadChecklist(6+), kidsSafetyNotes, contentWarnings[], seriesHook.`,
    user: `KANAL / PROJE
Ad: ${project.channelName || project.name}
Calisma basligi: ${project.title || project.name}
Tur: ${project.genre}
Sablon: ${project.templateType}
Tema/ders: ${project.moralLesson || "-"}
Yas: ${project.ageBand || "-"}
Kadro: ${castLine || "-"}
Kahraman gorsel: ${characterHint.slice(0, 300) || "-"}
Hedef sure ~${Math.round((timeline.totalSeconds || project.targetDurationSeconds) / 60)} dk (${Math.round(timeline.totalSeconds)} sn)
Dil: ${project.storyLanguage} / konusma: ${project.speechLanguage} — listeleme bu dilde

${listingPromptBlock(listingBrief)}

KLIP TIMELINE (bolum zamanlari BUNA gore; uydurma; aciklamaya kopyalama):
${timeline.brief.slice(0, 8_000)}

YouTube listelemesini yaz: baslik BU hikayenin kurulumu gibi dursun + ilk 150 karakterde ayni kurulum + 8-15 kisa etiket.
Sonu soyleme. Slash SEO yigini yazma.`,
    schemaName: "publish_plan_v3",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        titleVariants: { type: "array", items: { type: "string" } },
        primaryTitle: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        hashtags: { type: "array", items: { type: "string" } },
        seoKeywords: {
          type: "object",
          additionalProperties: false,
          properties: {
            primary: { type: "string" },
            secondary: { type: "array", items: { type: "string" } },
          },
          required: ["primary", "secondary"],
        },
        targetAudience: { type: "string" },
        thumbnailPrompt: { type: "string" },
        thumbnailText: { type: "string" },
        thumbnailConcepts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              emotion: { type: "string" },
              hook: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["name", "emotion", "hook", "prompt"],
          },
        },
        chapters: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              time: { type: "string" },
              label: { type: "string" },
              beat: { type: "string" },
            },
            required: ["time", "label", "beat"],
          },
        },
        pinnedComment: { type: "string" },
        communityPost: { type: "string" },
        shortsHooks: { type: "array", items: { type: "string" } },
        endScreenCta: { type: "string" },
        postingStrategy: { type: "string" },
        uploadChecklist: { type: "array", items: { type: "string" } },
        kidsSafetyNotes: { type: "string" },
        contentWarnings: { type: "array", items: { type: "string" } },
        seriesHook: { type: "string" },
      },
      required: [
        "titleVariants",
        "primaryTitle",
        "description",
        "tags",
        "hashtags",
        "seoKeywords",
        "targetAudience",
        "thumbnailPrompt",
        "thumbnailText",
        "thumbnailConcepts",
        "chapters",
        "pinnedComment",
        "communityPost",
        "shortsHooks",
        "endScreenCta",
        "postingStrategy",
        "uploadChecklist",
        "kidsSafetyNotes",
        "contentWarnings",
        "seriesHook",
      ],
    },
    zodSchema: publishMetaSchema,
  });

  const normalized = normalizePublishMeta(result, {
    titleFallback: project.title || project.name,
    isKids,
    totalSeconds: timeline.totalSeconds || project.targetDurationSeconds || 60,
    language: coverLanguage,
    topic: project.topic,
    genre: project.genre,
    summary: story?.summary,
    hook: story?.hook,
    storyTitle: story?.title || project.title,
  });
  const snappedChapters = snapChaptersToTimeline(normalized.chapters, timeline.durations);

  const meta: PublishMeta = {
    ...normalized,
    chapters: snappedChapters,
    modelUsed: model,
    reasoningEffort,
    generatedAt: new Date().toISOString(),
  };

  await persistPublishMeta(projectId, project.slug, meta, model, reasoningEffort);

  let thumbnailPath: string | null = null;
  if (options?.autoThumbnail !== false) {
    try {
      await recordEvent({
        projectId,
        step: "publish",
        message: "Thumbnail: videodan ilgi cekici kare seciliyor...",
      });
      const picked = await generateThumbnailFromVideo(projectId);
      thumbnailPath = picked.path;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordEvent({
        projectId,
        step: "publish",
        level: "warning",
        message: `Videodan thumbnail secilemedi: ${msg.slice(0, 160)}`,
      });
    }
  }

  await recordEvent({
    projectId,
    step: "publish",
    message: `Yayin plani hazir (${model}/${reasoningEffort}): ${meta.primaryTitle.slice(0, 60)}`,
  });
  return { meta, thumbnailPath };
}

async function persistPublishMeta(
  projectId: string,
  slug: string,
  meta: PublishMeta,
  model: string,
  reasoningEffort: string
): Promise<{ metaPath: string; txtPath: string }> {
  const root = ensureProjectDirs(slug);
  const publishDir = path.join(root, "output", "publish");
  const metaPath = path.join(publishDir, "youtube-meta.json");
  const txtPath = path.join(publishDir, "youtube-meta.txt");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  fs.writeFileSync(txtPath, formatPublishReadable(meta), "utf8");
  await prisma.generatedAsset.create({
    data: {
      projectId,
      kind: "publish_meta",
      path: metaPath,
      bytes: fs.statSync(metaPath).size,
      meta: JSON.stringify({ model, reasoningEffort }),
    },
  });
  return { metaPath, txtPath };
}

/** Elle duzenlenen alanlari kaydeder (baslik, aciklama, etiket...). */
export async function savePublishMetadata(
  projectId: string,
  patch: Partial<z.infer<typeof publishMetaSchema>>
): Promise<PublishMeta> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  const existing = (await loadPublishMetadata(projectId)) || {
    titleVariants: [],
    primaryTitle: project.title || project.name,
    description: "",
    tags: [],
    hashtags: [],
    seoKeywords: { primary: "", secondary: [] },
    targetAudience: "",
    thumbnailPrompt: "",
    thumbnailText: "",
    thumbnailConcepts: [],
    chapters: [],
    pinnedComment: "",
    communityPost: "",
    shortsHooks: [],
    endScreenCta: "",
    postingStrategy: "",
    uploadChecklist: [],
    kidsSafetyNotes: "",
    contentWarnings: [],
    seriesHook: "",
    modelUsed: "manual",
    reasoningEffort: "n/a",
    generatedAt: new Date().toISOString(),
  };

  const merged = {
    ...existing,
    ...patch,
    seoKeywords: patch.seoKeywords
      ? {
          primary: patch.seoKeywords.primary ?? existing.seoKeywords.primary,
          secondary: patch.seoKeywords.secondary ?? existing.seoKeywords.secondary,
        }
      : existing.seoKeywords,
    generatedAt: new Date().toISOString(),
  };

  const isKids = false;
  const normalized = normalizePublishMeta(merged, {
    titleFallback: project.title || project.name,
    isKids,
    totalSeconds: project.targetDurationSeconds || 60,
    language: filmCoverLanguage(project),
    topic: project.topic,
    genre: project.genre,
    summary: story?.summary,
    hook: story?.hook,
    storyTitle: story?.title || project.title,
  });

  const meta: PublishMeta = {
    ...normalized,
    modelUsed: existing.modelUsed || "manual",
    reasoningEffort: existing.reasoningEffort || "n/a",
    generatedAt: merged.generatedAt,
  };
  await persistPublishMeta(projectId, project.slug, meta, meta.modelUsed, meta.reasoningEffort);
  await recordEvent({ projectId, step: "publish", message: "Yayin plani elle guncellendi" });
  return meta;
}

const descriptionRefreshSchema = z.object({
  description: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
});

/**
 * Sadece YouTube aciklamasini GPT-5 (high) ile yeniden yazar:
 * kisa, spoiler yok, hafif merak — izlemeye ceker.
 */
export async function regeneratePublishDescription(projectId: string): Promise<PublishMeta> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const [story, clips, character, sides, existing] = await Promise.all([
    prisma.story.findUnique({
      where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
    }),
    prisma.clip.findMany({
      where: { projectId, languageVariant: "primary" },
      orderBy: { index: "asc" },
    }),
    prisma.characterProfile.findFirst({ where: { projectId, role: "main" } }),
    prisma.characterProfile.findMany({ where: { projectId, role: "side" } }),
    loadPublishMetadata(projectId),
  ]);

  const storyText = story?.fullStory || clips.map((c) => c.dialogue).filter(Boolean).join(" ");
  if (!storyText.trim() && !story?.summary?.trim()) {
    throw new Error("Aciklama icin hikaye/diyalog yok");
  }

  const { model } = await resolvePublishAiModel();
  // Aciklama yenilemede high cok yavas kaliyor; gpt-5 + low ile hizli, sonra ZORUNLU kisaltma
  const reasoningEffort = "low" as const;
  const isKids = false;
  const title =
    existing?.primaryTitle ||
    existing?.titleVariants?.[0] ||
    project.title ||
    project.name ||
    "Bu video";
  const castLine = [character?.name, ...sides.map((s) => s.name)].filter(Boolean).join(", ");

  await recordEvent({
    projectId,
    step: "publish",
    message: `Aciklama yenileniyor (${model}/${reasoningEffort}) — zorunlu kisa merak metni...`,
  });

  let aiDescription = "";
  let aiHashtags: string[] = [];
  try {
    const result = await structuredCall<z.infer<typeof descriptionRefreshSchema>>({
      model,
      reasoningEffort,
      maxOutputTokens: 900,
      timeoutMs: 120_000,
      system: `YouTube aciklama yazari. DIL: ${project.storyLanguage || filmCoverLanguage(project)}.

ZORUNLU CIKTI (2026):
- Ilk 150 karakterde BU hikayenin kurulumu + izleme nedeni (Show more oncesi).
- Govde 3 KISA CUMLE (~200-320 karakter). Spoiler / film ozeti / abone nutugu / bos atmosfer YOK.
- Yapi: (1) kurulum (somut: otel / handy / nikah — metindeki), (2) ayni sahneden bir nefes, (3) izleyince anlarsin.
- hashtags: 3-5, KURULUMDAN. #youtube #video YASAK.
${isKids ? `Cocuk icerik (${project.ageBand || "3-8"}): guvenli ton.` : ""}`,
      user: `BASLIK: ${title}
KADRO: ${castLine || "-"}
TEMA: ${project.moralLesson || "-"}
TUR: ${project.genre}

${listingPromptBlock(
        extractListingBrief({
          storyTitle: story?.title || title,
          projectTitle: project.title || project.name,
          topic: project.topic,
          summary: story?.summary,
          hook: story?.hook,
          genre: project.genre,
          language: filmCoverLanguage(project),
        })
      )}`,
      schemaName: "publish_description_refresh_v3",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
        },
        required: ["description", "hashtags"],
      },
      zodSchema: descriptionRefreshSchema,
    });
    aiDescription = String(result?.description || "");
    aiHashtags = Array.isArray(result?.hashtags) ? result.hashtags.map((h) => String(h || "")) : [];
  } catch (err) {
    await recordEvent({
      projectId,
      step: "publish",
      level: "warning",
      message: `Aciklama AI basarisiz, mevcut metin kisaltilacak: ${err instanceof Error ? err.message : String(err)}`,
    });
    aiDescription = existing?.description || title;
    aiHashtags = existing?.hashtags || [];
  }

  const tags = (aiHashtags.length ? aiHashtags : existing?.hashtags || [])
    .map((h) => ensureHash(String(h || "")))
    .filter(Boolean)
    .slice(0, 6);

  const listingBrief = extractListingBrief({
    storyTitle: story?.title || title,
    projectTitle: project.title || project.name,
    topic: project.topic,
    summary: story?.summary,
    hook: story?.hook,
    genre: project.genre,
    language: filmCoverLanguage(project),
  });

  // Model uzun yazsa / hata olsa bile burada kisa merak metni kesinlesir
  const description = forceShortCuriosityDescription(
    groundListingBody(aiDescription || existing?.description || title, listingBrief),
    {
      title,
      hashtags: tags,
      language: filmCoverLanguage(project),
      setup: listingBrief.setup,
      nouns: listingBrief.nouns,
    }
  );

  const base = existing || {
    titleVariants: [title],
    primaryTitle: title,
    description: "",
    tags: [],
    hashtags: [],
    seoKeywords: { primary: title, secondary: [] },
    targetAudience: "",
    thumbnailPrompt: "",
    thumbnailText: "",
    thumbnailConcepts: [],
    chapters: [],
    pinnedComment: "",
    communityPost: "",
    shortsHooks: [],
    endScreenCta: "",
    postingStrategy: "",
    uploadChecklist: [],
    kidsSafetyNotes: "",
    contentWarnings: [],
    seriesHook: "",
    modelUsed: model,
    reasoningEffort,
    generatedAt: new Date().toISOString(),
  };

  const normalized = normalizePublishMeta(
    {
      ...base,
      description,
      hashtags: tags.length ? tags : base.hashtags,
    },
    {
      titleFallback: title,
      isKids,
      totalSeconds: project.targetDurationSeconds || 60,
      language: filmCoverLanguage(project),
      topic: project.topic,
      genre: project.genre,
      summary: story?.summary,
      hook: story?.hook,
      storyTitle: story?.title || project.title,
    }
  );

  const meta: PublishMeta = {
    ...normalized,
    modelUsed: model,
    reasoningEffort,
    generatedAt: new Date().toISOString(),
  };

  await persistPublishMeta(projectId, project.slug, meta, model, reasoningEffort);
  await recordEvent({
    projectId,
    step: "publish",
    message: `Aciklama yenilendi (${model}): ${meta.description.slice(0, 80).replace(/\n/g, " ")}…`,
  });
  return meta;
}

function snapChaptersToTimeline(
  chapters: Array<{ time: string; label: string; beat: string }>,
  durations: number[]
): Array<{ time: string; label: string; beat: string }> {
  if (durations.length === 0) return chapters;
  const boundaries: number[] = [0];
  let t = 0;
  for (const d of durations) {
    t += d;
    boundaries.push(t);
  }
  const total = boundaries[boundaries.length - 1] || 1;

  return chapters.map((ch, i) => {
    const parsed = parseClock(ch.time);
    let nearest = boundaries[0];
    let best = Infinity;
    for (const b of boundaries) {
      const dist = Math.abs(b - parsed);
      if (dist < best) {
        best = dist;
        nearest = b;
      }
    }
    if (i === 0) nearest = 0;
    if (nearest > total * 0.95) nearest = boundaries[Math.max(0, boundaries.length - 2)] ?? 0;
    return { ...ch, time: formatTime(nearest) };
  });
}

function parseClock(time: string): number {
  const parts = time.trim().split(":").map(Number);
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatPublishReadable(meta: PublishMeta): string {
  return [
    `=== MODEL: ${meta.modelUsed} (reasoning=${meta.reasoningEffort}) ===`,
    `Uretildi: ${meta.generatedAt}`,
    "",
    "=== BIRINCIL BASLIK ===",
    meta.primaryTitle,
    "",
    "=== BASLIK VARYANTLARI ===",
    ...meta.titleVariants.map((t, i) => `${i + 1}. ${t}`),
    "",
    "=== HEDEF KITLE ===",
    meta.targetAudience,
    "",
    "=== SEO ===",
    `Ana: ${meta.seoKeywords.primary}`,
    `Ikincil: ${meta.seoKeywords.secondary.join(", ")}`,
    "",
    "=== ACIKLAMA ===",
    meta.description,
    "",
    "=== BOLUMLER ===",
    ...meta.chapters.map((c) => `${c.time} ${c.label}${c.beat ? ` [${c.beat}]` : ""}`),
    "",
    "=== ETIKETLER ===",
    meta.tags.join(", "),
    "",
    "=== HASHTAGS ===",
    meta.hashtags.join(" "),
    "",
    "=== SABIT YORUM ===",
    meta.pinnedComment,
    "",
    "=== COMMUNITY POST ===",
    meta.communityPost,
    "",
    "=== SHORTS KANCALARI ===",
    ...meta.shortsHooks.map((h, i) => `${i + 1}. ${h}`),
    "",
    "=== END SCREEN CTA ===",
    meta.endScreenCta,
    "",
    "=== YAYIN STRATEJISI ===",
    meta.postingStrategy,
    "",
    "=== SERI KANCASI ===",
    meta.seriesHook || "(yok)",
    "",
    "=== COCUK GUVENLIGI ===",
    meta.kidsSafetyNotes || "(yok)",
    "",
    "=== UYARILAR ===",
    meta.contentWarnings.length ? meta.contentWarnings.join(", ") : "(yok)",
    "",
    "=== YUKLEME CHECKLIST ===",
    ...meta.uploadChecklist.map((c, i) => `${i + 1}. ${c}`),
    "",
    "=== THUMBNAIL YAZISI ===",
    meta.thumbnailText || "(yok)",
    "",
    "=== THUMBNAIL KONSEPTLERI ===",
    ...meta.thumbnailConcepts.flatMap((c, i) => [`${i + 1}. ${c.name} — ${c.emotion} — ${c.hook}`, c.prompt, ""]),
    "=== THUMBNAIL PROMPT (SECILI) ===",
    meta.thumbnailPrompt,
  ].join("\n");
}

/** Kayitli yayin planini okur (varsa). */
export async function loadPublishMetadata(projectId: string): Promise<PublishMeta | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } });
  if (!project) return null;
  const metaPath = safeProjectPath(project.slug, "output", "publish", "youtube-meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as PublishMeta;
  } catch {
    return null;
  }
}

/** Meta + son thumbnail/SRT yollari (UI kaliciligi). */
export async function loadPublishPackage(projectId: string): Promise<PublishPackage> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } });
  if (!project) {
    return { meta: null, thumbnails: [], srtPath: null, subtitleFiles: [], metaJsonPath: null, metaTxtPath: null };
  }

  const meta = await loadPublishMetadata(projectId);
  const metaJsonPath = safeProjectPath(project.slug, "output", "publish", "youtube-meta.json");
  const metaTxtPath = safeProjectPath(project.slug, "output", "publish", "youtube-meta.txt");

  const assets = await prisma.generatedAsset.findMany({
    where: { projectId, kind: { in: ["thumbnail", "srt"] } },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const thumbnails = assets
    .filter((a) => a.kind === "thumbnail" && a.path && fs.existsSync(a.path))
    .slice(0, 8)
    .map((a) => ({ path: a.path, createdAt: a.createdAt.toISOString() }));

  // Diskte DB kaydi olmayan thumbnail'leri de tara
  const publishDir = path.join(ensureProjectDirs(project.slug), "output", "publish");
  if (fs.existsSync(publishDir)) {
    for (const name of fs.readdirSync(publishDir)) {
      if (!/^thumbnail(-\d+)?\.png$/i.test(name)) continue;
      const full = path.join(publishDir, name);
      if (!thumbnails.some((t) => t.path === full) && fs.existsSync(full)) {
        thumbnails.push({ path: full, createdAt: fs.statSync(full).mtime.toISOString() });
      }
    }
  }
  thumbnails.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const srtAsset = assets.find((a) => a.kind === "srt" && a.path && fs.existsSync(a.path));
  let srtPath = srtAsset?.path ?? null;
  if (!srtPath) {
    const root = ensureProjectDirs(project.slug);
    const candidate = path.join(root, "output", "final.srt");
    if (fs.existsSync(candidate)) srtPath = candidate;
  }

  const { listYoutubeSubtitleFiles } = await import("@/server/services/youtube-subtitles");
  const subtitleFiles = listYoutubeSubtitleFiles(project.slug).map((f) => ({
    code: f.code,
    name: f.name,
    youtube: f.youtube,
    path: f.path,
    downloadName: f.downloadName,
  }));
  if (subtitleFiles[0] && !srtPath) srtPath = subtitleFiles[0].path;

  return {
    meta,
    thumbnails: thumbnails.slice(0, 8),
    srtPath,
    subtitleFiles,
    metaJsonPath: fs.existsSync(metaJsonPath) ? metaJsonPath : null,
    metaTxtPath: fs.existsSync(metaTxtPath) ? metaTxtPath : null,
  };
}

function emotionScore(label: string): number {
  const t = label.toLowerCase();
  // YouTube: abartili duygu (sasirma/gerilim/heyecan) CTR'yi en cok artirir
  if (/kork|panik|gergin|kriz|kayma|tehlike|sasir|sok|adrenalin/.test(t)) return 5;
  if (/heyecan|merak|neseli|zafer|cosku|mutlu/.test(t)) return 4;
  if (/uzgun|yorgun|endise|umut/.test(t)) return 2;
  if (/sakin|notr|idle|duragan/.test(t)) return 0;
  return 1;
}

type RankedClip = {
  index: number;
  score: number;
  reason: string;
  emotionLabel: string;
  videoPath: string | null;
  lastFramePath: string | null;
  sceneImagePath: string | null;
  duration: number;
};

/** Ilgi cekici thumbnail adaylarini merak/duygu/kanca ile siralar (YouTube yuz+duygu odakli). */
export function rankThumbnailClips(
  clips: Array<{
    index: number;
    status: string;
    curiosityScore: number;
    hasHook: boolean;
    emotionLabel: string;
    videoPath: string | null;
    lastFramePath: string | null;
    sceneImagePath: string | null;
    actualDurationSeconds: number | null;
    estimatedDurationSeconds: number;
  }>
): RankedClip[] {
  const usable = clips.filter(
    (c) =>
      c.status === "completed" && Boolean(c.videoPath || c.lastFramePath || c.sceneImagePath)
  );
  if (usable.length === 0) return [];

  const n = usable.length;
  return usable
    .map((c, i) => {
      const pos = n <= 1 ? 0.5 : i / (n - 1);
      // Ortaya / doruga yakin (ilk acilis ve final daha zayif — YouTube'da "aksiyon anı" daha iyi)
      const positionBoost = pos >= 0.25 && pos <= 0.8 ? 4 : pos >= 0.15 && pos < 0.25 ? 2 : pos > 0.8 ? 1 : 0;
      const score =
        (c.curiosityScore || 0) * 2 +
        (c.hasHook ? 3 : 0) +
        emotionScore(c.emotionLabel || "") +
        positionBoost;
      const reason = [
        c.hasHook ? "kancali beat" : null,
        c.curiosityScore >= 7 ? `yuksek merak (${c.curiosityScore})` : null,
        c.emotionLabel ? `duygu: ${c.emotionLabel}` : null,
        positionBoost >= 3 ? "filmin orta-doruk bolgesi" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        index: c.index,
        score,
        reason: reason || `sahne #${c.index}`,
        emotionLabel: c.emotionLabel || "",
        videoPath: c.videoPath,
        lastFramePath: c.lastFramePath,
        sceneImagePath: c.sceneImagePath,
        duration: c.actualDurationSeconds ?? c.estimatedDurationSeconds ?? 8,
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Son uretilen video-thumbnail'lerde kullanilan klip + saniye (tekrar engeli). */
export async function loadRecentThumbnailPicks(
  projectId: string,
  limit = 8
): Promise<Array<{ clipIndex: number; atSec: number | null }>> {
  const assets = await prisma.generatedAsset.findMany({
    where: { projectId, kind: "thumbnail" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { meta: true },
  });
  const out: Array<{ clipIndex: number; atSec: number | null }> = [];
  for (const a of assets) {
    try {
      const meta = JSON.parse(a.meta || "{}") as {
        source?: string;
        clipIndex?: number;
        detail?: string;
      };
      if (meta.source !== "video" || meta.clipIndex == null) continue;
      const atMatch = String(meta.detail || "").match(/@(\d+(?:\.\d+)?)s/);
      out.push({
        clipIndex: meta.clipIndex,
        atSec: atMatch ? Number(atMatch[1]) : null,
      });
    } catch {
      // ignore
    }
  }
  return out;
}

/**
 * Ust siradaki adaylardan biri — son kullanilan klipleri / ayni saniyeyi atlar.
 * Her tiklamada farkli kare uretmek icin.
 */
export function pickDiverseThumbnailCandidate(
  ranked: RankedClip[],
  recent: Array<{ clipIndex: number; atSec: number | null }>,
  preferredClipIndex?: number,
  excludeClipIndexes?: number[]
): { clip: RankedClip; frameRatio: number } {
  if (ranked.length === 0) throw new Error("Thumbnail adayi yok");
  const excluded = new Set(excludeClipIndexes || []);
  const available = ranked.filter((r) => !excluded.has(r.index));
  const poolSource = available.length > 0 ? available : ranked;

  if (preferredClipIndex != null) {
    const forced = poolSource.find((r) => r.index === preferredClipIndex) || ranked.find((r) => r.index === preferredClipIndex);
    if (forced) {
      const usedAts = recent.filter((r) => r.clipIndex === forced.index).map((r) => r.atSec);
      const ratios = [0.28, 0.42, 0.55, 0.68, 0.78];
      const frameRatio =
        ratios.find((r) => !usedAts.some((u) => u != null && Math.abs(u - forced.duration * r) < 0.35)) ||
        ratios[recent.length % ratios.length];
      return { clip: forced, frameRatio };
    }
  }

  const recentIndexes = new Set(recent.slice(0, 5).map((r) => r.clipIndex));
  const topPool = poolSource.slice(0, Math.min(6, poolSource.length));
  const fresh = topPool.filter((r) => !recentIndexes.has(r.index) && !excluded.has(r.index));
  const pool = fresh.length > 0 ? fresh : topPool;

  // Skora gore agirlikli secim — her seferinde #1'i zorlamaz
  const weights = pool.map((r, i) => Math.max(1, r.score) * (pool.length - i));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = (Date.now() + ranked.length * 17) % total;
  let chosen = pool[0];
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) {
      chosen = pool[i];
      break;
    }
  }

  const usedAts = recent.filter((r) => r.clipIndex === chosen.index).map((r) => r.atSec);
  // Duygusal doruk: klip ortasi-sonrasi (0.45 sabitini kir)
  const ratios = [0.32, 0.45, 0.58, 0.7, 0.22];
  const frameRatio =
    ratios.find((r) => !usedAts.some((u) => u != null && Math.abs(u - chosen.duration * r) < 0.4)) ||
    ratios[(recent.length + chosen.index) % ratios.length];

  return { clip: chosen, frameRatio };
}

/**
 * Videodaki ilgi cekici klibin cesitli bir karesinden kapak secer
 * ve uzerine film dilinde kalin kapak yazisi bindirir (ust safe-zone).
 * OpenAI image_generation KULLANMAZ — hiz siniri yok.
 */
export async function generateThumbnailFromVideo(
  projectId: string,
  options?: {
    preferredClipIndex?: number;
    overlayText?: string;
    /** varsayilan true — kapaga yazi yaz */
    withText?: boolean;
    excludeClipIndexes?: number[];
  }
): Promise<{ path: string; clipIndex: number; reason: string; overlayText: string }> {
  let preferredClipIndex = options?.preferredClipIndex;
  const withText = options?.withText !== false;

  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  // Zaman Yolcusu kapagi: sunucunun kameraya konustugu kare + ayarlardaki kapak yazisi.
  let timeTravelCoverText = "";
  if (project.templateType === "time_travel") {
    const { parseTimeTravelSettings } = await import("@/lib/time-travel");
    timeTravelCoverText = parseTimeTravelSettings(project.timeTravelSettings).thumbnailText.trim();
    if (preferredClipIndex === undefined) {
      const selfies = await prisma.clip.findMany({
        where: { projectId, languageVariant: "primary", shotType: "tt_selfie", videoPath: { not: null } },
        orderBy: { index: "asc" },
        select: { index: true, videoPath: true },
      });
      const usable = selfies.filter((c) => c.videoPath && fs.existsSync(c.videoPath));
      if (usable.length > 0) preferredClipIndex = usable[Math.min(1, usable.length - 1)].index;
    }
  }
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
    select: { title: true, summary: true, hook: true },
  });
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
    select: {
      index: true,
      status: true,
      curiosityScore: true,
      hasHook: true,
      emotionLabel: true,
      videoPath: true,
      lastFramePath: true,
      sceneImagePath: true,
      actualDurationSeconds: true,
      estimatedDurationSeconds: true,
    },
  });

  const ranked = rankThumbnailClips(clips).filter(
    (r) =>
      (r.videoPath && fs.existsSync(r.videoPath)) ||
      (r.lastFramePath && fs.existsSync(r.lastFramePath)) ||
      (r.sceneImagePath && fs.existsSync(r.sceneImagePath))
  );
  if (ranked.length === 0) {
    throw new Error("Tamamlanmis klip videosu yok — once klipleri uretin veya AI thumbnail deneyin.");
  }

  const recent = await loadRecentThumbnailPicks(projectId, 10);
  const { clip: picked, frameRatio } = pickDiverseThumbnailCandidate(
    ranked,
    recent,
    preferredClipIndex,
    options?.excludeClipIndexes
  );

  const meta = await loadPublishMetadata(projectId);
  const coverLanguage = filmCoverLanguage(project);
  const overlayText = craftThumbnailOverlayText({
    thumbnailText: options?.overlayText || timeTravelCoverText || meta?.thumbnailText,
    shortsHooks: meta?.shortsHooks,
    emotionLabel: picked.emotionLabel || picked.reason,
    language: coverLanguage,
    topic: project.topic,
    title: project.title || project.name,
    genre: project.genre,
    hook: story?.hook,
    summary: story?.summary,
    storyTitle: story?.title || project.title,
    rotateSalt: Date.now() + picked.index * 13,
  });

  const root = ensureProjectDirs(project.slug);
  const publishDir = path.join(root, "output", "publish");
  fs.mkdirSync(publishDir, { recursive: true });
  const plainPath = nextAvailablePath(path.join(publishDir, "thumbnail-plain.png"));
  const thumbPath = nextAvailablePath(path.join(publishDir, "thumbnail.png"));

  let sourceNote = "frame";
  if (picked.videoPath && fs.existsSync(picked.videoPath)) {
    let at = Math.max(0.35, picked.duration * frameRatio);
    try {
      const info = await probeVideo(picked.videoPath);
      if (info.durationSeconds > 0.8) {
        at = Math.min(
          info.durationSeconds - 0.25,
          Math.max(0.25, info.durationSeconds * frameRatio)
        );
      }
    } catch {
      // probe basarisizsa tahmini sureyle devam
    }
    await extractFrameAt(picked.videoPath, at, plainPath);
    sourceNote = `clip#${picked.index}@${at.toFixed(1)}s`;
  } else if (picked.lastFramePath && fs.existsSync(picked.lastFramePath)) {
    fs.copyFileSync(picked.lastFramePath, plainPath);
    sourceNote = `lastFrame#${picked.index}`;
  } else if (picked.sceneImagePath && fs.existsSync(picked.sceneImagePath)) {
    fs.copyFileSync(picked.sceneImagePath, plainPath);
    sourceNote = `sceneImage#${picked.index}`;
  } else {
    throw new Error(`Sahne #${picked.index} icin kullanilabilir kare yok`);
  }

  if (!fs.existsSync(plainPath) || fs.statSync(plainPath).size < 800) {
    throw new Error("Thumbnail karesi yazilamadi");
  }

  let finalPath = plainPath;
  let textNote = "";
  if (withText && overlayText) {
    try {
      // YouTube: yazi USTTE — sag-alt sure rozeti kapamasin
      await burnTextOntoImage(plainPath, thumbPath, overlayText, { position: "top" });
      finalPath = thumbPath;
      textNote = overlayText;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordEvent({
        projectId,
        step: "publish",
        level: "warning",
        message: `Kapak yazisi bindirilemedi (${msg.slice(0, 120)}); duz kare kullanildi`,
      });
      fs.copyFileSync(plainPath, thumbPath);
      finalPath = thumbPath;
    }
  } else {
    fs.copyFileSync(plainPath, thumbPath);
    finalPath = thumbPath;
  }

  await prisma.generatedAsset.create({
    data: {
      projectId,
      kind: "thumbnail",
      path: finalPath,
      bytes: fs.statSync(finalPath).size,
      meta: JSON.stringify({
        source: "video",
        clipIndex: picked.index,
        reason: picked.reason,
        detail: sourceNote,
        score: picked.score,
        frameRatio,
        overlayText: textNote || null,
      }),
    },
  });
  await recordEvent({
    projectId,
    step: "publish",
    message: textNote
      ? `Thumbnail videodan + yazi: sahne #${picked.index} — "${textNote}" (${sourceNote})`
      : `Thumbnail videodan secildi: sahne #${picked.index} (${picked.reason})`,
  });
  return { path: finalPath, clipIndex: picked.index, reason: picked.reason, overlayText: textNote || overlayText };
}

async function loadCastSheetPaths(projectId: string): Promise<Array<{ name: string; path: string }>> {
  const cast = await prisma.characterProfile.findMany({
    where: { projectId, role: { in: ["main", "side"] } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { name: true, role: true, referenceImagePath: true },
  });
  return cast
    .filter((m) => m.referenceImagePath && fs.existsSync(m.referenceImagePath))
    .map((m) => ({ name: m.name, path: m.referenceImagePath as string }));
}

/** AI ile thumbnail uretir (yedek yol; varsa gercek kadro sheet'i referans). */
export async function generateThumbnail(projectId: string, customPrompt?: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const isKids = false;
  const character = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
  const sheets = await loadCastSheetPaths(projectId);
  const characterHint = [
    character?.name,
    ...sheets.map((s) => s.name),
    character?.baseAppearancePrompt,
    character?.baseWardrobePrompt,
  ]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(" | ");

  let prompt = customPrompt?.trim();
  if (!prompt) {
    const metaPath = safeProjectPath(project.slug, "output", "publish", "youtube-meta.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { thumbnailPrompt?: string };
      prompt = meta.thumbnailPrompt;
    }
  }
  if (!prompt) {
    // Yayin plani olmadan da kapak uretilebilsin: hikaye + tur bilgisinden CTR brief.
    prompt = defaultCtrThumbnailBrief(project.title || project.name, project.genre);
  }

  const enhanced = enhanceThumbnailPrompt(prompt, {
    isKids,
    characterHint,
    castLocked: sheets.length > 0,
  });
  const buffer = await generateFlowImageBuffer({
    projectId,
    prompt: enhanced,
    aspect: "16:9",
    step: "publish",
    label: "AI kapak",
    referenceImagePaths: sheets.map((s) => s.path),
  });
  const root = ensureProjectDirs(project.slug);
  const thumbPath = nextAvailablePath(path.join(root, "output", "publish", "thumbnail.png"));
  fs.writeFileSync(thumbPath, buffer);
  await prisma.generatedAsset.create({
    data: {
      projectId,
      kind: "thumbnail",
      path: thumbPath,
      bytes: buffer.length,
      meta: JSON.stringify({ enhanced: true, source: "ai" }),
    },
  });
  await recordEvent({
    projectId,
    step: "publish",
    message: `AI thumbnail uretildi: ${path.basename(thumbPath)}`,
  });
  return thumbPath;
}

/** Yayin plani yokken kullanilan CTR sahne brief'i. */
function defaultCtrThumbnailBrief(title: string, genre: string): string {
  return [
    `Turkish short-drama moment for a story titled "${title.slice(0, 80)}" in the "${genre}" genre:`,
    "the exact second a betrayal or hidden identity is revealed — one shocked adult face reacting, the other side smug or luxurious;",
    "a concrete drama prop in frame (divorce papers, phone, car key, wedding ring or contract).",
  ].join(" ");
}

/** Longform karelerinden kapak icin en carpici olani secer. */
function pickBestStillClip(
  clips: Array<{ index: number; sceneImagePath: string | null; emotionLabel: string; curiosityScore: number }>
): { index: number; sceneImagePath: string } | null {
  const withStill = clips.filter((c) => c.sceneImagePath && fs.existsSync(c.sceneImagePath));
  if (withStill.length === 0) return null;
  const scored = withStill
    .map((c) => {
      let score = c.curiosityScore || 0;
      if (/ofke|öfke|sok|şok|zafer|ihanet|asagilanma|aşağılanma|pisman|pişman/i.test(c.emotionLabel)) score += 5;
      // Ilk kare genelde kurulus; orta bolgeye hafif oncelik
      const mid = Math.abs(c.index - withStill.length / 2);
      score -= mid / Math.max(1, withStill.length);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored[0].c;
  return { index: top.index, sceneImagePath: top.sceneImagePath! };
}

/**
 * Tek cagrida otomatik kapak — otopilot ve tek tik icin.
 * Sirasi: klip videosu karesi (sinema) → hazir kare (gorsel anlati) → AI kompozisyon.
 * Hepsi ustune film dilinde flaş / sok kapak yazisi basilir.
 */
export async function generateAutoThumbnail(projectId: string): Promise<{ path: string; note: string }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
    select: { title: true, summary: true, hook: true },
  });
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
    select: { index: true, videoPath: true, sceneImagePath: true, emotionLabel: true, curiosityScore: true },
  });
  const meta = await loadPublishMetadata(projectId);
  const emotionHint = clips.find((c) => c.emotionLabel)?.emotionLabel || "";
  const overlayText = craftThumbnailOverlayText({
    thumbnailText: meta?.thumbnailText,
    shortsHooks: meta?.shortsHooks,
    emotionLabel: emotionHint,
    language: filmCoverLanguage(project),
    topic: project.topic,
    title: project.title || project.name,
    genre: project.genre,
    hook: story?.hook,
    summary: story?.summary,
    storyTitle: story?.title || project.title,
    rotateSalt: Date.now(),
  });

  const hasVideo = clips.some((c) => c.videoPath && fs.existsSync(c.videoPath));
  if (hasVideo) {
    const picked = await generateThumbnailFromVideo(projectId, { overlayText, withText: true });
    return { path: picked.path, note: `videodan sahne #${picked.clipIndex} + "${picked.overlayText || overlayText}"` };
  }

  const still = pickBestStillClip(clips);
  const root = ensureProjectDirs(project.slug);
  if (still) {
    const outPath = nextAvailablePath(path.join(root, "output", "publish", "thumbnail-auto.png"));
    await burnTextOntoImage(still.sceneImagePath, outPath, overlayText, { position: "top", accent: true });
    await prisma.generatedAsset.create({
      data: {
        projectId,
        kind: "thumbnail",
        path: outPath,
        bytes: fs.statSync(outPath).size,
        meta: JSON.stringify({ source: "still", clipIndex: still.index, overlayText }),
      },
    });
    await recordEvent({
      projectId,
      step: "publish",
      message: `Kapak hazir: kare #${still.index} + "${overlayText}"`,
    });
    return { path: outPath, note: `kare #${still.index} + "${overlayText}"` };
  }

  // Hicbir gorsel yok: AI kompozisyon + yazi
  const aiPath = await generateThumbnail(projectId);
  const outPath = nextAvailablePath(path.join(root, "output", "publish", "thumbnail-auto.png"));
  await burnTextOntoImage(aiPath, outPath, overlayText, { position: "top", accent: true });
  return { path: outPath, note: `AI kompozisyon + "${overlayText}"` };
}

async function generateCastLockedThumbnailVariant(
  projectId: string,
  options: {
    overlayText: string;
    composition: "face" | "split";
    sheets: Array<{ name: string; path: string }>;
    characterHint: string;
    brief: string;
    fileStem: string;
    label: string;
  }
): Promise<{ path: string; overlayText: string }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const root = ensureProjectDirs(project.slug);
  const refs = options.sheets.slice(0, options.composition === "split" ? 3 : 2).map((s) => s.path);
  const prompt = enhanceThumbnailPrompt(options.brief, {
    characterHint: `${options.characterHint} | cast: ${options.sheets.map((s) => s.name).join(", ")}`,
    composition: options.composition,
    castLocked: refs.length > 0,
  });
  const buffer = await generateFlowImageBuffer({
    projectId,
    prompt,
    aspect: "16:9",
    step: "publish",
    label: options.label,
    referenceImagePaths: refs,
  });
  const rawPath = nextAvailablePath(path.join(root, "output", "publish", `${options.fileStem}.png`));
  fs.writeFileSync(rawPath, buffer);
  const finalPath = nextAvailablePath(path.join(root, "output", "publish", `${options.fileStem}-text.png`));
  await burnTextOntoImage(rawPath, finalPath, options.overlayText, {
    position: "top",
    accent: true,
    arrow: options.composition === "face" ? "right" : undefined,
  });
  await prisma.generatedAsset.create({
    data: {
      projectId,
      kind: "thumbnail",
      path: finalPath,
      bytes: fs.statSync(finalPath).size,
      meta: JSON.stringify({
        source: options.composition === "face" ? "cast-face" : "cast-split",
        overlayText: options.overlayText,
        cast: options.sheets.map((s) => s.name),
      }),
    },
  });
  return { path: finalPath, overlayText: options.overlayText };
}

/**
 * 3 kapak varyanti: gercek kadro kareleri + film dilinde oto kapak yazisi.
 * Video varsa 3 farkli sahne; yoksa sheet referansli AI (yeni yuz yok).
 */
export async function generateThumbnailVariants(
  projectId: string
): Promise<Array<{ path: string; label: string; overlayText: string }>> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const character = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
  const sheets = await loadCastSheetPaths(projectId);
  const characterHint = [character?.name, character?.baseAppearancePrompt, character?.baseWardrobePrompt]
    .filter(Boolean)
    .join(" | ");
  const meta = await loadPublishMetadata(projectId);
  const coverLanguage = filmCoverLanguage(project);
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
    select: { emotionLabel: true },
  });
  const emotionHint = clips.find((c) => c.emotionLabel)?.emotionLabel || "";
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
    select: { title: true, summary: true, hook: true },
  });
  const overlays = craftThumbnailOverlayVariants({
    thumbnailText: meta?.thumbnailText,
    shortsHooks: meta?.shortsHooks,
    emotionLabel: emotionHint,
    language: coverLanguage,
    topic: project.topic,
    title: project.title || project.name,
    genre: project.genre,
    hook: story?.hook,
    summary: story?.summary,
    storyTitle: story?.title || project.title,
    count: 3,
  });
  const brief = meta?.thumbnailPrompt?.trim() || defaultCtrThumbnailBrief(project.title || project.name, project.genre);
  const specs: Array<{
    label: string;
    composition: "face" | "split";
    fileStem: string;
    aiLabel: string;
  }> = [
    { label: "Sahneden", composition: "face", fileStem: "thumbnail-scene", aiLabel: "Kapak varyanti (sahne)" },
    { label: "Yüz anı", composition: "face", fileStem: "thumbnail-face", aiLabel: "Kapak varyanti (yuz)" },
    { label: "Zıtlık", composition: "split", fileStem: "thumbnail-split", aiLabel: "Kapak varyanti (zitlik)" },
  ];

  const out: Array<{ path: string; label: string; overlayText: string }> = [];
  const usedIndexes: number[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const overlay = overlays[i] || overlays[0];
    try {
      const picked = await generateThumbnailFromVideo(projectId, {
        overlayText: overlay,
        withText: true,
        excludeClipIndexes: usedIndexes,
      });
      usedIndexes.push(picked.clipIndex);
      out.push({
        path: picked.path,
        label: `${spec.label} (#${picked.clipIndex})`,
        overlayText: picked.overlayText || overlay,
      });
      continue;
    } catch (err) {
      await recordEvent({
        projectId,
        step: "publish",
        level: "warning",
        message: `${spec.label} video karesi yok: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
      });
    }

    if (sheets.length === 0) continue;
    try {
      const made = await generateCastLockedThumbnailVariant(projectId, {
        overlayText: overlay,
        composition: spec.composition,
        sheets,
        characterHint,
        brief,
        fileStem: spec.fileStem,
        label: spec.aiLabel,
      });
      out.push({
        path: made.path,
        label: `${spec.label} (kadro sheet)`,
        overlayText: made.overlayText,
      });
    } catch (err) {
      await recordEvent({
        projectId,
        step: "publish",
        level: "warning",
        message: `${spec.label} sheet varyanti uretilemedi: ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`,
      });
    }
  }

  if (out.length === 0) throw new Error("Hicbir kapak varyanti uretilemedi");
  await recordEvent({
    projectId,
    step: "publish",
    message: `${out.length} kapak varyanti hazir (${filmCoverLanguageLabel(coverLanguage)} yazi, gercek kadro)`,
  });
  return out;
}

/** Final videoyla uyumlu SRT dosyasi uretir (tek dil / eski yol). */
export async function generateSrtFile(projectId: string, languageVariant = "primary"): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.templateType === "longform" && languageVariant === "primary") {
    const tsPath = path.join(ensureProjectDirs(project.slug), "longform", "timestamps.json");
    if (fs.existsSync(tsPath)) {
      const items = JSON.parse(fs.readFileSync(tsPath, "utf8")) as Array<{
        text: string;
        startSeconds: number;
        endSeconds: number;
      }>;
      const cues = buildSrtCuesFromTimestamps(items);
      const content = buildSrtContent(cues);
      const root = ensureProjectDirs(project.slug);
      const srtPath = path.join(root, "output", "publish", "youtube-altyazi-ana-dil.srt");
      fs.mkdirSync(path.dirname(srtPath), { recursive: true });
      fs.writeFileSync(srtPath, `\uFEFF${content}`, "utf8");
      await prisma.generatedAsset.create({
        data: { projectId, kind: "srt", path: srtPath, bytes: Buffer.byteLength(content, "utf8"), languageVariant },
      });
      await recordEvent({
        projectId,
        step: "publish",
        message: `SRT altyazi uretildi (TTS zaman damgasi): ${path.basename(srtPath)} (${cues.length} kuyruk)`,
      });
      return srtPath;
    }
  }
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant },
    orderBy: { index: "asc" },
  });
  const { selectClipsForRender } = await import("@/server/services/render");
  // Primary'de final ile ayni klip seti; diger varyantlarda diyalog+estimated sure
  const timed =
    languageVariant === "primary"
      ? selectClipsForRender(clips).included.map((row) => {
          const c = clips.find((x) => x.index === row.index)!;
          return {
            index: c.index,
            dialogue: c.dialogue,
            durationSeconds: c.actualDurationSeconds ?? c.estimatedDurationSeconds,
          };
        })
      : clips
          .filter((c) => c.dialogue.trim())
          .map((c) => ({
            index: c.index,
            dialogue: c.dialogue,
            durationSeconds: c.actualDurationSeconds ?? c.estimatedDurationSeconds,
          }));
  if (timed.length === 0) throw new Error("SRT icin diyaloglu / videosu olan klip yok");

  const cues = buildSrtCues(timed);
  const content = buildSrtContent(cues);

  const root = ensureProjectDirs(project.slug);
  const label = languageVariant === "primary" ? "ana-dil" : languageVariant;
  const srtPath = path.join(root, "output", "publish", `youtube-altyazi-${label}.srt`);
  fs.mkdirSync(path.dirname(srtPath), { recursive: true });
  fs.writeFileSync(srtPath, `\uFEFF${content}`, "utf8");
  await prisma.generatedAsset.create({
    data: { projectId, kind: "srt", path: srtPath, bytes: Buffer.byteLength(content, "utf8"), languageVariant },
  });
  await recordEvent({
    projectId,
    step: "publish",
    message: `SRT altyazi uretildi: ${path.basename(srtPath)} (${cues.length} kuyruk)`,
  });
  return srtPath;
}

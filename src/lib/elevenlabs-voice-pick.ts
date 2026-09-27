import { elevenLabsLanguageCode, languageTagFor } from "@/lib/tts-catalog";

export type ElevenLabsGender = "female" | "male" | "neutral";

export interface ElevenLabsVoiceInfo {
  voiceId: string;
  name: string;
  gender: ElevenLabsGender;
  language?: string;
  verifiedLanguages: string[];
  labels: Record<string, string>;
  category?: string;
  description?: string;
}

export interface ElevenLabsPickHint {
  language?: string;
  genre?: string;
  preferGender?: ElevenLabsGender;
}

const FEMALE_RE = /female|woman|kadin|kadın|girl|narrator.*she/i;
const MALE_RE = /male|man|erkek|boy(?!friend)/i;
const CHILD_RE = /child|kid|cocuk|çocuk|teen|bebek/i;

/** Tam kelime — "female" icindeki "de" Almanca sayilmasin. */
const LANGUAGE_MARKERS: Record<string, RegExp> = {
  tr: /\b(tr|turkish|turkce|türkçe|istanbul)\b/i,
  en: /\b(en|eng|english|american|british|us|uk|australian)\b/i,
  de: /\b(de|ger|german|deutsch|germany|austria)\b/i,
  fr: /\b(fr|fra|french|francais|français|france)\b/i,
  es: /\b(es|spa|spanish|espanol|español|castilian|mexico|spain)\b/i,
};

function blobOf(voice: ElevenLabsVoiceInfo): string {
  return [
    voice.name,
    voice.description,
    voice.category,
    voice.language,
    ...voice.verifiedLanguages,
    ...Object.values(voice.labels),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function inferElevenLabsGender(voice: Pick<ElevenLabsVoiceInfo, "name" | "labels" | "description">): ElevenLabsGender {
  const raw = `${voice.labels.gender || ""} ${voice.labels.sex || ""} ${voice.description || ""} ${voice.name}`;
  if (FEMALE_RE.test(raw)) return "female";
  if (MALE_RE.test(raw)) return "male";
  return "neutral";
}

function collectVerifiedLanguages(raw: Record<string, unknown>, labels: Record<string, string>): string[] {
  const tags = new Set<string>();
  const push = (value: string) => {
    const tag = languageTagFor(value);
    if (tag) tags.add(tag);
  };
  push(labels.language || "");
  push(labels.locale || "");
  push(String(raw.language || ""));
  const verified = raw.verified_languages;
  if (Array.isArray(verified)) {
    for (const item of verified) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      push(String(row.language || ""));
      push(String(row.locale || ""));
    }
  }
  return [...tags];
}

export function normalizeElevenLabsVoice(raw: Record<string, unknown>): ElevenLabsVoiceInfo | null {
  const voiceId = String(raw.voice_id || raw.voiceId || "").trim();
  if (!voiceId) return null;
  const labels =
    raw.labels && typeof raw.labels === "object" && !Array.isArray(raw.labels)
      ? Object.fromEntries(Object.entries(raw.labels as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : {};
  const name = String(raw.name || voiceId);
  const description = String(raw.description || "");
  const verifiedLanguages = collectVerifiedLanguages(raw, labels);
  return {
    voiceId,
    name,
    gender: inferElevenLabsGender({ name, labels, description }),
    language: String(labels.language || labels.locale || raw.language || "").trim() || undefined,
    verifiedLanguages,
    labels,
    category: String(raw.category || "").trim() || undefined,
    description,
  };
}

export function preferredNarratorGender(_genre = ""): ElevenLabsGender {
  return "female";
}

function markersHit(blob: string, tag: string): boolean {
  const re = LANGUAGE_MARKERS[tag];
  return Boolean(re && re.test(blob));
}

export function voiceSupportsLanguage(voice: ElevenLabsVoiceInfo, language?: string): boolean {
  const tag = languageTagFor(language);
  if (!tag) return true;
  if (voice.verifiedLanguages.includes(tag)) return true;
  const blob = blobOf(voice);
  if (markersHit(blob, tag)) return true;
  const known = Object.keys(LANGUAGE_MARKERS).filter((other) => other !== tag && (voice.verifiedLanguages.includes(other) || markersHit(blob, other)));
  if (known.length === 0) return true;
  return false;
}

export function scoreElevenLabsVoice(voice: ElevenLabsVoiceInfo, hint: ElevenLabsPickHint): number {
  const blob = blobOf(voice);
  if (CHILD_RE.test(blob)) return -50;
  const tag = languageTagFor(hint.language);
  const gender = hint.preferGender || preferredNarratorGender(hint.genre);
  const genre = (hint.genre || "").toLowerCase();
  let score = 0;

  if (gender !== "neutral") {
    if (voice.gender === gender) score += 8;
    else if (voice.gender !== "neutral") score -= 6;
  }

  if (tag) {
    if (voice.verifiedLanguages.includes(tag)) score += 14;
    else if (markersHit(blob, tag)) score += 12;
    else if (voiceSupportsLanguage(voice, hint.language)) score += 4;
    else score -= 10;
    if (/multilingual|multi-?lingual/.test(blob)) score += 2;
  }

  if (/narrat|anlat|story|dramatic|cinema|novel/.test(blob)) score += 4;
  if (genre && /korku|gerilim|mystery/.test(genre) && /dark|serious|intense|low/.test(blob)) score += 3;
  if (genre && /romantik/.test(genre) && /warm|soft|gentle/.test(blob)) score += 3;
  if (/cloned|professional|generated/.test(voice.category || "")) score += 2;
  if (/premade|default/.test(voice.category || "")) score += 1;

  return score;
}

export function pickElevenLabsVoice(
  voices: ElevenLabsVoiceInfo[],
  hint: ElevenLabsPickHint = {}
): ElevenLabsVoiceInfo | null {
  if (voices.length === 0) return null;
  const ranked = [...voices].sort((a, b) => {
    const diff = scoreElevenLabsVoice(b, hint) - scoreElevenLabsVoice(a, hint);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
  return ranked[0] ?? null;
}

export function elevenLabsSpeechBodies(input: {
  text: string;
  language?: string;
  stability: number;
  style: number;
  /** v3 duygu etiketleri (or. ["[angry]"]) — v3 govdesinde metnin basina eklenir. */
  v3Tags?: string[];
  /**
   * Cumle cumle etiketlenmis v3 metni. Verildiginde v3 govdesinde bunun
   * kullanilir: sert cumle sert, sonraki sakin cumle sakin okunur.
   */
  v3Text?: string;
}): Array<Record<string, unknown>> {
  const tag = elevenLabsLanguageCode(input.language);
  const voice_settings = {
    stability: input.stability,
    similarity_boost: 0.8,
    style: input.style,
    use_speaker_boost: true,
  };
  // eleven_v3: duygu etiketlerini ([angry], [shouts], [crying]...) gercekten
  // OYNAR — bagirma/aglama seste duyulur. Hesapta v3 yoksa 4xx doner ve
  // zincir otomatik olarak multilingual_v2 / flash_v2_5'e duser.
  const v3TagPrefix = (input.v3Tags || []).filter(Boolean).join(" ");
  const taggedText =
    input.v3Text?.trim() || (v3TagPrefix ? `${v3TagPrefix} ${input.text}` : input.text);
  const v3: Record<string, unknown> = {
    text: taggedText,
    model_id: "eleven_v3",
    // v3 stability yalnizca 0.0 (Creative) / 0.5 (Natural) / 1.0 (Robust) kabul eder.
    voice_settings: {
      stability: input.stability < 0.35 ? 0.0 : 0.5,
      similarity_boost: 0.8,
      use_speaker_boost: true,
    },
  };
  const flash: Record<string, unknown> = {
    text: input.text,
    model_id: "eleven_flash_v2_5",
    language_code: tag,
    voice_settings,
  };
  const multilingual: Record<string, unknown> = {
    text: input.text,
    model_id: "eleven_multilingual_v2",
    voice_settings,
  };
  // Kalite sirasi (TUM diller): v3 duygu etiketlerini gercekten oynar;
  // dusemezse multilingual_v2 (stil/duygu en zengin), en son flash_v2_5
  // (hiz yedegi). Flash one gecince Almanca/Ingilizce anlatimlarda duygu
  // derinligi dusuyordu.
  return [v3, multilingual, flash];
}

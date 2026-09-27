/**
 * Gorsel anlati TTS: klip duygusuna gore tempo / perde / oyunculuk.
 * Sinirli sahnelerde ses sertlesir; pismanlikta yavaslar; sakin yikicida soguk kalir.
 */

import { spokenLanguageName } from "@/lib/tts-catalog";

export const TTS_MOODS = [
  "angry",
  "shock",
  "tense",
  "cold",
  "disgust",
  "smug",
  "sad",
  "triumph",
  "joy",
  "relief",
  "curious",
  "soft",
  "calm",
] as const;
export type TtsMood = (typeof TTS_MOODS)[number];

export interface TtsPerformance {
  mood: TtsMood;
  speedDelta: number;
  pitchDelta: number;
  volume: number;
  instruction: string;
  azureStyle: string;
  elevenStyle: number;
  elevenStability: number;
  /** ElevenLabs v3 duygu etiketleri — metnin basina eklenir (or. [angry], [crying]). */
  elevenV3Tags: string[];
}

/**
 * Duygu etiketleri hikaye/beat ureticisinden hem Turkce harfli ("öfke", "şok")
 * hem harfsiz ("ofke", "sok") geliyor. Her kalibi iki kez yazmak yerine metin
 * once sadelestirilir; boylece "iğrenme" ile "igrenme" ayni kalibi vurur.
 */
export function foldTurkish(value: string): string {
  return value
    .toLowerCase()
    // "İ".toLowerCase() = "i" + birlesik nokta; NFKD ile ayirip isaretleri
    // atmak ş/ğ/ü/ö/ç/â dahil hepsini tek adimda sadelestirir.
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

// "kin" kelime siniriyla aranir: "piskin" / "yakinlasma" ofke sayilmasin.
const ANGRY_RE =
  /ofke|sinir|sert|ezme|tokat|bagir|hayki|kapiyi carp|kovdum|defol|yeter|nasil cesaret|fiziksel ustunluk|\bkin(?:i|le|den|dir|iyle)?\b|hakaret|kufur|ofke patlama|patlama esigi|hiddet|azarla|angry|furious|get out|how dare|rage|wut|ohrfeige|schrei|raus hier/;
// "etki sonrasi tepki (goz kirilmasi)" tek basina 43 klip: darbenin yuze
// dustugu an. Nefes tutulur, ses incelir — duz anlatim burada oluyordu.
const SHOCK_RE =
  /\bsok\b|soku|soklan|mikro-?sok|dehset|panik|sarsinti|sarsil|saskin|nefes kesil|dudak aralan|yakalanmis|yakalanma|donup kal|inanamama|delil ani|etki sonrasi|tepki|goz kiril|shock|stunned|panic|gasp|schock|erstarrt|erwischt/;
const TENSE_RE =
  /gergin|gerilim|tehdit|suphe|korku|baski|tetikte|tedirgin|endise|kaygi|huzursuz|dikkatli gerilim|yuksek dikkat|aciliyet|telas|tense|threat|caught|afraid|uneasy|urgen/;
const COLD_RE =
  /sakin yikici|kararlilik|soguk|numb|bitti netligi|imza|hesap sorma|status donusu|statu donusu|sessiz dayanma|karar netligi|buz|mesafe|divorce|it's over|its over|cold calm|detached|entschlossenheit|scheidung|kalte/;
const DISGUST_RE =
  /igrenme|igren|asagilanma|asagilama|kucumseme|kucult|tiksin|utanc|rezalet|lekelen|hor gor|disgust|contempt|humiliat|ekel|veracht|demuetigung|demütigung|scham/;
const SMUG_RE =
  /piskin|pismis edepsiz|hakimiyet|meydan okuma|alay|kibir|ustunluk bakisi|tepeden|sirit|zehirli gulus|smug|smirk|mocking|sarcas/;
const SAD_RE =
  /pisman|yalvar|huzun|kirik|kirilma|agla|hickir|gozyas|caresiz|uzul|uzgun|yara|hayal kirikligi|yalnizlik|bogulma|darbe|ikilem|acisi|\baci\b|regret|please don't|i'm sorry|im sorry|grief|sorrow|reue|flehen/;
const TRIUMPH_RE =
  /zafer|gulus|statu zaferi|status zaferi|ustun|ustunlugu|donus|yeni ask|intikam ustunlugu|tatmin|kazanma|ozguven|ozdenetimli guven|kontrollu guven|victory|triumph|new love|confident/;
const JOY_RE =
  /sevinc|cosku|kutlama|minnet|gurur|mutlu|nese|neseli|bayram|sicacik|heyecan|joy|happy|celebrat|grateful|proud/;
const RELIEF_RE =
  /rahatlama|rahatlam|ferah|toparlan|huzur|guven tazele|nefeslen|derin nefes|yatism|sakinlesme|relief|relax|calmer|settle/;
const CURIOUS_RE =
  /merak|kesif|ogrenme|ogretici|dikkat|ilgi|umit|umut|beklenti|\bsoru\b|sorusu|hazirlik|odak|iyimser|curious|wonder|hope|discover|focus/;
const SOFT_RE =
  /flashback|yakinlasma|hasret|sicak|nazik|sefkat|yumusak|samimi|memory|softer|tender|intimate/;

/**
 * "soguk kin", "sakin ofke" gibi etiketlerde sertlik degil BASTIRILMIS sertlik
 * istenir; bu birlesim ofke kalibini vurmadan once soguk profile gider.
 * "donuk ofke" bilincli olarak disarida: o hala patlamali okunur.
 */
const COLD_HEAT_RE = /\b(soguk|sakin|sessiz|buz)\b[^|]{0,24}\b(kin|ofke|intikam|hesap)\b/;

type MoodProfile = Omit<TtsPerformance, "mood" | "instruction" | "elevenV3Tags"> & {
  instructionTail: string;
  /** v3 modelinde metin basina eklenen duygu etiketi. */
  elevenV3Tag: string;
};

const PROFILES: Record<TtsMood, MoodProfile> = {
  angry: {
    speedDelta: 0.08,
    pitchDelta: 1,
    volume: 1.16,
    instructionTail:
      "This beat is ANGRY and sharp: clipped consonants, harder attack, controlled fury — not shouting chaos. Stress the cutting words. Keep it cinematic, adult, tense.",
    azureStyle: "angry",
    elevenStyle: 0.62,
    elevenStability: 0.28,
    elevenV3Tag: "[angry]",
  },
  shock: {
    speedDelta: -0.02,
    pitchDelta: 1,
    volume: 1.04,
    instructionTail:
      "This beat is a SHOCK hit: the breath catches on the first words, a short stall, then the sentence comes out thinner and higher than usual. Do not narrate it calmly.",
    azureStyle: "terrified",
    elevenStyle: 0.55,
    elevenStability: 0.3,
    elevenV3Tag: "[gasps]",
  },
  tense: {
    speedDelta: 0.04,
    pitchDelta: 0,
    volume: 1.06,
    instructionTail:
      "Tight, uneasy, slightly rushed. Hold breath before the reveal. Do not sound cheerful or documentary-calm.",
    azureStyle: "serious",
    elevenStyle: 0.4,
    elevenStability: 0.38,
    elevenV3Tag: "[nervously]",
  },
  cold: {
    speedDelta: -0.03,
    pitchDelta: -1,
    volume: 1.02,
    instructionTail:
      "Cold, quiet, destructive calm. Lower energy than anger. The decision is already made. No tears, no scream.",
    azureStyle: "serious",
    elevenStyle: 0.22,
    elevenStability: 0.55,
    elevenV3Tag: "[coldly]",
  },
  disgust: {
    speedDelta: -0.02,
    pitchDelta: -1,
    volume: 1.05,
    instructionTail:
      "Contempt and disgust: the words are pushed away, lip-curl in the tone, weight on the insulting detail. Low and hard, not loud.",
    azureStyle: "disgruntled",
    elevenStyle: 0.5,
    elevenStability: 0.3,
    elevenV3Tag: "[disgusted]",
  },
  smug: {
    speedDelta: -0.01,
    pitchDelta: 0,
    volume: 1.02,
    instructionTail:
      "Smug superiority: a smile sits inside the voice, unhurried, slightly mocking. Enjoy the other person's loss without raising volume.",
    azureStyle: "unfriendly",
    elevenStyle: 0.52,
    elevenStability: 0.34,
    elevenV3Tag: "[sarcastic]",
  },
  sad: {
    speedDelta: -0.07,
    pitchDelta: -1,
    volume: 0.96,
    instructionTail: "Heavy, regretful, quieter. Slightly slower. Do not wail; keep dignity.",
    azureStyle: "sad",
    elevenStyle: 0.28,
    elevenStability: 0.5,
    elevenV3Tag: "[sad]",
  },
  triumph: {
    speedDelta: 0.03,
    pitchDelta: 1,
    volume: 1.08,
    instructionTail: "Controlled victory, cool smile in the voice. Confident, not cartoon-happy.",
    azureStyle: "cheerful",
    elevenStyle: 0.45,
    elevenStability: 0.4,
    elevenV3Tag: "[confident]",
  },
  joy: {
    speedDelta: 0.04,
    pitchDelta: 1,
    volume: 1.08,
    instructionTail:
      "Real warm joy: brighter, lifted ending on the sentences, a breath of laughter under the words. Not an advert voice.",
    azureStyle: "cheerful",
    elevenStyle: 0.5,
    elevenStability: 0.34,
    elevenV3Tag: "[excited]",
  },
  relief: {
    speedDelta: -0.03,
    pitchDelta: 0,
    volume: 1,
    instructionTail:
      "Relief after pressure: the shoulders drop, one long breath first, then softer and slower. The danger is over.",
    azureStyle: "gentle",
    elevenStyle: 0.26,
    elevenStability: 0.5,
    elevenV3Tag: "[sighs]",
  },
  curious: {
    speedDelta: 0.02,
    pitchDelta: 0,
    volume: 1.02,
    instructionTail:
      "Curiosity and focus: leaning-in tone, questions really rise at the end, small pause before the discovery.",
    azureStyle: "friendly",
    elevenStyle: 0.34,
    elevenStability: 0.42,
    elevenV3Tag: "[curious]",
  },
  soft: {
    speedDelta: -0.04,
    pitchDelta: 0,
    volume: 0.98,
    instructionTail: "Softer memory tone, intimate but not whisper-ASMR. Warm and close.",
    azureStyle: "",
    elevenStyle: 0.2,
    elevenStability: 0.52,
    elevenV3Tag: "[softly]",
  },
  calm: {
    speedDelta: 0,
    pitchDelta: 0,
    volume: 1,
    instructionTail: "Natural, clear, cinematic. Follow the emotion of the sentences without going flat.",
    azureStyle: "",
    elevenStyle: 0.18,
    elevenStability: 0.48,
    elevenV3Tag: "",
  },
};

/** Metindeki fiziksel isaretlerden ek v3 etiketi (bagirma/aglama/fisilti). */
const SHOUT_RE = /bagir|hayki|shout|scream|yeter\s*artik|defol|cik dısarı|cik disari/;
const CRY_RE = /agla|hickir|gozyas|sobbing|crying|tears/;
const WHISPER_RE = /fisilda|fisilti|whisper|kulagina/;

export function elevenV3TagsFor(mood: TtsMood, text = ""): string[] {
  const tags: string[] = [];
  const base = PROFILES[mood].elevenV3Tag;
  const folded = foldTurkish(text);
  if (SHOUT_RE.test(folded)) tags.push("[shouts]");
  else if (CRY_RE.test(folded)) tags.push("[crying]");
  else if (WHISPER_RE.test(folded)) tags.push("[whispers]");
  if (base && !tags.includes(base) && tags.length === 0) tags.push(base);
  else if (base && tags.length > 0 && mood === "angry" && !tags.includes("[angry]")) tags.unshift("[angry]");
  return tags.slice(0, 2);
}

/** Cumle ici sertlik: soru, unlem, kisa emir cumlesi kendi vurgusunu alir. */
const EXCLAIM_RE = /[!]\s*$/;
const QUESTION_RE = /[?]\s*$/;

/**
 * ElevenLabs v3 metni: duygu etiketi TUM klibin basina bir kez degil, DEGISEN
 * her cumlenin basina konur. Boylece 15 saniyelik bir karede sert cumle sert,
 * sonraki sakin cumle sakin okunur — "hikayenin akisina gore ses".
 *
 * Ayni etiket ust uste tekrar edilmez; v3 tekrarlarda abartili oynuyor.
 */
export function elevenV3Text(text: string, mood: TtsMood): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  const base = PROFILES[mood].elevenV3Tag;
  const sentences = clean.match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  if (sentences.length === 0) return clean;

  let lastTag = "";
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i];
    const folded = foldTurkish(sentence);
    let tag = "";
    if (SHOUT_RE.test(folded) || (EXCLAIM_RE.test(sentence) && (mood === "angry" || mood === "shock"))) {
      tag = "[shouts]";
    } else if (CRY_RE.test(folded)) {
      tag = "[crying]";
    } else if (WHISPER_RE.test(folded)) {
      tag = "[whispers]";
    } else if (QUESTION_RE.test(sentence) && (mood === "curious" || mood === "shock")) {
      tag = mood === "shock" ? "[gasps]" : "[curious]";
    } else if (i === 0) {
      tag = base;
    }
    if (tag && tag === lastTag) tag = "";
    if (tag) lastTag = tag;
    out.push(tag ? `${tag} ${sentence}` : sentence);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function instructionFor(language: string | undefined, tail: string): string {
  return `Speak in ${spokenLanguageName(language)} as a first-person narrator. ${tail}`;
}

function toPerformance(mood: TtsMood, language?: string, text?: string): TtsPerformance {
  const profile = PROFILES[mood];
  return {
    mood,
    speedDelta: profile.speedDelta,
    pitchDelta: profile.pitchDelta,
    volume: profile.volume,
    instruction: instructionFor(language, profile.instructionTail),
    azureStyle: profile.azureStyle,
    elevenStyle: profile.elevenStyle,
    elevenStability: profile.elevenStability,
    elevenV3Tags: elevenV3TagsFor(mood, text || ""),
  };
}

/**
 * Etiket sozlugu genis: hikaye ureticisi "etki sonrasi tepki", "donuk
 * asagilanma", "piskin hakimiyet", "kin", "mikro-sok" gibi onlarca farkli
 * ifade uretiyor. Eskiden bunlarin %40'i "calm"a dusuyordu, yani anlatim
 * duzlesiyordu; artik her biri bir oyunculuk profiline baglanir.
 */
export function resolveTtsMood(emotion = "", text = ""): TtsMood {
  const blob = foldTurkish(`${emotion} ${text}`);
  if (!blob) return "calm";
  // "sakin yikici", "soguk kin": sertlik bastirilmis okunur.
  if (COLD_HEAT_RE.test(blob) || /sakin yikici/.test(blob)) return "cold";
  if (ANGRY_RE.test(blob)) return "angry";
  if (SHOCK_RE.test(blob)) return "shock";
  if (SAD_RE.test(blob)) return "sad";
  if (DISGUST_RE.test(blob)) return "disgust";
  if (SMUG_RE.test(blob)) return "smug";
  if (TRIUMPH_RE.test(blob)) return "triumph";
  if (COLD_RE.test(blob)) return "cold";
  if (TENSE_RE.test(blob)) return "tense";
  // "heyecanli merak" sevinc degil merak: merak/kesif varsa o oncelikli.
  if (JOY_RE.test(blob) && !/merak|kesif|ogren/.test(blob)) return "joy";
  if (RELIEF_RE.test(blob)) return "relief";
  if (CURIOUS_RE.test(blob)) return "curious";
  if (JOY_RE.test(blob)) return "joy";
  if (SOFT_RE.test(blob)) return "soft";
  return "calm";
}

/**
 * Flow / Veo klipleri sesi videoyla birlikte uretir; TTS ayarlari oraya
 * gecmez. Ayni duygu haritasi bu kez SES YONETMENI notu olarak prompta girer.
 */
export function flowVoiceDirection(emotion?: string | null, voiceTone?: string | null): string {
  const label = [emotion || "", voiceTone || ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!label) return "";
  const mood = resolveTtsMood(label, "");
  if (mood === "calm") return "";
  return `VOCAL DELIVERY (${mood.toUpperCase()}): ${PROFILES[mood].instructionTail}`;
}

export function ttsPerformanceFor(input: {
  emotion?: string | null;
  text?: string | null;
  /** Ses yonetmeni notu (clip.voiceTone) — duygu cozumune katilir. */
  voiceTone?: string | null;
  enabled?: boolean;
  language?: string | null;
}): TtsPerformance {
  if (input.enabled === false) {
    return toPerformance("calm", input.language || undefined, input.text || "");
  }
  const emotionBlob = [input.emotion || "", input.voiceTone || ""].filter(Boolean).join(" ");
  const mood = resolveTtsMood(emotionBlob, input.text || "");
  return toPerformance(mood, input.language || undefined, input.text || "");
}

export function applyTtsPerformance(
  baseSpeed: number,
  basePitch: number,
  performance: TtsPerformance
): { speed: number; pitchSemitones: number } {
  const speed = Math.min(1.3, Math.max(0.7, Math.round((baseSpeed + performance.speedDelta) * 100) / 100));
  const pitchSemitones = Math.min(6, Math.max(-6, Math.round(basePitch + performance.pitchDelta)));
  return { speed, pitchSemitones };
}

export function isGoogleGeminiVoice(name: string): boolean {
  return name.startsWith("gemini:");
}

export function googleGeminiSpeaker(name: string): string {
  return name.replace(/^gemini:/, "").trim();
}

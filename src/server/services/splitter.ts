/**
 * Hikayeyi dogal cumle sinirlarinda kliplere bolen algoritma.
 *
 * Kurallar:
 * - Cumleler ortadan bolunmez (asiri uzun cumleler dogal duraklarda — virgul vb. — bolunur)
 * - Secilen klip suresi ve konusma hizina gore hedef kelime sayisi hesaplanir
 * - Klip butcesini asacak metin sonraki klibe tasinir
 * - Cok kisa kalan son parca onceki parcayla birlestirilir
 * - Kesim noktalari mumkun oldugunca "kanca" cumlelerinin hemen sonrasina hizalanir
 *   (Merak Mimarisi: her klip "devamini izle" etkisiyle bitmeli)
 */

export interface SplitOptions {
  clipSeconds: number;
  wpm: number;
  /** Konusma / klip orani. 1 = sahne suresinin tamamini doldur; biraz nefes icin 0.95-0.98. */
  safetyRatio?: number;
}

export interface ClipDraft {
  index: number;
  dialogue: string;
  estimatedWords: number;
  estimatedDurationSeconds: number;
  hasHook: boolean;
  curiosityScore: number;
}

/** 8 sn sahnede 3-5 sn konusma olmasin: hedef, klip suresinin neredeyse tamami. */
const DEFAULT_SAFETY_RATIO = 0.97;

/** Konusma metninin klip suresine orantili dolmasi (son ~0.2 sn nefes). */
export const SPEECH_FILL_RATIO = 1;

/** Alt sinir: max butcenin bu orani (8 sn'de ~3-5 sn'lik kisa satir YASAK). */
export const MIN_SPEECH_FILL_RATIO = 0.88;

/** Sinema anlatici: 10 sn sahne. Veo erken bitirmesin diye 8 sn'lik kisa satirdan biraz daha kelime. */
export const NARRATOR_SPEECH_FILL_RATIO = 1.12;

/** Sablon turune gore konusma/klip doluluk orani. */
export function speechFillRatioFor(templateType: string | null | undefined): number {
  if (templateType === "narrator" || templateType === "time_travel" || templateType === "kids_animation") {
    return NARRATOR_SPEECH_FILL_RATIO;
  }
  return SPEECH_FILL_RATIO;
}

/** Klip suresi + WPM'e gore maksimum kelime butcesi. */
export function maxWordsForClipSeconds(clipSeconds: number, wpm: number, fillRatio = SPEECH_FILL_RATIO): number {
  const seconds = Math.max(2, clipSeconds || 8);
  const pace = Math.max(40, wpm || 100);
  return Math.max(8, Math.floor((seconds * fillRatio * pace) / 60));
}

/** Klip suresine orantili konusma icin minimum kelime (3-5 sn'lik kisa satir olmasin). */
export function minWordsForClipSeconds(clipSeconds: number, wpm: number, fillRatio = SPEECH_FILL_RATIO): number {
  const max = maxWordsForClipSeconds(clipSeconds, wpm, fillRatio);
  return Math.max(8, Math.floor(max * MIN_SPEECH_FILL_RATIO));
}

/**
 * Metni kelime butcesine sigdirir.
 * Mumkunse cumle sonu noktalama icinde keser; aksi halde butce sonunda nokta ekler.
 */
export function fitTextToMaxWords(text: string, maxWords: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return cleaned;

  let cut = maxWords;
  // Yalnizca butcenin son ~%25'inde cumle sonu ara; erken kesip klibi bosaltma.
  const floor = Math.max(3, Math.floor(maxWords * 0.75));
  for (let i = maxWords - 1; i >= floor; i--) {
    if (/[.!?;…]$/.test(words[i]) || /[.!?;…]["”']$/.test(words[i])) {
      cut = i + 1;
      break;
    }
  }
  let out = words.slice(0, cut).join(" ");
  if (!/[.!?…]$/.test(out) && !/[.!?…]["”']$/.test(out)) {
    out = out.replace(/[,:;]+$/, "") + ".";
  }
  return out;
}

/** Cumle sonu olarak sayilmayacak yaygin kisaltmalar. */
const ABBREVIATIONS = new Set(["dr", "prof", "doc", "vb", "vs", "or", "bkz", "sn", "no", "mr", "mrs", "ms", "st"]);

/** Metni cumlelere ayirir; noktalama korunur. */
export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences: string[] = [];
  let current = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    current += ch;
    if (ch === "." || ch === "!" || ch === "?" || ch === "…") {
      // "..." dizisini tek sonlandirici olarak topla
      while (i + 1 < normalized.length && (normalized[i + 1] === "." || normalized[i + 1] === "!" || normalized[i + 1] === "?")) {
        current += normalized[i + 1];
        i++;
      }
      const next = normalized[i + 1];
      // Ondalik sayi (3.5) veya kisaltma (Dr.) ise bolme
      const prevChar = normalized[i - 1];
      const isDecimal = ch === "." && prevChar >= "0" && prevChar <= "9" && next !== undefined && next >= "0" && next <= "9";
      const lastWord = current
        .slice(0, -1)
        .split(/\s+/)
        .pop()
        ?.toLowerCase()
        .replace(/[^a-zçğıöşü]/g, "");
      const isAbbrev = ch === "." && !!lastWord && ABBREVIATIONS.has(lastWord);
      const nextIsSpace = next === " " || next === undefined;
      if (!isDecimal && !isAbbrev && nextIsSpace) {
        sentences.push(current.trim());
        current = "";
        // sonraki boslugu atla
        if (next === " ") i++;
      }
    }
  }
  if (current.trim()) sentences.push(current.trim());
  return sentences;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Kanca sinyali: soru, uc nokta, gerilim baglaclariyla biten ya da merak kaliplari iceren cumle. */
export function detectHook(sentence: string): { hasHook: boolean; score: number } {
  const s = sentence.trim().toLowerCase();
  let score = 0;
  if (/\?$/.test(s)) score += 4;
  if (/(\.\.\.|…)$/.test(s)) score += 4;
  const hookPhrases = [
    "ama ",
    "fakat ",
    "birden",
    "aniden",
    "o an",
    "iste o zaman",
    "asla unutmayacagim",
    "asla unutamayacağım",
    "kimse bilmiyordu",
    "hic beklemiyordum",
    "hiç beklemiyordum",
    "gördüğüm şey",
    "gordugum sey",
    "sonra ne oldu",
    "isin garibi",
    "işin garibi",
    "en tuhaf",
    "gerçek ortaya",
    "gercek ortaya",
    "bir sır",
    "bir sir",
    "acaba",
    "sürpriz",
    "surpriz",
  ];
  for (const phrase of hookPhrases) {
    if (s.includes(phrase)) score += 2;
  }
  if (/(sey|şey|olay|ses|golge|gölge|kapi|kapı|mektup|numara|sifre|şifre)\b.*(vardi|vardı|duydum|gordum|gördüm|buldum)/.test(s)) {
    score += 1;
  }
  score = Math.min(10, score);
  return { hasHook: score >= 3, score };
}

/** Asiri uzun tek cumleyi dogal duraklarda (virgul, noktali virgul, tire) parcalara ayirir. */
function splitLongSentence(sentence: string, maxWords: number): string[] {
  if (countWords(sentence) <= maxWords) return [sentence];
  const parts = sentence.split(/(?<=[,;:—])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    const candidate = current ? `${current} ${part}` : part;
    if (countWords(candidate) > maxWords && current) {
      chunks.push(current.trim());
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  // Virgul de yoksa ve hala cok uzunsa kelime sinirlarindan zorunlu bol
  const result: string[] = [];
  for (const chunk of chunks) {
    if (countWords(chunk) <= maxWords) {
      result.push(chunk);
      continue;
    }
    const words = chunk.split(/\s+/);
    for (let i = 0; i < words.length; i += maxWords) {
      result.push(words.slice(i, i + maxWords).join(" "));
    }
  }
  return result;
}

/**
 * Hikayeyi klip taslaklarina boler.
 */
export function splitStoryIntoClips(fullStory: string, options: SplitOptions): ClipDraft[] {
  const safetyRatio = options.safetyRatio ?? DEFAULT_SAFETY_RATIO;
  const budgetSeconds = options.clipSeconds * safetyRatio;
  const targetWords = Math.max(8, Math.floor((budgetSeconds / 60) * options.wpm));
  const minWords = Math.max(8, Math.floor(targetWords * MIN_SPEECH_FILL_RATIO));

  const sentences = splitIntoSentences(fullStory).flatMap((s) => splitLongSentence(s, targetWords));
  if (sentences.length === 0) return [];

  interface Piece {
    text: string;
    words: number;
    hook: { hasHook: boolean; score: number };
  }
  const pieces: Piece[] = sentences.map((s) => ({ text: s, words: countWords(s), hook: detectHook(s) }));

  const clips: string[][] = [];
  let current: Piece[] = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length > 0) {
      clips.push(current.map((p) => p.text));
      current = [];
      currentWords = 0;
    }
  };

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const wouldBe = currentWords + piece.words;

    if (wouldBe > targetWords && current.length > 0) {
      // Kanca hizalamasi: mevcut klibin son cumlesi kanca ise burada kes.
      // Degilse ve bu cumle kanca ise, siginmasi kosuluyla (%15 tolerans) klibe dahil edip sonra kes.
      const tolerance = Math.floor(targetWords * 1.15);
      if (!current[current.length - 1].hook.hasHook && piece.hook.hasHook && wouldBe <= tolerance) {
        current.push(piece);
        flush();
        continue;
      }
      flush();
    }
    current.push(piece);
    currentWords += piece.words;

    // Hedefe YAKINSA ve son cumle kanca ise kes — erken (%80) kesim 3-5 sn'lik bos klip uretir
    if (currentWords >= targetWords * 0.94 && piece.hook.hasHook) {
      flush();
    }
  }
  flush();

  // Cok kisa klipleri (3-5 sn konusma) oncekiyle birlestir; tavan ~%20 tasmasin
  const mergeCeiling = Math.max(targetWords + 2, Math.floor(targetWords * 1.2));
  for (let i = clips.length - 1; i >= 1; i--) {
    const words = countWords(clips[i].join(" "));
    if (words >= minWords) continue;
    const mergedWords = countWords([...clips[i - 1], ...clips[i]].join(" "));
    if (mergedWords <= mergeCeiling || words < Math.max(4, Math.floor(minWords * 0.45))) {
      clips[i - 1].push(...clips[i]);
      clips.splice(i, 1);
    }
  }

  return clips.map((sentenceGroup, i) => {
    const dialogue = sentenceGroup.join(" ");
    const words = countWords(dialogue);
    const lastSentence = sentenceGroup[sentenceGroup.length - 1] ?? "";
    const hook = detectHook(lastSentence);
    return {
      index: i + 1,
      dialogue,
      estimatedWords: words,
      estimatedDurationSeconds: Number(((words / options.wpm) * 60).toFixed(1)),
      hasHook: hook.hasHook,
      curiosityScore: hook.score,
    };
  });
}

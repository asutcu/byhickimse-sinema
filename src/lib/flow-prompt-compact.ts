/**
 * Flow'a yazilacak prompt kisaltmasi.
 * Dil + diyalog + ekran-yazi yasagi ASLA dusmez (9:16 ve 16:9).
 */

import { prepareLiveActionFlowPrompt, sanitizeCelebrityLikenessForFlow } from "@/lib/flow-prompt-safety";

export const FLOW_HARD_CHAR_LIMIT = 8_000;
/** Flow'a yazarken guvenli ust sinir (hard 8000'in altinda pay birakilir). */
export const FLOW_PROMPT_MAX = 7_800;

/**
 * Flow kutusu hard limitini asmasin — her yazma yolunda son guvenlik agi.
 * Bas (@ref / diyalog) korunur; fazla sondan kirpilir.
 */
export function clampPromptForFlowBox(prompt: string, maxChars = FLOW_PROMPT_MAX): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const hard = Math.min(maxChars, FLOW_HARD_CHAR_LIMIT - 1);
  return trimmed.slice(0, hard).trim();
}

/**
 * SABIT KURAL: kullanici gomulu altyazi istemediyse ekranda hic yazi olmaz.
 * Klip 1 ile klip 1000 ayni metni alir — kisaltma / ozel sablon bu damgayi dusuremez.
 */
export const FLOW_NO_ONSCREEN_TEXT_HEAD = [
  "[SABIT KURAL — ALTYAZI YOK]",
  "[NO ON-SCREEN TEXT — HARD]",
  "[NO ON-SCREEN TEXT — NON-NEGOTIABLE]",
  "This exact rule is identical on EVERY clip of this film — clip 1 and clip 1000 get the same ban.",
  "This ban applies to every clip of this film equally — first scene through last scene.",
  "The user did not request burned-in subtitles. Do not invent captions.",
  "Zero letters in the picture for the entire clip — 9:16 and 16:9. Audio only; clean cinematic plate.",
  "Forbidden: subtitles, captions, karaoke, titles, clothing tags, chalkboard letters, signs, posters, watermarks, UI, English auto-captions, any language.",
].join(" ");

export const FLOW_NO_ONSCREEN_TEXT_TAIL = [
  "[SABIT KURAL SONU — ALTYAZI YOK]",
  "[FINAL HARD LOCK — ON-SCREEN TEXT]",
  "FINAL CHECK: zero subtitles, zero captions, zero karaoke, zero written words anywhere in the frame, any language.",
  "Same rule as clip 1. Reject burned-in text. Picture only.",
].join(" ");

const HEAD_MARKERS = /\[SABIT KURAL — ALTYAZI YOK\]/i;
const TAIL_MARKER_RE = /\[(?:SABIT KURAL SONU — ALTYAZI YOK|FINAL HARD LOCK[^\]]*)\]/i;

function joinBlocks(parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Gomulu kuyruk damgasini siler ama SONRAKI bolumleri yemez.
 * Eski regex `[\s\S]*$` ilk kuyruktan string sonuna kadar her seyi (AUDIO / diyalog) siliyordu.
 */
export function stripEmbeddedOnscreenTextTails(prompt: string): string {
  let next = prompt.split(FLOW_NO_ONSCREEN_TEXT_TAIL).join("");
  next = next.replace(
    /\n*\[(?:SABIT KURAL SONU — ALTYAZI YOK|FINAL HARD LOCK[^\]]*)\][^\[]*(?=\n\[|$)/gi,
    ""
  );
  return next.replace(/\n{3,}/g, "\n\n").trim();
}

/** Govdeyi keser ama kuyruk kilidini her zaman sona yapistirir. Bas tarafi (diyalog) korunur. */
function packWithReservedTail(body: string, tail: string, maxChars: number): string {
  const tailBlock = `\n\n${tail}`;
  const budget = Math.max(80, maxChars - tailBlock.length);
  const trimmed = body.trim().slice(0, budget).trim();
  return `${trimmed}${tailBlock}`.slice(0, maxChars);
}

/** Bas (diyalog + kilitler) ASLA kesilmez; fazla uzunluk ortadan/sondan dusar. */
function packHeadMidTail(head: string, mid: string, tail: string, maxChars: number): string {
  const headBlock = head.trim();
  const tailBlock = `\n\n${tail}`;
  const budget = Math.max(0, maxChars - headBlock.length - tailBlock.length - 2);
  const midTrim = mid.trim().slice(0, budget).trim();
  const packed = `${headBlock}${midTrim ? `\n\n${midTrim}` : ""}${tailBlock}`;
  if (packed.length <= maxChars) return packed;
  // Head + kuyruk max'i astiysa kuyrugu koru, headi kisalt (nadir).
  const headBudget = Math.max(40, maxChars - tailBlock.length);
  return `${headBlock.slice(0, headBudget).trim()}${tailBlock}`.slice(0, maxChars);
}

/**
 * Prompttaki tirnakli konusma satirini bulur.
 * Sablon "says exactly" / [AUDIO] / [SPOKEN LINE] / hikaye kilidi sirasi.
 */
export function extractSpokenQuote(full: string): string {
  const patterns = [
    /\[SPOKEN LINE[^\]]*\][\s\S]{0,500}?"([^"]{4,500})"/i,
    /says exactly[^\n"]{0,120}:\s*\n*"([^"]{4,500})"/i,
    /voice-over says exactly[^\n"]{0,80}:\s*\n*"([^"]{4,500})"/i,
    /SINGS[^\n"]{0,80}:\s*"([^"]{4,500})"/i,
    /\[AUDIO(?: AND SPEECH)?\][\s\S]{0,2500}?"([^"]{4,500})"/i,
    /Spoken story line \(verbatim intent\):\s*"([^"]{4,500})"/i,
    /Spoken line \(audio, never subtitle\):\s*"([^"]{4,500})"/i,
    /The spoken line is AUDIO[^\n"]{0,80}:\s*"([^"]{4,500})"/i,
    /^\s*"([^"\n]{4,500})"\s*$/m,
  ];
  for (const re of patterns) {
    const hit = full.match(re)?.[1]?.replace(/\s+/g, " ").trim();
    if (hit) return hit;
  }
  return "";
}

function spokenLinePriorityBlock(quote: string, lang: string): string {
  const q = quote.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!q) return "";
  return [
    "[SPOKEN LINE — AUDIO FIRST — DO NOT DROP]",
    `Deliver this exact ${lang} line as the audible vocal (speak or narrate as the rest of the prompt requires). Word for word. No English unless ${lang} is English. Fill the full clip.`,
    `"${q}"`,
  ].join("\n");
}

/** Tirnakli sozu @referanstan hemen sonraya tasir — Flow uzun promptun ortasini atlayabiliyor. */
function hoistSpokenLine(prompt: string, quote: string, lang: string, maxChars: number): string {
  const spoken = spokenLinePriorityBlock(quote, lang);
  if (!spoken) return prompt;
  const atRefs = (prompt.match(/^(?:@[^\n]+\n)+/) || [""])[0];
  let rest = prompt.slice(atRefs.length).replace(/^\n+/, "");
  rest = rest.replace(/\[SPOKEN LINE[^\]]*\][\s\S]*?(?=\n\[(?!SPOKEN LINE)|$)/i, "").trim();
  const assembled = joinBlocks([atRefs.trim(), spoken, rest]);
  return packWithReservedTail(stripEmbeddedOnscreenTextTails(assembled), FLOW_NO_ONSCREEN_TEXT_TAIL, maxChars);
}

function extractBracketBlock(body: string, tagName: string): string {
  const re = new RegExp(`\\[${tagName}[^\\]]*\\][\\s\\S]*?(?=\\n\\[|$)`, "i");
  return body.match(re)?.[0]?.trim() || "";
}

export function isStillImagePrompt(prompt: string): boolean {
  return /\[STILL BEAT\]/i.test(prompt);
}

function isAnimatedMascotPrompt(prompt: string): boolean {
  return /\[CAST LOCK — ANIMATED MASCOT\]/i.test(prompt);
}

function isAnimatedFilmPrompt(prompt: string): boolean {
  return isAnimatedMascotPrompt(prompt) || /\[CAST LOCK — ANIMATED FILM\]/i.test(prompt);
}

/** Unlu süzgeci + kadro kilidi yalnizca canli cekim / slayt; cizgi filme etek kilidi basma. */
function shouldPrepareLiveAction(prompt: string): boolean {
  if (isAnimatedFilmPrompt(prompt)) return false;
  // Yuzsuz kademe: STORY CAST / GENDER geri yazilmasin.
  if (/\[FACELESS STAGING/i.test(prompt)) return false;
  return (
    isStillImagePrompt(prompt) ||
    /\[STORY CAST\]/i.test(prompt) ||
    /\[FICTIONAL ORIGINALS/i.test(prompt) ||
    /\[NETSHORT STILL\]/i.test(prompt) ||
    /\[GENDER LOCK\]/i.test(prompt) ||
    /\[WARDROBE COVER\]/i.test(prompt)
  );
}

/**
 * Flow'a yazilacak promptu kisaltir.
 * Dil + diyalog + yazi yasagi (bas+son) ASLA dusmez.
 * Gorsel anlati karesinde [STILL BEAT] / [NETSHORT STILL] diyalog kilidinden once korunur.
 * Sinemada SHOT / PERFORMANCE, fizik denemesinden (STYLE) once kalir.
 */
export function compactPromptForFlow(
  full: string,
  speechLanguage: string,
  maxChars = FLOW_PROMPT_MAX
): { text: string; truncated: boolean } {
  const pre = isAnimatedMascotPrompt(full) ? full.trim() : sanitizeCelebrityLikenessForFlow(full.trim());
  const trimmed = shouldPrepareLiveAction(pre) ? prepareLiveActionFlowPrompt(pre) : pre;
  const lang = speechLanguage.trim() || "Turkish";
  const quote = extractSpokenQuote(trimmed);
  const isStill = isStillImagePrompt(trimmed);

  if (trimmed.length <= maxChars) {
    const locked = ensureNoOnscreenTextLock(trimmed, maxChars);
    if (isStill) return { text: locked, truncated: false };
    return { text: hoistSpokenLine(locked, quote, lang, maxChars), truncated: false };
  }

  const atRefs = (trimmed.match(/^(?:@[^\n]+\n)+/) || [""])[0];
  const body = stripEmbeddedOnscreenTextTails(trimmed.slice(atRefs.length).replace(/^\n+/, ""));

  const speechLock = [
    "[SPEECH LANGUAGE LOCK — NON-NEGOTIABLE]",
    `Spoken audio MUST be ${lang} only.`,
    /turkish|t[uü]rk/i.test(lang)
      ? "All audible dialogue MUST be Turkish. English speech, English narration and English ad-libs are FORBIDDEN."
      : `Do not switch to English unless ${lang} is English.`,
    `Deliver the quoted dialogue verbatim in ${lang} — never translate.`,
  ].join(" ");

  const spoken = isStill ? "" : spokenLinePriorityBlock(quote, lang);
  const hardEmotion = extractBracketBlock(body, "HARD EMOTION");
  const stillBeat = extractBracketBlock(body, "STILL BEAT");
  const netshortStill = extractBracketBlock(body, "NETSHORT STILL");
  const storyCast =
    extractBracketBlock(body, "STORY CAST") || extractBracketBlock(body, "WARDROBE COVER");
  const animatedCast = isStill ? "" : extractBracketBlock(body, "CAST LOCK");
  const identityLock = extractBracketBlock(body, "IDENTITY LOCK");
  // Tum filmde ayni kisi/sehir/kamera: 20 dk'lik filmde de kisaltmada dusmez.
  const realityLock = extractBracketBlock(body, "REALITY LOCK");
  const genderLock = extractBracketBlock(body, "GENDER LOCK");
  // Politika son caresi: yuz yasagi dusmemeli, yoksa kademe hicbir ise yaramaz.
  const faceless = extractBracketBlock(body, "FACELESS STAGING");

  const style = extractBracketBlock(body, "STYLE");
  const shot = extractBracketBlock(body, "SHOT");
  const charRef =
    extractBracketBlock(body, "WHO IS ON SCREEN") ||
    extractBracketBlock(body, "ON-SCREEN CAST LOCK") ||
    extractBracketBlock(body, "CHARACTER REFERENCE");
  const continuity = extractBracketBlock(body, "SCENE CONTINUITY") || extractBracketBlock(body, "SCENE");
  const camera = extractBracketBlock(body, "CAMERA");
  const performance = extractBracketBlock(body, "PERFORMANCE");
  const storyWord = extractBracketBlock(body, "STORY WORD");
  const restrictions = body.match(/\[RESTRICTIONS\][\s\S]*?(?=\n\[FINAL|$)/i)?.[0] || "";
  const adventure = body.match(/\[PHYSICAL WORLD[\s\S]*?(?=\n\[)/i)?.[0] || "";
  const craft = body.match(/\[CINEMATIC CRAFT\][\s\S]*?(?=\n\[)|\[MV CRAFT\][\s\S]*?(?=\n\[)/i)?.[0] || "";
  const world = extractBracketBlock(body, "WORLD") || extractBracketBlock(body, "ENVIRONMENT");
  const background = extractBracketBlock(body, "BACKGROUND");
  const setDressing = extractBracketBlock(body, "SET DRESSING");

  const reservedHead = joinBlocks([
    atRefs.trim(),
    animatedCast,
    identityLock,
    storyCast,
    genderLock,
    stillBeat,
    // Soz her seyden once: sesin birebir dogru olmasi en kritik kural.
    spoken,
    // Politika son caresi sozun hemen ardinda: sikismada da dusmez.
    faceless,
    hardEmotion,
    // Klipler birbirinin devami: sureklilik kilidi sikismada ASLA dusmez.
    isStill ? "" : continuity,
    isStill ? "" : speechLock,
    // Soz ve sureklilikten sonra: dar butcede once onlar kalir, 7800'de hepsi sigar.
    realityLock,
    FLOW_NO_ONSCREEN_TEXT_HEAD,
  ]);
  // STYLE (fizik denemesi) sonda: 8000 asilinca sahne/etki once kalir, fizik dusar.
  const midSource = isStill
    ? joinBlocks([netshortStill, continuity, world, shot, camera, performance])
    : joinBlocks([
        shot,
        storyWord,
        charRef,
        world,
        background,
        setDressing,
        performance,
        camera,
        adventure,
        craft,
        restrictions,
        style,
      ]);
  const assembled = packHeadMidTail(reservedHead, midSource, FLOW_NO_ONSCREEN_TEXT_TAIL, maxChars);

  return { text: assembled, truncated: true };
}

/** Bas+son yazi yasagini garanti eder; kuyruk her zaman son satirdadir. */
export function ensureNoOnscreenTextLock(prompt: string, maxChars = FLOW_PROMPT_MAX): string {
  let next = stripEmbeddedOnscreenTextTails(prompt.trim());
  const atRefs = next.match(/^(?:@[^\n]+\n)+/);
  if (!HEAD_MARKERS.test(next)) {
    next = atRefs
      ? `${atRefs[0]}${FLOW_NO_ONSCREEN_TEXT_HEAD}\n\n${next.slice(atRefs[0].length).replace(/^\n+/, "")}`
      : `${FLOW_NO_ONSCREEN_TEXT_HEAD}\n\n${next}`;
  }
  if (TAIL_MARKER_RE.test(next) && !next.includes(FLOW_NO_ONSCREEN_TEXT_TAIL)) {
    next = stripEmbeddedOnscreenTextTails(next);
  }
  return packWithReservedTail(next, FLOW_NO_ONSCREEN_TEXT_TAIL, maxChars);
}

/**
 * Prompt kaydina / Flow'a gitmeden once ayni damga. 1 klip veya 1000 klip:
 * bas ve son kilit birebir ayni metindir. Kayitli prompt KESILMEZ — Flow hard
 * limiti (8000) yalnizca Flow'a yazarken compactPromptForFlow / clamp ile kesilir.
 */
export function stampNoOnscreenTextLock(prompt: string): string {
  let next = stripEmbeddedOnscreenTextTails(prompt.trim());
  const atRefs = next.match(/^(?:@[^\n]+\n)+/);
  if (!HEAD_MARKERS.test(next)) {
    next = atRefs
      ? `${atRefs[0]}${FLOW_NO_ONSCREEN_TEXT_HEAD}\n\n${next.slice(atRefs[0].length).replace(/^\n+/, "")}`
      : `${FLOW_NO_ONSCREEN_TEXT_HEAD}\n\n${next}`;
  }
  return `${next}\n\n${FLOW_NO_ONSCREEN_TEXT_TAIL}`.replace(/\n{3,}/g, "\n\n").trim();
}

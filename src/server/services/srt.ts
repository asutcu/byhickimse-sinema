/**
 * SRT altyazi uretimi.
 * Zamanlama: her klibin GERCEK suresi (ffprobe) bilinir; klip icindeki
 * cumleler kelime sayisina orantili dagitilir.
 * Standartlar: satir basina ~42 karakter, gosterim suresi 1-7 sn.
 */

export interface SrtClipInput {
  index: number;
  dialogue: string;
  durationSeconds: number;
}

export interface SrtCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

const MAX_LINE_LENGTH = 42;
const MIN_CUE_SECONDS = 1;
const MAX_CUE_SECONDS = 7;

function wrapAtLimit(text: string, limit: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > limit && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Metni en fazla iki satirli, satir basina ~42 karakterlik bloklara sarar. */
export function wrapSubtitleText(text: string): string {
  return wrapAtLimit(text, MAX_LINE_LENGTH).join("\n");
}

/**
 * Gorsel slayt / film altyazisi: en fazla 2 satir.
 * Satir limiti asilirsa karakter payi artar; sahne ortasina cikmaz.
 */
export function wrapSubtitleToFitClip(text: string, maxLines = 2): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  for (const limit of [42, 48, 54, 62]) {
    const lines = wrapAtLimit(cleaned, limit);
    if (lines.length <= maxLines) return lines.join("\n");
  }
  const lines = wrapAtLimit(cleaned, 62);
  if (lines.length <= maxLines) return lines.join("\n");
  return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(" ")].join("\n");
}

/**
 * Her gorsel klip icin TEK altyazi: baslangictan klip sonuna kadar acik kalir.
 * HD/QHD/4K ve kutu/kontur fark etmez; sure klibe sigacak kadar uzundur.
 */
export function buildClipAlignedSrtCues(clips: SrtClipInput[]): SrtCue[] {
  const cues: SrtCue[] = [];
  let cursor = 0;
  let cueNumber = 1;
  for (const clip of [...clips].sort((a, b) => a.index - b.index)) {
    const duration = Math.max(0, clip.durationSeconds);
    const text = wrapSubtitleToFitClip(clip.dialogue || "");
    if (text && duration > 0) {
      cues.push({
        index: cueNumber,
        startSeconds: cursor,
        endSeconds: cursor + duration,
        text,
      });
      cueNumber += 1;
    }
    cursor += duration;
  }
  return cues;
}

/**
 * Film altyazisi: sahne metnini 2 satırlık parçalara böler, altta tutar.
 * Klip boyunca boşluk bırakmaz; tek blok halinde sahneyi kaplamaz.
 */
export function buildFilmStyleSrtCues(clips: SrtClipInput[]): SrtCue[] {
  const cues: SrtCue[] = [];
  let clipStart = 0;
  let cueNumber = 1;
  for (const clip of [...clips].sort((a, b) => a.index - b.index)) {
    const duration = Math.max(0, clip.durationSeconds);
    const sentences = (clip.dialogue || "")
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const chunks = (sentences.length > 0 ? sentences : [clip.dialogue || ""])
      .flatMap((sentence) => chunkSentence(sentence))
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    if (chunks.length === 0 || duration <= 0) {
      clipStart += duration;
      continue;
    }
    const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).filter(Boolean).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let consumed = 0;
    chunks.forEach((chunk, index) => {
      const start = clipStart + (consumed / total) * duration;
      consumed += weights[index];
      const end = index === chunks.length - 1 ? clipStart + duration : clipStart + (consumed / total) * duration;
      cues.push({
        index: cueNumber,
        startSeconds: start,
        endSeconds: Math.max(end, start + 0.8),
        text: chunk,
      });
      cueNumber += 1;
    });
    clipStart += duration;
  }
  return cues;
}

/** Cumleyi ~2 satirlik altyazi parcalarina boler. */
function chunkSentence(sentence: string): string[] {
  const wrapped = wrapSubtitleText(sentence);
  const lines = wrapped.split("\n");
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    chunks.push(lines.slice(i, i + 2).join("\n"));
  }
  return chunks.length > 0 ? chunks : [sentence];
}

/** Kliplerden zaman damgali altyazi kuyruklari uretir. */
export function buildSrtCues(clips: SrtClipInput[]): SrtCue[] {
  const cues: SrtCue[] = [];
  let clipStart = 0;
  let cueNumber = 1;
  let lastEnd = 0;

  for (const clip of [...clips].sort((a, b) => a.index - b.index)) {
    const words = clip.dialogue.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || clip.durationSeconds <= 0) {
      clipStart += Math.max(clip.durationSeconds, 0);
      continue;
    }

    // Cumle -> parca listesi
    const sentences = clip.dialogue
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const chunks = sentences.flatMap(chunkSentence);
    const totalWords = words.length;
    const secondsPerWord = clip.durationSeconds / totalWords;

    let offset = 0;
    for (const chunk of chunks) {
      const chunkWords = chunk.split(/\s+/).filter(Boolean).length;
      // Onceki kuyrukla ortusme olmasin
      let start = Math.max(clipStart + offset, lastEnd);
      const clipEnd = clipStart + clip.durationSeconds;
      if (start >= clipEnd) start = Math.max(clipEnd - 0.2, lastEnd);
      let end = start + chunkWords * secondsPerWord;
      // Kuyruk suresini standartlara cek ama klip sinirini tasma
      end = Math.min(Math.max(end, start + MIN_CUE_SECONDS), clipEnd);
      if (end - start > MAX_CUE_SECONDS) end = start + MAX_CUE_SECONDS;
      if (end <= start) end = start + 0.5;

      cues.push({ index: cueNumber++, startSeconds: start, endSeconds: end, text: chunk.replace(/\n/g, "\n") });
      lastEnd = end;
      offset += chunkWords * secondsPerWord;
    }
    clipStart += clip.durationSeconds;
  }
  return cues;
}

function formatSrtTime(totalSeconds: number): string {
  const ms = Math.round((totalSeconds % 1) * 1000);
  const seconds = Math.floor(totalSeconds) % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms, 3)}`;
}

/** TTS cumle zaman damgalarindan SRT kuyruklari uretir. */
export function buildSrtCuesFromTimestamps(
  items: Array<{ text: string; startSeconds: number; endSeconds: number }>
): SrtCue[] {
  const cues: SrtCue[] = [];
  let cueNumber = 1;
  let lastEnd = 0;
  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;
    const chunks = chunkSentence(text);
    const span = Math.max(0.4, item.endSeconds - item.startSeconds);
    const slice = span / chunks.length;
    chunks.forEach((chunk, i) => {
      const start = Math.max(item.startSeconds + i * slice, lastEnd);
      const end = Math.max(start + Math.min(slice, MAX_CUE_SECONDS), start + 0.4);
      cues.push({
        index: cueNumber++,
        startSeconds: start,
        endSeconds: Math.min(end, item.endSeconds > start ? item.endSeconds : end),
        text: chunk,
      });
      lastEnd = cues[cues.length - 1].endSeconds;
    });
  }
  return cues;
}

/** SRT dosya icerigini uretir. */
export function buildSrtContent(cues: SrtCue[]): string {
  return cues
    .map((cue) => `${cue.index}\n${formatSrtTime(cue.startSeconds)} --> ${formatSrtTime(cue.endSeconds)}\n${cue.text}\n`)
    .join("\n");
}

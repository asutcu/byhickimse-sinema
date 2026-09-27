import fs from "node:fs";
import path from "node:path";
import {
  applyAudioFilter,
  buildPitchFilter,
  buildTempoFilter,
  concatAudioFiles,
  probeDurationSeconds,
} from "@/server/services/ffmpeg";
import { describeTtsSecrets, getSettings, resolveOpenAiKey, ttsSettingsView } from "@/server/services/settings";
import { synthesizeChunkWithProvider, type SynthesizeChunkResult } from "@/server/services/tts-providers";
import {
  elevenLabsVoice,
  isLegacyVoiceId,
  openaiFallbackVoice,
  readyPaidProviders,
  resolvePreferredTtsVoice,
  ttsProviderInfo,
  type TtsVoice,
} from "@/lib/tts-catalog";
import type { TtsPerformance } from "@/lib/tts-performance";

export interface SentenceTimestamp {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TtsRequest {
  text: string;
  /** Katalog kimligi ("google:tr-TR-Chirp3-HD-Kore") veya eski "female" / "male". */
  voiceId: string;
  speed: number;
  pitchSemitones?: number;
  outputPath: string;
  /** Projenin konusma dili; ses bununla eslesmezse dogru dile gecilir. */
  language?: string;
  /** Bos ise uygulama ayarindaki varsayilan saglayici kullanilir. */
  provider?: string;
  /** Ses degistirildiyse cagirana bildirilir (olay kaydina yazilir). */
  onVoiceResolved?: (info: { voice: TtsVoice; switched: boolean; reason: string }) => void;
  /** Sahne duygusu (gorsel anlati). */
  performance?: TtsPerformance;
  /** ElevenLabs hazirsa sahne konusmasini oradan oku. */
  preferElevenLabs?: boolean;
  /** Hikayeye gore ses secimi (ElevenLabs API). */
  storyGenre?: string;
  /** Onceden cozulmus ElevenLabs voice_id. */
  elevenLabsVoiceId?: string;
}

const TTS_CHAR_LIMIT = 4000;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitOversized(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      parts.push(current);
      current = word.length > maxChars ? word.slice(0, maxChars) : word;
    } else {
      current = next.length > maxChars ? next.slice(0, maxChars) : next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** TTS'e sahne notu / konusmaci etiketi kacmaması icin. */
export function sanitizeLongformSpeech(text: string): string {
  return text
    .replace(/^\s*\[[^\]]{0,160}\]\s*$/gm, " ")
    .replace(/\((?:sahne|kamera|gorsel|not|still|cut)[^)]{0,100}\)/gi, " ")
    .replace(/^[A-Za-zÇĞİÖŞÜçğıöşü]{2,24}:\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** OpenAI TTS 4096 karakter sinirina gore cumle birlestirir. */
export function splitTextForTts(text: string, maxChars = TTS_CHAR_LIMIT): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];
  const sentences = splitSentences(cleaned);
  const chunks: string[] = [];
  let current = "";
  const pushCurrent = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const sentence of sentences.length ? sentences : [cleaned]) {
    for (const piece of splitOversized(sentence, maxChars)) {
      const next = current ? `${current} ${piece}` : piece;
      if (next.length > maxChars && current) {
        pushCurrent();
        current = piece;
      } else {
        current = next;
      }
    }
  }
  pushCurrent();
  return chunks;
}

/** Bir ses blogunun suresini cumle kelime agirligina gore dagitir. */
export function allocateSentenceTimes(
  sentences: string[],
  startSeconds: number,
  durationSeconds: number
): SentenceTimestamp[] {
  const usable = sentences.map((s) => s.trim()).filter(Boolean);
  if (usable.length === 0 || durationSeconds <= 0) return [];
  const weights = usable.map((s) => Math.max(1, s.split(/\s+/).filter(Boolean).length));
  const total = weights.reduce((sum, n) => sum + n, 0);
  const endAt = startSeconds + durationSeconds;
  let cursor = startSeconds;
  return usable.map((text, i) => {
    const span = durationSeconds * (weights[i] / total);
    const start = cursor;
    const end = i === usable.length - 1 ? endAt : Math.min(endAt, cursor + span);
    cursor = end;
    return { text, startSeconds: start, endSeconds: Math.max(end, start + 0.35) };
  });
}

/**
 * Metni sese cevirir.
 *
 * Ses, projenin konusma diline gore cozumlenir: kayitli ses baska bir dile
 * aitse (or. Turkce anlatida Ingilizce "nova") ayni cinsiyette DOGRU DILDE bir
 * sese gecilir. Hiz/perde saglayici destekliyorsa motorda, desteklemiyorsa
 * ffmpeg ile uygulanir.
 */
export async function synthesizeSpeech(request: TtsRequest): Promise<{
  outputPath: string;
  durationSeconds: number;
  timestamps: SentenceTimestamp[];
  voice: TtsVoice;
}> {
  const chunks = splitTextForTts(request.text);
  if (chunks.length === 0) throw new Error("TTS icin metin bos");

  const settings = await getSettings();
  const view = ttsSettingsView(settings);
  const language = request.language || "Türkçe";
  const readiness = {
    ...describeTtsSecrets(settings),
    openai: !!(await resolveOpenAiKey()),
  };
  const readyProviders = readyPaidProviders(readiness);
  const provider = (request.provider || readyProviders[0] || view.ttsProvider).trim();
  const resolved =
    provider === "elevenlabs" && readiness.elevenlabs && isLegacyVoiceId(request.voiceId)
      ? { voice: elevenLabsVoice(view.elevenLabsVoiceId, language), switched: false, reason: "" }
      : resolvePreferredTtsVoice({
          voiceId: request.voiceId,
          language,
          provider,
          readyProviders,
          elevenLabsReady: readiness.elevenlabs,
          elevenLabsVoiceId: request.elevenLabsVoiceId || view.elevenLabsVoiceId,
          preferElevenLabs: request.preferElevenLabs,
        });
  let voice = resolved.voice;
  let resolveInfo = resolved;

  const dir = path.dirname(request.outputPath);
  fs.mkdirSync(dir, { recursive: true });
  const pitchSemitones = request.pitchSemitones || 0;

  const partPaths: string[] = [];
  const timestamps: SentenceTimestamp[] = [];
  let cursor = 0;
  let rateAppliedByProvider = true;
  let pitchAppliedByProvider = true;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const fileStem = `tts-part-${String(i + 1).padStart(3, "0")}`;
    let result: SynthesizeChunkResult;
    try {
      result = await synthesizeChunkWithProvider({
        voice,
        text: chunk,
        speed: request.speed,
        pitchSemitones,
        settings,
        workDir: dir,
        fileStem,
        performance: request.performance,
        language,
        storyGenre: request.storyGenre,
      });
    } catch (err) {
      if (voice.provider === "openai" || !readiness.openai) throw err;
      const fallback = openaiFallbackVoice(language, voice.gender);
      const detail = err instanceof Error ? err.message : "bilinmeyen hata";
      resolveInfo = {
        voice: fallback,
        switched: true,
        reason: `${ttsProviderInfo(voice.provider).label} calismadi; ucretli OpenAI yedegine gecildi (${fallback.label}). ${detail}`,
      };
      voice = fallback;
      result = await synthesizeChunkWithProvider({
        voice,
        text: chunk,
        speed: request.speed,
        pitchSemitones,
        settings,
        workDir: dir,
        fileStem: `${fileStem}-oa`,
        performance: request.performance,
        language,
        storyGenre: request.storyGenre,
      });
    }
    if (!result.rateApplied) rateAppliedByProvider = false;
    if (!result.pitchApplied) pitchAppliedByProvider = false;
    const duration = await probeDurationSeconds(result.wavPath);
    timestamps.push(...allocateSentenceTimes(splitSentences(chunk), cursor, duration));
    cursor += duration;
    partPaths.push(result.wavPath);
  }

  // Saglayicinin uygulamadigi ayarlar ffmpeg ile tamamlanir.
  const volume = request.performance && request.performance.volume !== 1
    ? `volume=${Math.min(1.4, Math.max(0.7, request.performance.volume))}`
    : "";
  const filters = [
    rateAppliedByProvider ? "" : buildTempoFilter(request.speed),
    pitchSemitones && !pitchAppliedByProvider ? buildPitchFilter(pitchSemitones) : "",
    volume,
  ]
    .filter(Boolean)
    .join(",");

  const mergedRaw = filters ? path.join(dir, "voice-raw.wav") : request.outputPath;
  await concatAudioFiles(partPaths, mergedRaw);
  if (filters) {
    await applyAudioFilter(mergedRaw, request.outputPath, filters);
  }

  request.onVoiceResolved?.(resolveInfo);

  const durationSeconds = await probeDurationSeconds(request.outputPath);
  return { outputPath: request.outputPath, durationSeconds, timestamps, voice };
}

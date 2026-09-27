import { DEFAULT_LONGFORM_SETTINGS, type LongformSettings } from "@/lib/longform-catalog";
import { longformRenderKey, parseLongformEncoder, parseLongformFps, parseLongformResolution } from "@/lib/longform-render";
import { subtitleStyleFingerprint } from "@/lib/subtitle-style";

/** "auto" = otopilot: montaj (mix) HARIC her adim — render kullanicida. */
export type LongformProduceStep = "all" | "auto" | "story" | "beats" | "tts" | "stills" | "mix";

export const LONGFORM_PRODUCE_STEPS = ["all", "auto", "story", "beats", "tts", "stills", "mix"] as const;

export interface LongformPipelineFingerprint {
  stillIntervalSeconds: number;
  genreId: string;
  customGenre: string;
  voiceId: string;
  ttsSpeed: number;
  ttsPitch: number;
  ttsExpressive: boolean;
  stillMotion: string;
  storyHash: string;
  imageProvider: string;
  imageModel: string;
  subtitleKey: string;
  renderKey: string;
}

export function isLongformProduceStep(value: unknown): value is LongformProduceStep {
  return typeof value === "string" && (LONGFORM_PRODUCE_STEPS as readonly string[]).includes(value);
}

export function simpleTextHash(text: string): string {
  let hash = 0;
  const source = text.trim();
  for (let i = 0; i < source.length; i += 1) {
    hash = (Math.imul(31, hash) + source.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function buildLongformFingerprint(input: {
  settings: LongformSettings;
  storyText?: string | null;
}): LongformPipelineFingerprint {
  return {
    stillIntervalSeconds: input.settings.stillIntervalSeconds,
    genreId: input.settings.genreId,
    customGenre: String(input.settings.customGenre || "").replace(/\s+/g, " ").trim(),
    voiceId: input.settings.voiceId,
    ttsSpeed: input.settings.ttsSpeed,
    ttsPitch: input.settings.ttsPitch,
    ttsExpressive: input.settings.ttsExpressive !== false,
    stillMotion: input.settings.stillMotion,
    storyHash: simpleTextHash(input.storyText || ""),
    imageProvider: input.settings.imageProvider || "flow",
    imageModel: input.settings.imageModel || DEFAULT_LONGFORM_SETTINGS.imageModel,
    subtitleKey: subtitleStyleFingerprint(input.settings.subtitles),
    renderKey: longformRenderKey({
      outputResolution: parseLongformResolution(input.settings.outputResolution),
      renderFps: parseLongformFps(input.settings.renderFps),
      renderEncoder: parseLongformEncoder(input.settings.renderEncoder),
    }),
  };
}

export function parseLongformFingerprint(raw: string | null | undefined): LongformPipelineFingerprint | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LongformPipelineFingerprint>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      stillIntervalSeconds: Number(parsed.stillIntervalSeconds) || 0,
      genreId: String(parsed.genreId || ""),
      customGenre: String(parsed.customGenre || "").replace(/\s+/g, " ").trim(),
      voiceId: String(parsed.voiceId || ""),
      ttsSpeed: Number(parsed.ttsSpeed) || 0,
      ttsPitch: Number(parsed.ttsPitch) || 0,
      ttsExpressive: parsed.ttsExpressive !== false,
      stillMotion: String(parsed.stillMotion || ""),
      storyHash: String(parsed.storyHash || ""),
      imageProvider: String(parsed.imageProvider || "flow"),
      imageModel: String(parsed.imageModel || DEFAULT_LONGFORM_SETTINGS.imageModel),
      subtitleKey: String(parsed.subtitleKey || "off"),
      renderKey: String(parsed.renderKey || "1080|24|balanced"),
    };
  } catch {
    return null;
  }
}

export function shouldRebuildBeats(
  previous: LongformPipelineFingerprint | null,
  next: LongformPipelineFingerprint
): boolean {
  if (!previous) return true;
  return (
    previous.stillIntervalSeconds !== next.stillIntervalSeconds ||
    previous.genreId !== next.genreId ||
    previous.customGenre !== next.customGenre ||
    previous.storyHash !== next.storyHash
  );
}

export function shouldRebuildVoice(
  previous: LongformPipelineFingerprint | null,
  next: LongformPipelineFingerprint
): boolean {
  if (!previous) return true;
  return (
    shouldRebuildBeats(previous, next) ||
    previous.voiceId !== next.voiceId ||
    previous.ttsSpeed !== next.ttsSpeed ||
    previous.ttsPitch !== next.ttsPitch ||
    previous.ttsExpressive !== next.ttsExpressive
  );
}

export function shouldRebuildStills(
  previous: LongformPipelineFingerprint | null,
  next: LongformPipelineFingerprint
): boolean {
  if (!previous) return true;
  return shouldRebuildBeats(previous, next) || imageSourceChanged(previous, next);
}

/**
 * Gorsel kaynagi/modeli gercekten degisti mi?
 *
 * Hazir kareleri SILMEK icin kullanilir; bu yuzden onceki iz yoksa false doner.
 * Is yarida iptal edilince parmak izi yazilmamis olabilir — o durumda uretilmis
 * kareleri cope atmak yerine kaldigi yerden devam edilir.
 */
export function imageSourceChanged(
  previous: LongformPipelineFingerprint | null,
  next: LongformPipelineFingerprint
): boolean {
  if (!previous) return false;
  return previous.imageProvider !== next.imageProvider || previous.imageModel !== next.imageModel;
}

export function shouldRebuildMix(
  previous: LongformPipelineFingerprint | null,
  next: LongformPipelineFingerprint
): boolean {
  if (!previous) return true;
  return (
    shouldRebuildVoice(previous, next) ||
    previous.stillMotion !== next.stillMotion ||
    previous.subtitleKey !== next.subtitleKey ||
    previous.renderKey !== next.renderKey ||
    shouldRebuildStills(previous, next)
  );
}

export function shouldRebuildSegments(
  previous: LongformPipelineFingerprint | null,
  next: LongformPipelineFingerprint
): boolean {
  if (!previous) return true;
  return previous.stillMotion !== next.stillMotion || previous.renderKey !== next.renderKey;
}

export function stillFileName(index: number): string {
  return `${String(Math.max(1, Math.round(index))).padStart(3, "0")}.png`;
}

export async function retryAsync<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 400
): Promise<T> {
  let lastError: unknown;
  const safeAttempts = Math.max(1, attempts);
  for (let i = 0; i < safeAttempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < safeAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

export function longformPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    story: "Senaryo",
    beats: "Parcalar",
    tts: "Ses",
    stills: "Gorseller",
    mix: "Slayt montaj",
    done: "Bitti",
    failed: "Hata",
    cancelled: "Iptal",
    idle: "Bekliyor",
  };
  return labels[phase] || phase;
}

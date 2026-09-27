/**
 * Gorsel slayt render bicimleri: HD / QHD / 4K.
 * Cikti her zaman 16:9, cif kenar, yuv420p H.264 — oynaticilar ve YouTube bozulmaz.
 */

export const LONGFORM_RESOLUTIONS = ["1080", "1440", "2160"] as const;
export type LongformResolution = (typeof LONGFORM_RESOLUTIONS)[number];

export const LONGFORM_FPS_OPTIONS = [24, 25, 30] as const;
export type LongformFps = (typeof LONGFORM_FPS_OPTIONS)[number];

export const LONGFORM_ENCODERS = ["fast", "balanced", "quality"] as const;
export type LongformEncoder = (typeof LONGFORM_ENCODERS)[number];

export interface LongformResolutionInfo {
  id: LongformResolution;
  label: string;
  short: string;
  width: number;
  height: number;
  hint: string;
}

export const LONGFORM_RESOLUTION_INFO: LongformResolutionInfo[] = [
  {
    id: "1080",
    label: "HD 1080p",
    short: "HD",
    width: 1920,
    height: 1080,
    hint: "Standart paylasim. Hizli render, YouTube/telefon sorunsuz.",
  },
  {
    id: "1440",
    label: "QHD 1440p",
    short: "QHD",
    width: 2560,
    height: 1440,
    hint: "Daha net kare. Sure ve dosya boyutu orta.",
  },
  {
    id: "2160",
    label: "4K UHD",
    short: "4K",
    width: 3840,
    height: 2160,
    hint: "En net. Render uzun surer; kaynak kare kucukse buyutme detay eklemez.",
  },
];

export const LONGFORM_ENCODER_INFO: Array<{ id: LongformEncoder; label: string; hint: string }> = [
  { id: "fast", label: "Hizli", hint: "Onizleme / deneme. Dosya biraz buyur." },
  { id: "balanced", label: "Dengeli", hint: "Kalite ve sure ortasi. Varsayilan." },
  { id: "quality", label: "Kaliteli", hint: "Yavas encode, daha temiz 4K/QHD." },
];

export function isLongformResolution(value: string): value is LongformResolution {
  return (LONGFORM_RESOLUTIONS as readonly string[]).includes(value);
}

export function isLongformFps(value: number): value is LongformFps {
  return (LONGFORM_FPS_OPTIONS as readonly number[]).includes(value);
}

export function isLongformEncoder(value: string): value is LongformEncoder {
  return (LONGFORM_ENCODERS as readonly string[]).includes(value);
}

export function parseLongformResolution(value: unknown): LongformResolution {
  return isLongformResolution(String(value || "")) ? (value as LongformResolution) : "1080";
}

export function parseLongformFps(value: unknown): LongformFps {
  return isLongformFps(Number(value)) ? (Number(value) as LongformFps) : 24;
}

export function parseLongformEncoder(value: unknown): LongformEncoder {
  return isLongformEncoder(String(value || "")) ? (value as LongformEncoder) : "balanced";
}

export function longformResolutionInfo(id: LongformResolution): LongformResolutionInfo {
  return LONGFORM_RESOLUTION_INFO.find((item) => item.id === id) ?? LONGFORM_RESOLUTION_INFO[0];
}

export function longformFrameSize(resolution: LongformResolution): { width: number; height: number } {
  const info = longformResolutionInfo(resolution);
  return { width: info.width, height: info.height };
}

export function longformRenderKey(input: {
  outputResolution: LongformResolution;
  renderFps: LongformFps;
  renderEncoder: LongformEncoder;
}): string {
  return `${input.outputResolution}|${input.renderFps}|${input.renderEncoder}`;
}

export interface LongformEncodeProfile {
  preset: "veryfast" | "medium" | "slow";
  crf: string;
  audioBitrate: string;
  profile: "high";
  level: string;
  gop: number;
  timeoutMultiplier: number;
}

/** H.264 High + cif seviye + uygun CRF: 1080/1440/2160 oynaticilarda acilir. */
export function longformEncodeProfile(
  resolution: LongformResolution,
  encoder: LongformEncoder,
  fps: LongformFps
): LongformEncodeProfile {
  const baseCrf = resolution === "2160" ? 14 : resolution === "1440" ? 15 : 17;
  const crfShift = encoder === "fast" ? 3 : encoder === "quality" ? -2 : 0;
  const crf = String(Math.min(22, Math.max(12, baseCrf + crfShift)));
  const preset = encoder === "fast" ? "veryfast" : encoder === "quality" ? "slow" : "medium";
  const audioBitrate = resolution === "1080" ? "192k" : "320k";
  const level = resolution === "2160" ? (fps >= 30 ? "5.2" : "5.1") : resolution === "1440" ? "5.1" : "4.1";
  const timeoutMultiplier = resolution === "2160" ? 4 : resolution === "1440" ? 2 : 1;
  return {
    preset,
    crf,
    audioBitrate,
    profile: "high",
    level,
    gop: fps * 2,
    timeoutMultiplier,
  };
}

export function longformH264Args(profile: LongformEncodeProfile): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    profile.crf,
    "-profile:v",
    profile.profile,
    "-level",
    profile.level,
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(profile.gop),
    "-bf",
    "2",
  ];
}

export function longformScaleFilter(width: number, height: number, fps: number): string {
  return [
    `scale=${width}:${height}:flags=lanczos+accurate_rnd+full_chroma_int:force_original_aspect_ratio=decrease:out_range=tv`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
    `fps=${fps}`,
    "format=yuv420p",
  ].join(",");
}

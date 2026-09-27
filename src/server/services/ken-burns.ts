import fs from "node:fs";
import path from "node:path";
import { runFfmpeg, type RunFfmpegOptions } from "@/server/services/ffmpeg";
import { getSettings } from "@/server/services/settings";

export type KenBurnsMotion = "zoom-in" | "zoom-out" | "pan-right" | "pan-left";

export function kenBurnsMotionForIndex(index: number): KenBurnsMotion {
  const motions: KenBurnsMotion[] = ["zoom-in", "pan-right", "zoom-out", "pan-left"];
  return motions[Math.max(0, index) % motions.length];
}

/** Yavas zoom/pan filtresi — slaytin kamerasi oynar. */
export function buildKenBurnsFilter(options: {
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  motion?: KenBurnsMotion;
}): string {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fps = options.fps ?? 24;
  const duration = Math.max(0.5, options.durationSeconds);
  const frames = Math.max(2, Math.round(duration * fps));
  const motion = options.motion ?? "zoom-in";
  // 4K/QHD'de 2x tampon bellegi patlatir; 1.2x yeter.
  const overscan = width >= 2560 ? 1.2 : 2;
  const sw = Math.round((width * overscan) / 2) * 2;
  const sh = Math.round((height * overscan) / 2) * 2;
  const scale = `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh}`;

  let z = "min(zoom+0.00055,1.12)";
  let x = "iw/2-(iw/zoom/2)";
  let y = "ih/2-(ih/zoom/2)";
  if (motion === "zoom-out") {
    z = "if(lte(on,1),1.12,max(zoom-0.00055,1.0))";
  } else if (motion === "pan-right") {
    z = "1.08";
    x = `(iw-iw/zoom)*(on/${frames})`;
  } else if (motion === "pan-left") {
    z = "1.08";
    x = `(iw-iw/zoom)*(1-on/${frames})`;
  }

  return `${scale},zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${width}x${height}:fps=${fps}`;
}

/** Durağan gorseli 16:9 kareye oturtur; kamera hareketi yok. */
export function buildStillHoldFilter(options?: { width?: number; height?: number }): string {
  const width = options?.width ?? 1920;
  const height = options?.height ?? 1080;
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
}

export async function renderKenBurnsSegment(options: {
  imagePath: string;
  outputPath: string;
  durationSeconds: number;
  index?: number;
  width?: number;
  height?: number;
  fps?: number;
  preset?: string;
  crf?: string;
  motionMode?: "hold" | "kenburns";
  runOpts?: RunFfmpegOptions;
}): Promise<string> {
  if (!fs.existsSync(options.imagePath)) throw new Error(`Gorsel bulunamadi: ${options.imagePath}`);
  const settings = await getSettings();
  const ffmpeg = settings.ffmpegPath || "ffmpeg";
  const duration = Math.max(0.8, options.durationSeconds);
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fps = options.fps ?? 24;
  const preset = options.preset || "veryfast";
  const crf = options.crf || "20";
  const hold = options.motionMode !== "kenburns";
  const filter = hold
    ? buildStillHoldFilter({ width, height })
    : buildKenBurnsFilter({
        durationSeconds: duration,
        width,
        height,
        fps,
        motion: kenBurnsMotionForIndex(options.index ?? 0),
      });
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const timeout = Math.max(90_000, Math.round(duration * (width >= 2560 ? 12_000 : 4_000)));
  const encodeTail = [
    "-t",
    duration.toFixed(3),
    "-r",
    String(fps),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
  ];
  try {
    await runFfmpeg(
      ["-y", "-loop", "1", "-i", options.imagePath, "-vf", filter, ...encodeTail, options.outputPath],
      timeout,
      ffmpeg,
      options.runOpts
    );
  } catch {
    await runFfmpeg(
      [
        "-y",
        "-loop",
        "1",
        "-i",
        options.imagePath,
        "-vf",
        buildStillHoldFilter({ width, height }),
        ...encodeTail,
        options.outputPath,
      ],
      timeout,
      ffmpeg,
      options.runOpts
    );
  }
  return options.outputPath;
}

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { getSettings } from "@/server/services/settings";
import { recordEvent } from "@/server/lib/logger";
import {
  assertRenderJobContinuing,
  attachRenderChild,
  clearRenderChild,
} from "@/server/services/render-jobs";
import { buildSrtContent, buildSrtCues, type SrtCue } from "@/server/services/srt";
import {
  buildAssContent,
  parseSubtitleStyle,
  subtitleBelowBandHeight,
  type BurnSubtitleStyle,
} from "@/lib/subtitle-style";

export class FfmpegCancelledError extends Error {
  constructor() {
    super("FFmpeg kullanici tarafindan iptal edildi");
    this.name = "FfmpegCancelledError";
  }
}

export type RunFfmpegOptions = {
  signal?: AbortSignal;
  renderJobId?: string;
};

const execFileAsync = promisify(execFile);

/**
 * FFmpeg / ffprobe servis katmani.
 * - Video analizi (ffprobe)
 * - Son kare cikarma
 * - Concat demuxer ile dogrudan birlestirme
 * - Filter graph ile guvenli yeniden kodlama (fade, kirpma secenekleri)
 */

export interface VideoInfo {
  path: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  audioSampleRate: number | null;
  pixelFormat: string;
  sizeBytes: number;
}

async function binPaths(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const settings = await getSettings();
  return { ffmpeg: settings.ffmpegPath || "ffmpeg", ffprobe: settings.ffprobePath || "ffprobe" };
}

/** ffprobe JSON ciktisini VideoInfo'ya donusturur. */
export function parseProbeOutput(filePath: string, probeJson: string): VideoInfo {
  const data = JSON.parse(probeJson) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      sample_rate?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }>;
  };
  const videoStream = data.streams?.find((s) => s.codec_type === "video");
  const audioStream = data.streams?.find((s) => s.codec_type === "audio");
  if (!videoStream) throw new Error(`Video akisi bulunamadi: ${filePath}`);

  const rate = videoStream.avg_frame_rate && videoStream.avg_frame_rate !== "0/0" ? videoStream.avg_frame_rate : videoStream.r_frame_rate ?? "0/1";
  const [num, den] = rate.split("/").map(Number);
  const fps = den > 0 ? num / den : 0;

  return {
    path: filePath,
    durationSeconds: Number(data.format?.duration ?? 0),
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    fps: Number(fps.toFixed(3)),
    videoCodec: videoStream.codec_name ?? "unknown",
    audioCodec: audioStream?.codec_name ?? null,
    audioSampleRate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : null,
    pixelFormat: videoStream.pix_fmt ?? "unknown",
    sizeBytes: Number(data.format?.size ?? 0),
  };
}

/** Videoyu ffprobe ile analiz eder. */
export async function probeVideo(filePath: string): Promise<VideoInfo> {
  const { ffprobe } = await binPaths();
  const { stdout } = await execFileAsync(
    ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { timeout: 30_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
  );
  return parseProbeOutput(filePath, stdout);
}

/** Dosya var mi, acilabiliyor mu, minimum boyutta mi? */
export async function validateVideoFile(filePath: string, minBytes = 50_000): Promise<{ ok: boolean; info?: VideoInfo; error?: string }> {
  if (!fs.existsSync(filePath)) return { ok: false, error: "Dosya bulunamadi" };
  const stat = fs.statSync(filePath);
  if (stat.size < minBytes) return { ok: false, error: `Dosya cok kucuk (${stat.size} bayt) — yarim indirme olabilir` };
  try {
    const info = await probeVideo(filePath);
    if (info.durationSeconds <= 0.2) return { ok: false, error: "Video suresi gecersiz" };
    return { ok: true, info };
  } catch (err) {
    return { ok: false, error: `Video acilamadi: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Videonun son temiz karesini PNG olarak cikarir (ffmpeg -sseof). */
export async function extractLastFrame(videoPath: string, outputPath: string): Promise<string> {
  const { ffmpeg } = await binPaths();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await execFileAsync(
    ffmpeg,
    ["-y", "-sseof", "-0.2", "-i", videoPath, "-frames:v", "1", "-update", "1", "-q:v", "2", outputPath],
    { timeout: 60_000, windowsHide: true }
  );
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error("Son kare cikartilamadi");
  }
  return outputPath;
}

/** Videonun belirli bir saniyesinden tek kare cikarir (referans gorsel icin). */
export async function extractFrameAt(videoPath: string, seconds: number, outputPath: string): Promise<string> {
  const { ffmpeg } = await binPaths();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await execFileAsync(
    ffmpeg,
    ["-y", "-ss", String(Math.max(0, seconds)), "-i", videoPath, "-frames:v", "1", "-update", "1", "-q:v", "2", outputPath],
    { timeout: 60_000, windowsHide: true }
  );
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
    throw new Error(`${seconds}. saniyeden kare cikartilamadi`);
  }
  return outputPath;
}

/** Windows'ta kalin, okunakli bir TrueType font yolu bulur. */
export function resolveThumbnailFontPath(): string | null {
  const candidates = [
    "C:/Windows/Fonts/seguibl.ttf", // Segoe UI Black — Turkce + kalin
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/tahomabd.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/impact.ttf",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function escapeDrawtextValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\n/g, "\\n");
}

/**
 * Kalin sans-serif (Segoe UI Black / Arial Bold) icin kaba karakter genisligi (em).
 * ffmpeg drawtext'in gercek metrigini bilmedigimiz icin taşmayı onleyecek sekilde
 * biraz genis tahmin edilir.
 */
function charWidthEm(ch: string): number {
  if (/[ıiIlj!.,:;'’`|\-]/.test(ch)) return 0.34;
  if (ch === " ") return 0.3;
  if (/[mwMWĞ]/.test(ch)) return 0.94;
  if (/[frtszçş]/.test(ch)) return 0.52;
  if (/[A-ZÇĞİÖŞÜ0-9]/.test(ch)) return 0.7;
  return 0.6;
}

/** Metnin em cinsinden tahmini genisligi (fontSize ile carpilir). */
export function estimateTextWidthEm(text: string): number {
  let sum = 0;
  for (const ch of text) sum += charWidthEm(ch);
  return sum;
}

/**
 * Kelimeleri istenen satir sayisina DENGELI boler: en uzun satirin genisligini
 * en kucuk yapan bolunmeyi arar. (Acgozlu bolme "kisa satir + cok uzun satir"
 * gibi dengesiz sonuc verip puntoyu gereksiz kucultuyordu.)
 */
function wrapIntoLines(words: string[], lineCount: number): string[] {
  if (lineCount <= 1 || words.length <= 1) return [words.join(" ")];

  const memo = new Map<string, { maxEm: number; splits: number[] }>();
  const search = (start: number, linesLeft: number): { maxEm: number; splits: number[] } => {
    const key = `${start}|${linesLeft}`;
    const cached = memo.get(key);
    if (cached) return cached;

    // Son satir: kalan tum kelimeler
    if (linesLeft === 1) {
      const result = { maxEm: estimateTextWidthEm(words.slice(start).join(" ")), splits: [] as number[] };
      memo.set(key, result);
      return result;
    }

    let best: { maxEm: number; splits: number[] } | null = null;
    // Bu satirda en az 1, kalan satirlara en az 1 kelime kalacak sekilde dene
    for (let end = start + 1; end <= words.length - (linesLeft - 1); end++) {
      const lineEm = estimateTextWidthEm(words.slice(start, end).join(" "));
      const rest = search(end, linesLeft - 1);
      const maxEm = Math.max(lineEm, rest.maxEm);
      if (!best || maxEm < best.maxEm) best = { maxEm, splits: [end, ...rest.splits] };
    }
    const result = best ?? { maxEm: estimateTextWidthEm(words.slice(start).join(" ")), splits: [] };
    memo.set(key, result);
    return result;
  };

  const { splits } = search(0, Math.min(lineCount, words.length));
  const lines: string[] = [];
  let cursor = 0;
  for (const split of splits) {
    lines.push(words.slice(cursor, split).join(" "));
    cursor = split;
  }
  lines.push(words.slice(cursor).join(" "));
  return lines.filter(Boolean);
}

export interface ThumbnailTextLayout {
  lines: string[];
  fontSize: number;
  lineSpacing: number;
  borderWidth: number;
  boxBorderWidth: number;
}

/**
 * Kapak yazisini gorsele SIGDIRAN oranli yerlesim hesabi.
 *
 * Once punto sabit (h/7) verildigi icin uzun yazilar gorselin dısına taşiyordu.
 * Burada punto; metnin tahmini genisligine, guvenli kenar bosluguna ve dikey paya
 * gore hesaplanir, gerekirse yazi 2-3 satira bolunur. Kontur/kutu boslugu da
 * puntoyla oranli buyur — kucuk puntoda kalin cerceve metni yutmaz.
 */
export function computeThumbnailTextLayout(options: {
  text: string;
  width: number;
  height: number;
  maxLines?: number;
}): ThumbnailTextLayout {
  const width = options.width > 0 ? options.width : 1280;
  const height = options.height > 0 ? options.height : 720;
  const words = options.text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

  const safeWidth = width * 0.8; // iki yandan ~%10 guvenli bosluk
  const heightBudget = height * 0.34; // flaş baslik: 2-3 satir pay
  const BOX_PAD_EM = 0.18; // kutu boslugu (punto orani, iki yan icin 2x)
  const LINE_EM = 1.18; // satir yuksekligi + satir araligi
  const maxFont = height * 0.125; // YouTube drama kapagi: dev, mobilde okunur punto
  const maxLines = Math.max(1, Math.min(3, options.maxLines ?? (words.length > 3 ? 3 : words.length > 1 ? 2 : 1)));

  let best: { lines: string[]; fontSize: number } | null = null;
  for (let lineCount = 1; lineCount <= maxLines; lineCount++) {
    if (lineCount > words.length) break;
    const lines = wrapIntoLines(words, lineCount);
    const longestEm = Math.max(...lines.map((line) => estimateTextWidthEm(line)));
    const byWidth = safeWidth / (longestEm + BOX_PAD_EM * 2);
    const byHeight = heightBudget / (lines.length * LINE_EM + BOX_PAD_EM * 2);
    const fontSize = Math.min(byWidth, byHeight, maxFont);
    // Esitlikte AZ satirli olan kazanir; cok satir ancak belirgin buyume saglarsa secilir
    if (!best || fontSize > best.fontSize + 1) best = { lines, fontSize };
  }

  const chosen = best ?? { lines: [options.text.trim()], fontSize: maxFont };
  const fontSize = Math.max(12, Math.floor(chosen.fontSize));
  return {
    lines: chosen.lines,
    fontSize,
    lineSpacing: Math.max(2, Math.round(fontSize * 0.12)),
    borderWidth: Math.max(2, Math.round(fontSize * 0.07)),
    boxBorderWidth: Math.max(6, Math.round(fontSize * BOX_PAD_EM)),
  };
}

/**
 * PNG/JPG uzerine YouTube kapak tarzi kalin yazi bindirir (beyaz + siyah kontur + kutu).
 * Punto gorselin olculerine ve yazinin uzunluguna gore hesaplanir; yazi gorsele
 * daima sigar (gerekirse satira bolunur). Font yoksa veya ffmpeg basarisizsa hata
 * firlatir — cagiran yedekleyebilir.
 */
export async function burnTextOntoImage(
  inputPath: string,
  outputPath: string,
  text: string,
  options?: {
    position?: "bottom" | "top";
    /** Ikinci satir sari vurgu (YouTube drama kapagi dili). Varsayilan acik. */
    accent?: boolean;
    /** Kirmizi ok isareti (konuya isaret) — sag orta bolgeye cizilir. */
    arrow?: "right" | "left" | false;
  }
): Promise<string> {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("Bindirme yazisi bos");
  if (!fs.existsSync(inputPath)) throw new Error("Kaynak gorsel yok");

  const font = resolveThumbnailFontPath();
  if (!font) throw new Error("Sistemde kalin font bulunamadi (Impact/Arial Bold)");

  const { ffmpeg } = await binPaths();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Gorsel olculeri: punto bunlara gore oranlanir (probe basarisizsa 16:9 varsayilan)
  let imageWidth = 1280;
  let imageHeight = 720;
  try {
    const info = await probeVideo(inputPath);
    if (info.width > 0 && info.height > 0) {
      imageWidth = info.width;
      imageHeight = info.height;
    }
  } catch {
    // olcu okunamadi: varsayilan 1280x720 oranlari kullanilir
  }

  const layout = computeThumbnailTextLayout({ text: cleaned, width: imageWidth, height: imageHeight });
  const accent = options?.accent !== false;

  const fontEsc = escapeDrawtextValue(font.replace(/\\/g, "/"));
  const margin = Math.round(imageHeight * 0.055);
  const lineHeight = layout.fontSize + layout.lineSpacing * 2;
  const totalTextHeight = layout.lines.length * lineHeight;
  const startY =
    options?.position === "bottom" ? imageHeight - totalTextHeight - margin : margin;

  // YouTube drama kapagi: dev punto, KALIN siyah kontur + golge, kutu YOK;
  // ikinci satir sari vurgu. Her satir ayri drawtext (renk/urun konumu icin).
  const borderW = Math.max(4, Math.round(layout.fontSize * 0.11));
  const shadowOff = Math.max(2, Math.round(layout.fontSize * 0.05));
  const tempFiles: string[] = [];
  const filters: string[] = [];
  layout.lines.forEach((line, i) => {
    const lineFile = path.join(path.dirname(outputPath), `thumb-text-${Date.now()}-${i}.txt`);
    fs.writeFileSync(lineFile, line, "utf8");
    tempFiles.push(lineFile);
    const color = accent && i === layout.lines.length - 1 && layout.lines.length > 1 ? "0xFFD400" : "white";
    filters.push(
      [
        `drawtext=fontfile='${fontEsc}'`,
        `textfile='${escapeDrawtextValue(lineFile.replace(/\\/g, "/"))}'`,
        `fontsize=${layout.fontSize}`,
        `fontcolor=${color}`,
        `borderw=${borderW}`,
        "bordercolor=black",
        `shadowcolor=black@0.65`,
        `shadowx=${shadowOff}`,
        `shadowy=${shadowOff}`,
        "x=(w-text_w)/2",
        `y=${startY + i * lineHeight}`,
      ].join(":")
    );
  });

  if (options?.arrow) {
    // Kirmizi ok isareti: konu/yuz bolgesine dikkat ceker (PNG varligi gerekmez).
    const arrowChar = options.arrow === "left" ? "\u2190" : "\u2192";
    const arrowFile = path.join(path.dirname(outputPath), `thumb-arrow-${Date.now()}.txt`);
    fs.writeFileSync(arrowFile, arrowChar, "utf8");
    tempFiles.push(arrowFile);
    const arrowSize = Math.round(imageHeight * 0.2);
    const arrowX = options.arrow === "left" ? Math.round(imageWidth * 0.3) : Math.round(imageWidth * 0.56);
    filters.push(
      [
        `drawtext=fontfile='${fontEsc}'`,
        `textfile='${escapeDrawtextValue(arrowFile.replace(/\\/g, "/"))}'`,
        `fontsize=${arrowSize}`,
        "fontcolor=0xE62117",
        `borderw=${Math.max(4, Math.round(arrowSize * 0.07))}`,
        "bordercolor=white",
        `shadowcolor=black@0.6`,
        `shadowx=${shadowOff}`,
        `shadowy=${shadowOff}`,
        `x=${arrowX}`,
        `y=${Math.round(imageHeight * 0.42)}`,
      ].join(":")
    );
  }

  const filter = filters.join(",");

  try {
    await runFfmpeg(["-y", "-i", inputPath, "-vf", filter, "-frames:v", "1", "-update", "1", "-q:v", "2", outputPath], 60_000, ffmpeg);
  } finally {
    for (const f of tempFiles) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        // gecici dosya kalirsa sorun degil
      }
    }
  }

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 800) {
    throw new Error("Yazili thumbnail yazilamadi");
  }
  return outputPath;
}

/** Windows CreateProcess komut satiri ~32KB; bunun altinda kal. */
export const WINDOWS_CMDLINE_SAFE = 28_000;

export function quoteWindowsArg(value: string): string {
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** spawn'in Windows'ta uretecegi komut satiri uzunlugu (yaklasik). */
export function windowsCommandLineLength(bin: string, args: string[]): number {
  return [bin, ...args].map(quoteWindowsArg).join(" ").length;
}

export function isSpawnNameTooLong(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ENAMETOOLONG" || /ENAMETOOLONG/i.test(err instanceof Error ? err.message : String(err));
}

/** Concat demuxer liste dosyasi icerigini uretir (tek tirnak kacisli). */
export function buildConcatListContent(filePaths: string[]): string {
  return filePaths
    .map((p) => {
      // ffmpeg concat demuxer: yol tek tirnak icinde; icteki tek tirnak '\'' ile kacilir.
      // Windows ters bolu yerine bolu kullanmak guvenlidir.
      const normalized = p.replace(/\\/g, "/").replace(/'/g, "'\\''");
      return `file '${normalized}'`;
    })
    .join("\n");
}

/** Kliplerin teknik ozellikleri concat demuxer icin yeterince ayni mi? */
export function clipsAreUniform(infos: VideoInfo[]): boolean {
  if (infos.length <= 1) return true;
  const first = infos[0];
  return infos.every(
    (i) =>
      i.width === first.width &&
      i.height === first.height &&
      Math.abs(i.fps - first.fps) < 0.5 &&
      i.videoCodec === first.videoCodec &&
      i.audioCodec === first.audioCodec &&
      i.audioSampleRate === first.audioSampleRate &&
      i.pixelFormat === first.pixelFormat
  );
}

export function runFfmpeg(
  args: string[],
  timeoutMs: number,
  ffmpegBin: string,
  opts?: RunFfmpegOptions
): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts?.signal?.aborted) {
      reject(new FfmpegCancelledError());
      return;
    }
    if (opts?.renderJobId) {
      try {
        assertRenderJobContinuing(opts.renderJobId);
      } catch (err) {
        reject(err);
        return;
      }
    }

    const child: ChildProcess = spawn(ffmpegBin, args, { windowsHide: true });
    if (opts?.renderJobId) attachRenderChild(opts.renderJobId, child);

    let stderr = "";
    let settled = false;
    const cleanup = () => {
      if (opts?.renderJobId) clearRenderChild(opts.renderJobId);
      opts?.signal?.removeEventListener("abort", onAbort);
    };
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(err);
    };
    const settleResolve = (value: { stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    };

    const onAbort = () => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      settleReject(new FfmpegCancelledError());
    };
    opts?.signal?.addEventListener("abort", onAbort);

    const timer = setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      settleReject(new Error(`FFmpeg zaman asimina ugradi (${Math.round(timeoutMs / 1000)} sn)`));
    }, timeoutMs);

    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4 * 1024 * 1024) stderr = stderr.slice(-2 * 1024 * 1024);
    });
    child.on("error", (err) => {
      if (isSpawnNameTooLong(err)) {
        settleReject(
          Object.assign(new Error("spawn ENAMETOOLONG"), {
            code: "ENAMETOOLONG",
            cause: err,
          })
        );
        return;
      }
      settleReject(err);
    });
    child.on("close", (code) => {
      if (opts?.signal?.aborted) {
        settleReject(new FfmpegCancelledError());
        return;
      }
      if (code === 0) settleResolve({ stderr });
      else settleReject(new Error(`FFmpeg hata koduyla bitti (${code}): ${stderr.slice(-800)}`));
    });
  });
}

/** Baslangic/bitis siyah kare araligini tespit eder (saniye cinsinden kirpma onerisi). */
export async function detectBlackBounds(
  videoPath: string,
  durationSeconds: number,
  opts?: RunFfmpegOptions
): Promise<{ trimStart: number; trimEnd: number }> {
  const { ffmpeg } = await binPaths();
  const { stderr } = await runFfmpeg(
    ["-i", videoPath, "-vf", "blackdetect=d=0.05:pix_th=0.10", "-an", "-f", "null", "-"],
    120_000,
    ffmpeg,
    opts
  );
  let trimStart = 0;
  let trimEnd = 0;
  const regex = /black_start:(\d+(?:\.\d+)?)\s+black_end:(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stderr)) !== null) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start <= 0.05) trimStart = Math.max(trimStart, Math.min(end, 1.5));
    if (end >= durationSeconds - 0.05) trimEnd = Math.max(trimEnd, Math.min(durationSeconds - start, 1.5));
  }
  return { trimStart, trimEnd };
}

/** Baslangic/bitis sessizligini tespit eder. */
export async function detectSilenceBounds(
  videoPath: string,
  durationSeconds: number,
  opts?: RunFfmpegOptions
): Promise<{ trimStart: number; trimEnd: number }> {
  const { ffmpeg } = await binPaths();
  try {
    const { stderr } = await runFfmpeg(
      ["-i", videoPath, "-af", "silencedetect=noise=-45dB:d=0.25", "-vn", "-f", "null", "-"],
      120_000,
      ffmpeg,
      opts
    );
    let trimStart = 0;
    let trimEnd = 0;
    const startRegex = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
    const endRegex = /silence_end:\s*(\d+(?:\.\d+)?)/g;
    const starts: number[] = [];
    const ends: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = startRegex.exec(stderr)) !== null) starts.push(Number(m[1]));
    while ((m = endRegex.exec(stderr)) !== null) ends.push(Number(m[1]));
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = ends[i] ?? durationSeconds;
      if (start <= 0.05) trimStart = Math.max(trimStart, Math.min(end, 1.0));
      if (end >= durationSeconds - 0.05) trimEnd = Math.max(trimEnd, Math.min(durationSeconds - start, 1.0));
    }
    return { trimStart, trimEnd };
  } catch {
    // Ses akisi olmayan videoda silencedetect hata verebilir
    return { trimStart: 0, trimEnd: 0 };
  }
}

export type OutputResolution = "source" | "1080" | "1440" | "2160";

export interface MergeOptions {
  /** direct: concat demuxer (ayni ozellikte klipler) — reencode: guvenli yeniden kodlama */
  mode: "direct" | "reencode" | "auto";
  /** Klip birlesim noktalarinda ses gecis suresi (ms). 0 = kapali. 50-150 onerilir. */
  audioFadeMs: number;
  /** Baslangic/bitis sessizligini kirp */
  trimSilence: boolean;
  /** Baslangic/bitis siyah karelerini kirp */
  trimBlack: boolean;
  /**
   * Cikti cozunurlugu. source = kaynak klip boyutu (en dogru).
   * 1080/1440/2160 = yeniden kodlayip hedefe olcekle (kaynak daha dusukse upscale; detay sihirli eklenmez).
   */
  outputResolution?: OutputResolution;
  /**
   * true ise birlestirme sirasinda her klibin diyalogu videoya gomulur (burn-in).
   * Zamanlama klip sirasi + gercek/kirpilmis surelerle SRT uretilir. Yeniden kodlama gerekir.
   */
  burnSubtitles?: boolean;
  /** burnSubtitles icin clipPaths ile AYNI sirada diyalog metinleri */
  clipDialogues?: string[];
  /** Gomulu altyazi stili; verilmezse varsayilan (video alti, beyaz kutu) */
  subtitleStyle?: BurnSubtitleStyle;
  /** ic kullanim: parcali birlestirme icinde tekrar ENAMETOOLONG dongusune girme */
  skipBatchFallback?: boolean;
}

/** FFmpeg subtitles= filtresi icin Windows/Unix yol kacisi. */
export function escapeFfmpegSubtitlesPath(filePath: string): string {
  return path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
}

/** Bitmis temp dosyayi final yoluna tasir; Windows kilitli dosyada kopyaya duser. */
export function replaceFinishedOutput(tempPath: string, outputPath: string): void {
  if (path.resolve(tempPath) === path.resolve(outputPath)) return;
  if (!fs.existsSync(tempPath)) throw new Error("Gecici cikis dosyasi yok");
  if (fs.existsSync(outputPath)) {
    try {
      fs.rmSync(outputPath);
    } catch {
      const backup = `${outputPath}.old`;
      try {
        if (fs.existsSync(backup)) fs.rmSync(backup);
      } catch {
        // eski yedek kilitli kalabilir
      }
      try {
        fs.renameSync(outputPath, backup);
      } catch {
        // oynatici dosyayi tutuyorsa asagidaki kopya uzerine yazar
      }
    }
  }
  try {
    fs.renameSync(tempPath, outputPath);
  } catch {
    fs.copyFileSync(tempPath, outputPath);
    try {
      fs.rmSync(tempPath);
    } catch {
      // temp sonra silinebilir
    }
  }
}

/** En-boy oranina gore hedef genislik/yukseklik. */
export function resolveOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  resolution: OutputResolution
): { width: number; height: number; upscaled: boolean } {
  if (resolution === "source" || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: sourceWidth, height: sourceHeight, upscaled: false };
  }
  const portrait = sourceHeight > sourceWidth;
  const targetShort = resolution === "1080" ? 1080 : resolution === "1440" ? 1440 : 2160;
  // 16:9 / 9:16 klasik: kisa kenar = 1080/1440/2160
  let width: number;
  let height: number;
  if (portrait) {
    width = targetShort;
    height = Math.round((targetShort * sourceHeight) / sourceWidth / 2) * 2;
  } else {
    height = targetShort;
    width = Math.round((targetShort * sourceWidth) / sourceHeight / 2) * 2;
  }
  // Klasik 16:9 / 9:16 sabitleri (yuvarlama sapmasini duzelt)
  if (!portrait && Math.abs(sourceWidth / sourceHeight - 16 / 9) < 0.05) {
    if (resolution === "1080") {
      width = 1920;
      height = 1080;
    } else if (resolution === "1440") {
      width = 2560;
      height = 1440;
    } else {
      width = 3840;
      height = 2160;
    }
  }
  if (portrait && Math.abs(sourceHeight / sourceWidth - 16 / 9) < 0.05) {
    if (resolution === "1080") {
      width = 1080;
      height = 1920;
    } else if (resolution === "1440") {
      width = 1440;
      height = 2560;
    } else {
      width = 2160;
      height = 3840;
    }
  }
  const upscaled = width > sourceWidth + 8 || height > sourceHeight + 8;
  return { width, height, upscaled };
}

export interface MergeResult {
  outputPath: string;
  mode: "direct" | "reencode";
  info: VideoInfo;
  clipCount: number;
  warnings: string[];
}

const BATCH_MERGE_SIZE = 16;

async function mergeClipsInBatches(
  clipPaths: string[],
  outputPath: string,
  options: MergeOptions,
  projectId: string | undefined,
  runOpts: RunFfmpegOptions | undefined
): Promise<void> {
  const workDir = path.join(
    path.dirname(outputPath),
    `${path.basename(outputPath, path.extname(outputPath))}-batches`
  );
  fs.mkdirSync(workDir, { recursive: true });
  const inner: MergeOptions = {
    ...options,
    mode: "reencode",
    burnSubtitles: false,
    clipDialogues: undefined,
    skipBatchFallback: true,
  };
  const parts: string[] = [];
  for (let i = 0; i < clipPaths.length; i += BATCH_MERGE_SIZE) {
    if (runOpts?.signal?.aborted) throw new FfmpegCancelledError();
    if (runOpts?.renderJobId) assertRenderJobContinuing(runOpts.renderJobId);
    const slice = clipPaths.slice(i, i + BATCH_MERGE_SIZE);
    const partPath = path.join(workDir, `part-${String(Math.floor(i / BATCH_MERGE_SIZE) + 1).padStart(2, "0")}.mp4`);
    await mergeClips(slice, partPath, inner, projectId, runOpts);
    parts.push(partPath);
  }
  const needBurn = Boolean(options.burnSubtitles && options.clipDialogues?.some((d) => d.trim()));
  const joinedPath = needBurn ? path.join(workDir, "joined.mp4") : outputPath;
  await mergeClips(parts, joinedPath, { ...inner, mode: "auto" }, projectId, runOpts);
  if (!needBurn) return;

  const infos: VideoInfo[] = [];
  for (const clipPath of clipPaths) {
    const validation = await validateVideoFile(clipPath, 10_000);
    if (!validation.ok || !validation.info) throw new Error(`Klip dogrulanamadi: ${validation.error}`);
    infos.push(validation.info);
  }
  const timed = clipPaths.map((_, i) => ({
    index: i + 1,
    dialogue: (options.clipDialogues?.[i] || "").trim(),
    durationSeconds: Math.max(0.2, infos[i].durationSeconds),
  }));
  const cues = buildSrtCues(timed);
  const { ffmpeg } = await binPaths();
  const probe = await validateVideoFile(joinedPath, 10_000);
  const width = probe.info?.width || 1080;
  const height = probe.info?.height || 1920;
  const assPath = path.join(workDir, "joined.burn.ass");
  fs.writeFileSync(assPath, buildAssContent(cues, parseSubtitleStyle(options.subtitleStyle), width, height), "utf8");
  const escaped = escapeFfmpegSubtitlesPath(assPath);
  await runFfmpeg(
    [
      "-y",
      "-i",
      joinedPath,
      "-vf",
      `subtitles='${escaped}'`,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    Math.max(300_000, infos.reduce((sum, info) => sum + info.durationSeconds, 0) * 20_000),
    ffmpeg,
    runOpts
  );
}

/**
 * Klipleri tek MP4'e birlestirir.
 * Cikti: H.264 + AAC 48kHz, yuv420p, +faststart.
 */
export async function mergeClips(
  clipPaths: string[],
  outputPath: string,
  options: MergeOptions,
  projectId?: string,
  runOpts?: RunFfmpegOptions
): Promise<MergeResult> {
  if (clipPaths.length === 0) throw new Error("Birlestirilecek klip yok");
  const { ffmpeg } = await binPaths();
  const warnings: string[] = [];
  const checkCancel = () => {
    if (runOpts?.signal?.aborted) throw new FfmpegCancelledError();
    if (runOpts?.renderJobId) assertRenderJobContinuing(runOpts.renderJobId);
  };

  const infos: VideoInfo[] = [];
  for (const clipPath of clipPaths) {
    checkCancel();
    // Indirme aninda 50KB esigi zaten uygulandi; burada yalnizca dosyanin
    // hala mevcut/acilabilir oldugunu dogruluyoruz.
    const validation = await validateVideoFile(clipPath, 10_000);
    if (!validation.ok || !validation.info) throw new Error(`Klip dogrulanamadi (${path.basename(clipPath)}): ${validation.error}`);
    infos.push(validation.info);
  }

  const uniform = clipsAreUniform(infos);
  const resolution: OutputResolution = options.outputResolution ?? "source";
  const needsScale = resolution !== "source";
  const burnSubtitles = Boolean(options.burnSubtitles);
  let mode: "direct" | "reencode";
  if (options.mode === "auto") {
    mode =
      uniform &&
      options.audioFadeMs === 0 &&
      !options.trimSilence &&
      !options.trimBlack &&
      !needsScale &&
      !burnSubtitles
        ? "direct"
        : "reencode";
  } else {
    mode = options.mode;
  }
  if (mode === "direct" && !uniform) {
    warnings.push("Klipler ayni teknik ozellikte degil; guvenli yeniden kodlamaya gecildi.");
    mode = "reencode";
  }
  if (
    mode === "direct" &&
    (options.audioFadeMs > 0 || options.trimSilence || options.trimBlack || needsScale || burnSubtitles)
  ) {
    warnings.push(
      burnSubtitles
        ? "Gomulu altyazi yeniden kodlama gerektirir; yeniden kodlamaya gecildi."
        : needsScale
          ? "Hedef cozunurluk yeniden kodlama gerektirir; yeniden kodlamaya gecildi."
          : "Ses gecisi/kirpma secenekleri yeniden kodlama gerektirir; yeniden kodlamaya gecildi."
    );
    mode = "reencode";
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const totalDuration = infos.reduce((sum, i) => sum + i.durationSeconds, 0);
  const timeout = Math.max(300_000, totalDuration * 20_000);

  if (mode === "direct") {
    const listPath = path.join(path.dirname(outputPath), "concat-list.txt");
    fs.writeFileSync(listPath, buildConcatListContent(clipPaths), "utf8");
    await recordEvent({ projectId, step: "render", message: `Dogrudan birlestirme basladi (${clipPaths.length} klip)` });
    checkCancel();
    await runFfmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outputPath],
      timeout,
      ffmpeg,
      runOpts
    );
  } else {
    // Kirpma analizleri
    const trims: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < clipPaths.length; i++) {
      checkCancel();
      let trimStart = 0;
      let trimEnd = 0;
      if (options.trimBlack) {
        const black = await detectBlackBounds(clipPaths[i], infos[i].durationSeconds, runOpts);
        trimStart = Math.max(trimStart, black.trimStart);
        trimEnd = Math.max(trimEnd, black.trimEnd);
      }
      if (options.trimSilence) {
        const silence = await detectSilenceBounds(clipPaths[i], infos[i].durationSeconds, runOpts);
        trimStart = Math.max(trimStart, silence.trimStart);
        trimEnd = Math.max(trimEnd, silence.trimEnd);
      }
      // Klibin en az %60'i kalmali; asiri kirpmayi engelle
      const maxTrimTotal = infos[i].durationSeconds * 0.4;
      if (trimStart + trimEnd > maxTrimTotal) {
        const scale = maxTrimTotal / (trimStart + trimEnd);
        trimStart *= scale;
        trimEnd *= scale;
        warnings.push(`${path.basename(clipPaths[i])}: kirpma miktari guvenlik icin sinirlandi`);
      }
      trims.push({ start: trimStart, end: trimEnd });
    }

    // Hedef cozunurluk/fps: en buyuk kaynak klip + kullanici hedefi
    const bestSource = infos.reduce((best, i) => (i.width * i.height > best.width * best.height ? i : best), infos[0]);
    const sized = resolveOutputSize(bestSource.width, bestSource.height, resolution);
    const target = { width: sized.width, height: sized.height, fps: bestSource.fps || 24 };
    if (sized.upscaled) {
      warnings.push(
        `Cikti ${target.width}x${target.height} (kaynak ~${bestSource.width}x${bestSource.height}). Upscale detay eklemez; YouTube/paylasim icin kullanisli olabilir.`
      );
    }
    const fadeSec = Math.min(Math.max(options.audioFadeMs, 0), 300) / 1000;
    // YouTube/paylasim icin yuksek kalite: QHD/4K'da dusuk CRF + slow preset
    const crf =
      resolution === "2160" ? "14" : resolution === "1440" ? "15" : resolution === "1080" ? "17" : "18";
    const preset = resolution === "2160" || resolution === "1440" ? "slow" : "medium";
    const audioBitrate = resolution === "2160" || resolution === "1440" ? "320k" : "192k";
    const highResTimeout = resolution === "2160" || resolution === "1440";

    const inputArgs: string[] = [];
    for (const clipPath of clipPaths) inputArgs.push("-i", clipPath);

    const filterParts: string[] = [];
    const concatInputs: string[] = [];
    for (let i = 0; i < clipPaths.length; i++) {
      const info = infos[i];
      const trim = trims[i];
      const effectiveDuration = info.durationSeconds - trim.start - trim.end;
      const vTrim = `trim=start=${trim.start.toFixed(3)}:end=${(info.durationSeconds - trim.end).toFixed(3)},setpts=PTS-STARTPTS`;
      // lanczos + accurate_rnd: QHD/4K upscale'te daha temiz kenarlar
      const vScale = `scale=${target.width}:${target.height}:flags=lanczos+accurate_rnd+full_chroma_int:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${target.fps || 24},format=yuv420p`;
      filterParts.push(`[${i}:v]${vTrim},${vScale}[v${i}]`);

      const hasAudio = info.audioCodec !== null;
      if (hasAudio) {
        const aTrim = `atrim=start=${trim.start.toFixed(3)}:end=${(info.durationSeconds - trim.end).toFixed(3)},asetpts=PTS-STARTPTS`;
        let aChain = `[${i}:a]${aTrim},aresample=48000`;
        if (fadeSec > 0 && effectiveDuration > fadeSec * 3) {
          const fadeOutStart = Math.max(0, effectiveDuration - fadeSec);
          if (i > 0) aChain += `,afade=t=in:st=0:d=${fadeSec.toFixed(3)}`;
          if (i < clipPaths.length - 1) aChain += `,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSec.toFixed(3)}`;
        }
        filterParts.push(`${aChain}[a${i}]`);
      } else {
        // Ses akisi olmayan klip icin sessiz ses uret
        filterParts.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${Math.max(effectiveDuration, 0.1).toFixed(3)}[a${i}]`
        );
        warnings.push(`${path.basename(clipPaths[i])}: ses akisi yok, sessiz ses eklendi`);
      }
      concatInputs.push(`[v${i}][a${i}]`);
    }
    filterParts.push(`${concatInputs.join("")}concat=n=${clipPaths.length}:v=1:a=1[outv][outa]`);

    let videoMapLabel = "[outv]";
    let burnedSrtPath: string | null = null;
    if (burnSubtitles) {
      const dialogues = options.clipDialogues ?? [];
      const timed = clipPaths.map((_, i) => {
        const trim = trims[i];
        const effective = Math.max(0.2, infos[i].durationSeconds - trim.start - trim.end);
        return {
          index: i + 1,
          dialogue: (dialogues[i] || "").trim(),
          durationSeconds: effective,
        };
      });
      const cues = buildSrtCues(timed);
      if (cues.length === 0) {
        warnings.push("Gomulu altyazi istendi ama diyalog kuyrugu bos — altyazi atlandi.");
      } else {
        burnedSrtPath = path.join(
          path.dirname(outputPath),
          `${path.basename(outputPath, path.extname(outputPath))}.burn.srt`
        );
        fs.writeFileSync(burnedSrtPath, `\uFEFF${buildSrtContent(cues)}`, "utf8");
        // Soft kopya: YouTube icin de yaninda kalsin
        const softSrt = path.join(
          path.dirname(outputPath),
          `${path.basename(outputPath, path.extname(outputPath))}.srt`
        );
        fs.writeFileSync(softSrt, `\uFEFF${buildSrtContent(cues)}`, "utf8");

        const burnedAssPath = path.join(
          path.dirname(outputPath),
          `${path.basename(outputPath, path.extname(outputPath))}.burn.ass`
        );
        fs.writeFileSync(
          burnedAssPath,
          buildAssContent(cues, parseSubtitleStyle(options.subtitleStyle), target.width, target.height),
          "utf8"
        );
        const escaped = escapeFfmpegSubtitlesPath(burnedAssPath);
        filterParts.push(`[outv]subtitles='${escaped}'[vout]`);
        videoMapLabel = "[vout]";
        warnings.push(`Gomulu altyazi: ${cues.length} kuyruk, ${timed.filter((t) => t.dialogue).length} sahne metni`);
      }
    }

    await recordEvent({
      projectId,
      step: "render",
      message: `Yeniden kodlayarak birlestirme basladi (${clipPaths.length} klip, ${target.width}x${target.height}, CRF ${crf}, preset ${preset}${fadeSec > 0 ? `, ${options.audioFadeMs}ms ses gecisi` : ""}${burnSubtitles ? ", gomulu altyazi" : ""})`,
    });

    const encodeTimeout = highResTimeout
      ? Math.max(600_000, totalDuration * 45_000)
      : Math.max(300_000, totalDuration * 20_000);

    const x264Args =
      resolution === "2160"
        ? ["-profile:v", "high", "-level", "5.1"]
        : resolution === "1440"
          ? ["-profile:v", "high", "-level", "5.0"]
          : ["-profile:v", "high"];

    checkCancel();
    const filterGraph = filterParts.join(";");
    const encodeArgsTail = [
      "-map",
      videoMapLabel,
      "-map",
      "[outa]",
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      ...x264Args,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      outputPath,
    ];
    const inlineArgs = ["-y", ...inputArgs, "-filter_complex", filterGraph, ...encodeArgsTail];
    const useScript =
      filterGraph.length > 3_000 ||
      clipPaths.length >= 20 ||
      windowsCommandLineLength(ffmpeg, inlineArgs) > WINDOWS_CMDLINE_SAFE;
    const filterScriptPath = path.join(
      path.dirname(outputPath),
      `${path.basename(outputPath, path.extname(outputPath))}.filter.txt`
    );
    let encodeArgs = inlineArgs;
    if (useScript) {
      fs.writeFileSync(filterScriptPath, filterGraph, "utf8");
      encodeArgs = ["-y", ...inputArgs, "-filter_complex_script", filterScriptPath, ...encodeArgsTail];
    }

    const tooLongForWindows = windowsCommandLineLength(ffmpeg, encodeArgs) > WINDOWS_CMDLINE_SAFE;
    if (tooLongForWindows && !options.skipBatchFallback && clipPaths.length > 12) {
      warnings.push("Komut satiri Windows sinirina yaklasiyor; klipler parca parca birlestirilecek.");
      await recordEvent({
        projectId,
        step: "render",
        level: "warning",
        message: `Yeniden kodlama ${clipPaths.length} klip icin parcali birlestirmeye dustu (komut satiri cok uzun)`,
      });
      await mergeClipsInBatches(clipPaths, outputPath, options, projectId, runOpts);
    } else {
      try {
        await runFfmpeg(encodeArgs, encodeTimeout, ffmpeg, runOpts);
      } catch (err) {
        if (!isSpawnNameTooLong(err) || options.skipBatchFallback || clipPaths.length <= 12) {
          if (isSpawnNameTooLong(err)) {
            throw new Error(
              "FFmpeg komut satiri Windows sinirini asti (spawn ENAMETOOLONG). Daha kisa proje klasoru veya dogrudan birlestirme deneyin."
            );
          }
          throw err;
        }
        warnings.push("FFmpeg komut satiri Windows sinirini asti; parca parca birlestiriliyor.");
        await recordEvent({
          projectId,
          step: "render",
          level: "warning",
          message: `spawn ENAMETOOLONG — ${clipPaths.length} klip parcali birlestirmeye alindi`,
        });
        await mergeClipsInBatches(clipPaths, outputPath, options, projectId, runOpts);
      }
    }
  }

  const finalValidation = await validateVideoFile(outputPath, 10_000);
  if (!finalValidation.ok || !finalValidation.info) {
    throw new Error(`Final video dogrulanamadi: ${finalValidation.error}`);
  }
  await recordEvent({
    projectId,
    step: "render",
    message: `Birlestirme tamamlandi: ${path.basename(outputPath)} (${Math.round(finalValidation.info.durationSeconds)} sn, ${(finalValidation.info.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`,
  });

  return { outputPath, mode, info: finalValidation.info, clipCount: clipPaths.length, warnings };
}

/** Ses veya video dosyasinin format suresini okur. */
export async function probeDurationSeconds(filePath: string): Promise<number> {
  const { ffprobe } = await binPaths();
  const { stdout } = await execFileAsync(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    { timeout: 30_000, windowsHide: true }
  );
  const n = Number(String(stdout).trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Sure okunamadi: ${path.basename(filePath)}`);
  return n;
}

/** Perde (semiton) kaydirir; sureyi atempo ile korur. 0 ise bos filtre. */
export function buildPitchFilter(pitchSemitones: number, sampleRate = 24000): string {
  if (!pitchSemitones) return "";
  const ratio = 2 ** (pitchSemitones / 12);
  const parts = [`asetrate=${Math.round(sampleRate * ratio)}`, `aresample=${sampleRate}`];
  let remaining = 1 / ratio;
  while (remaining < 0.5 - 1e-6 || remaining > 2 + 1e-6) {
    if (remaining < 0.5) {
      parts.push("atempo=0.5");
      remaining /= 0.5;
    } else {
      parts.push("atempo=2.0");
      remaining /= 2;
    }
  }
  parts.push(`atempo=${remaining.toFixed(5)}`);
  return parts.join(",");
}

export async function applyAudioFilter(
  inputPath: string,
  outputPath: string,
  filter: string,
  opts?: RunFfmpegOptions
): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (!filter.trim()) {
    if (path.resolve(inputPath) !== path.resolve(outputPath)) fs.copyFileSync(inputPath, outputPath);
    return;
  }
  const { ffmpeg } = await binPaths();
  await runFfmpeg(["-y", "-i", inputPath, "-af", filter, outputPath], 300_000, ffmpeg, opts);
}

/**
 * Final videoya dongulu arka plan muzigi karistirir (konusma one cikar).
 * Cikti ayni yola yazilir; video akisi yeniden kodlanmaz.
 */
export async function mixBackgroundMusic(
  videoPath: string,
  musicPath: string,
  opts?: RunFfmpegOptions & { volume?: number }
): Promise<VideoInfo> {
  const { ffmpeg } = await binPaths();
  const info = await probeVideo(videoPath);
  const volume = Math.max(0.02, Math.min(0.5, opts?.volume ?? 0.12));
  const tempPath = videoPath.replace(/\.mp4$/i, ".music-mix.mp4");
  const music = `[1:a]volume=${volume},aformat=sample_rates=48000:channel_layouts=stereo[m]`;
  const filter = info.audioCodec
    ? `${music};[0:a]aformat=sample_rates=48000:channel_layouts=stereo[v];[v][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
    : `${music};[m]anull[a]`;
  const args = [
    "-y",
    "-i",
    videoPath,
    "-stream_loop",
    "-1",
    "-i",
    musicPath,
    "-filter_complex",
    filter,
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-t",
    info.durationSeconds.toFixed(3),
    "-movflags",
    "+faststart",
    tempPath,
  ];
  try {
    await runFfmpeg(args, Math.max(300_000, Math.round(info.durationSeconds * 1000 * 2)), ffmpeg, opts);
    fs.renameSync(tempPath, videoPath);
  } catch (err) {
    fs.rmSync(tempPath, { force: true });
    throw err;
  }
  return probeVideo(videoPath);
}

export async function concatAudioFiles(
  inputPaths: string[],
  outputPath: string,
  opts?: RunFfmpegOptions
): Promise<void> {
  if (inputPaths.length === 0) throw new Error("Birlestirilecek ses yok");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (inputPaths.length === 1) {
    fs.copyFileSync(inputPaths[0], outputPath);
    return;
  }
  const { ffmpeg } = await binPaths();
  const listPath = `${outputPath}.concat.txt`;
  fs.writeFileSync(listPath, buildConcatListContent(inputPaths), "utf8");
  try {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], 300_000, ffmpeg, opts);
  } catch {
    await runFfmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "pcm_s16le", outputPath],
      300_000,
      ffmpeg,
      opts
    );
  }
}

/**
 * Herhangi bir ses dosyasini 24 kHz mono WAV'a cevirir.
 *
 * Saglayicilar farkli bicimler donuyor (Google/Azure WAV, ElevenLabs mp3);
 * birlestirme ve sure olcumu tek bicimde yapilsin diye normalize edilir.
 */
export async function convertToWav(inputPath: string, outputPath: string, opts?: RunFfmpegOptions): Promise<void> {
  const { ffmpeg } = await binPaths();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await runFfmpeg(
    ["-y", "-i", inputPath, "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", outputPath],
    180_000,
    ffmpeg,
    opts
  );
}

/**
 * Konusma hizi filtresi (perdeyi bozmaz). atempo 0.5-2 araligini kabul
 * ettigi icin gerekirse zincirlenir.
 */
export function buildTempoFilter(speed: number): string {
  const target = Number(speed);
  if (!Number.isFinite(target) || Math.abs(target - 1) < 1e-3) return "";
  const parts: string[] = [];
  let remaining = Math.min(3, Math.max(0.34, target));
  while (remaining < 0.5 - 1e-6 || remaining > 2 + 1e-6) {
    if (remaining < 0.5) {
      parts.push("atempo=0.5");
      remaining /= 0.5;
    } else {
      parts.push("atempo=2.0");
      remaining /= 2;
    }
  }
  parts.push(`atempo=${remaining.toFixed(5)}`);
  return parts.join(",");
}

export interface AssembleLongformInput {
  segmentPaths: string[];
  voicePath: string;
  musicPath?: string | null;
  outputPath: string;
  projectId?: string;
  runOpts?: RunFfmpegOptions;
  /** Hazir SRT yolu — YouTube icin; burn-in ASS kuyruklardan yazilir */
  burnSrtPath?: string | null;
  subtitleCues?: SrtCue[];
  subtitleStyle?: BurnSubtitleStyle | null;
  outputWidth?: number;
  outputHeight?: number;
  fps?: number;
  encodePreset?: string;
  encodeCrf?: string;
  audioBitrate?: string;
  h264Profile?: string;
  h264Level?: string;
  gop?: number;
  timeoutMultiplier?: number;
}

/** Ken Burns segmentlerini birlestirir, ses + muzik ducking + loudnorm uygular. */
export async function assembleLongform(input: AssembleLongformInput): Promise<VideoInfo> {
  if (input.segmentPaths.length === 0) throw new Error("Montaj icin gorsel segment yok");
  if (!fs.existsSync(input.voicePath)) throw new Error("Ses dosyasi bulunamadi");
  const { ffmpeg } = await binPaths();
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  const workDir = path.dirname(input.outputPath);
  const mixingPath = path.join(workDir, "final.mixing.mp4");
  const silentPath = path.join(workDir, "longform-silent.mp4");
  const listPath = path.join(workDir, "longform-concat.txt");
  fs.writeFileSync(listPath, buildConcatListContent(input.segmentPaths), "utf8");

  const timeoutMult = Math.max(1, input.timeoutMultiplier || 1);
  const concatTimeout = Math.max(180_000, input.segmentPaths.length * 8_000) * timeoutMult;
  const concatPreset = input.encodePreset || "veryfast";
  const concatCrf = input.encodeCrf || "20";
  try {
    await runFfmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", silentPath],
      concatTimeout,
      ffmpeg,
      input.runOpts
    );
  } catch {
    await runFfmpeg(
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-preset",
        concatPreset,
        "-crf",
        concatCrf,
        "-pix_fmt",
        "yuv420p",
        "-an",
        silentPath,
      ],
      concatTimeout * 2,
      ffmpeg,
      input.runOpts
    );
  }

  const args = ["-y", "-i", silentPath, "-i", input.voicePath];
  const hasMusic = !!(input.musicPath && fs.existsSync(input.musicPath));
  if (hasMusic) {
    args.push("-stream_loop", "-1", "-i", input.musicPath!);
  }

  const targetWidth = input.outputWidth && input.outputWidth > 0 ? input.outputWidth : 1920;
  const targetHeight = input.outputHeight && input.outputHeight > 0 ? input.outputHeight : 1080;
  const fps = input.fps && input.fps > 0 ? input.fps : 24;
  const parsedStyle = parseSubtitleStyle(input.subtitleStyle);
  const subtitleCues = (input.subtitleCues || []).filter((cue) => cue.text.trim());
  const burnSubs = parsedStyle.enabled && subtitleCues.length > 0;
  const belowBand =
    burnSubs && parsedStyle.position === "below" ? subtitleBelowBandHeight(targetHeight, parsedStyle.size) : 0;
  const outWidth = targetWidth;
  const outHeight = targetHeight + belowBand;
  const scaleChain = [
    `scale=${targetWidth}:${targetHeight}:flags=lanczos+accurate_rnd+full_chroma_int:force_original_aspect_ratio=decrease:out_range=tv`,
    belowBand > 0
      ? `pad=${outWidth}:${outHeight}:(ow-iw)/2:0:black`
      : `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
    `fps=${fps}`,
    "format=yuv420p",
  ].join(",");
  const filterParts: string[] = [];
  if (hasMusic) {
    filterParts.push(
      "[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=1.0[voice];[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.13[bg];[voice][bg]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11[a]"
    );
  } else {
    filterParts.push("[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]");
  }
  if (burnSubs) {
    const assPath = path.join(workDir, "burn-in.ass");
    fs.writeFileSync(
      assPath,
      buildAssContent(subtitleCues, parsedStyle, outWidth, outHeight, {
        contentHeight: targetHeight,
        belowBand,
      }),
      "utf8"
    );
    filterParts.push(`[0:v]${scaleChain},subtitles='${escapeFfmpegSubtitlesPath(assPath)}'[vout]`);
  } else {
    filterParts.push(`[0:v]${scaleChain}[vout]`);
  }
  args.push("-filter_complex", filterParts.join(";"), "-map", "[vout]", "-map", "[a]");
  let mixSeconds = 0;
  try {
    mixSeconds = await probeDurationSeconds(input.voicePath);
  } catch {
    mixSeconds = 0;
  }
  if (mixSeconds <= 0) {
    try {
      mixSeconds = (await probeVideo(silentPath)).durationSeconds;
    } catch {
      mixSeconds = 0;
    }
  }

  const preset = input.encodePreset || "medium";
  const crf = input.encodeCrf || "17";
  const audioBitrate = input.audioBitrate || "192k";
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-profile:v",
    input.h264Profile || "high",
    "-level",
    input.h264Level || "4.1",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(input.gop || fps * 2),
    "-bf",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    audioBitrate,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-shortest",
    ...(mixSeconds > 0 ? (["-t", (mixSeconds + 0.05).toFixed(3)] as const) : []),
    "-movflags",
    "+faststart",
    mixingPath
  );

  const mixTimeout = Math.max(300_000, input.segmentPaths.length * 12_000) * timeoutMult;
  await runFfmpeg(args, mixTimeout, ffmpeg, input.runOpts);

  const finalValidation = await validateVideoFile(mixingPath, 10_000);
  if (!finalValidation.ok || !finalValidation.info) {
    throw new Error(`Uzun form final dogrulanamadi: ${finalValidation.error}`);
  }
  replaceFinishedOutput(mixingPath, input.outputPath);
  await recordEvent({
    projectId: input.projectId,
    step: "longform",
    message: `Uzun form montaj tamamlandi: ${path.basename(input.outputPath)} (${Math.round(finalValidation.info.durationSeconds)} sn${burnSubs ? ", gomulu altyazi" : ""})`,
  });
  return finalValidation.info;
}

export interface MergeSongFinalInput {
  clipPaths: string[];
  masterAudioPath: string;
  outputPath: string;
  options?: MergeOptions;
  projectId?: string;
  runOpts?: RunFfmpegOptions;
}

/** Cocuk sarki: sessiz/goruntu klipleri birlestirip Suno master parcasini mux eder. */
export async function mergeSongFinal(input: MergeSongFinalInput): Promise<MergeResult> {
  if (input.clipPaths.length === 0) throw new Error("Birlestirilecek klip yok");
  if (!fs.existsSync(input.masterAudioPath)) throw new Error("Master parca bulunamadi");
  const { ffmpeg } = await binPaths();
  const warnings: string[] = [];
  const workDir = path.dirname(input.outputPath);
  const silentPath = path.join(workDir, "song-silent.mp4");
  const listPath = path.join(workDir, "song-concat.txt");
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(listPath, buildConcatListContent(input.clipPaths), "utf8");

  const checkCancel = () => {
    if (input.runOpts?.signal?.aborted) throw new FfmpegCancelledError();
    if (input.runOpts?.renderJobId) assertRenderJobContinuing(input.runOpts.renderJobId);
  };

  checkCancel();
  const concatTimeout = Math.max(180_000, input.clipPaths.length * 10_000);
  try {
    await runFfmpeg(
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-an", silentPath],
      concatTimeout,
      ffmpeg,
      input.runOpts
    );
  } catch {
    await runFfmpeg(
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-an",
        silentPath,
      ],
      concatTimeout * 2,
      ffmpeg,
      input.runOpts
    );
  }

  const videoInfo = await probeVideo(silentPath);
  const audioInfo = await probeVideo(input.masterAudioPath);
  const drift = Math.abs(videoInfo.durationSeconds - audioInfo.durationSeconds);
  if (drift > 1.5) {
    warnings.push(
      `Video (${videoInfo.durationSeconds.toFixed(1)} sn) ile parca (${audioInfo.durationSeconds.toFixed(1)} sn) arasinda ${drift.toFixed(1)} sn fark — -shortest ile kesilecek`
    );
  }

  checkCancel();
  await runFfmpeg(
    [
      "-y",
      "-i",
      silentPath,
      "-i",
      input.masterAudioPath,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-shortest",
      "-movflags",
      "+faststart",
      input.outputPath,
    ],
    Math.max(300_000, videoInfo.durationSeconds * 15_000),
    ffmpeg,
    input.runOpts
  );

  const finalInfo = await probeVideo(input.outputPath);
  await recordEvent({
    projectId: input.projectId,
    step: "render",
    message: `Sarki final mux tamamlandi (${finalInfo.durationSeconds.toFixed(1)} sn)`,
  });

  return {
    outputPath: input.outputPath,
    mode: "reencode",
    clipCount: input.clipPaths.length,
    warnings,
    info: finalInfo,
  };
}

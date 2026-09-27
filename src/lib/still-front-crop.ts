import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { decodePngRgba, type DecodedRgba } from "@/lib/png-rgba";

/** Kirpma dikdortgeni — goruntu boyutuna gore ORAN (0..1). */
export interface FrontPanelRect {
  wFrac: number;
  hFrac: number;
  xFrac: number;
  yFrac: number;
}

/** Sol (on) panelin tamami — analiz yapilamadiginda kullanilan guvenli varsayilan. */
export const FRONT_PANEL_LEFT_HALF: FrontPanelRect = { wFrac: 0.5, hFrac: 1, xFrac: 0, yFrac: 0 };

export function cropFilterFor(rect: FrontPanelRect): string {
  const f = (n: number) => Math.max(0, Math.min(1, n)).toFixed(4);
  return `crop=iw*${f(rect.wFrac)}:ih*${f(rect.hFrac)}:iw*${f(rect.xFrac)}:ih*${f(rect.yFrac)}`;
}

/**
 * Kucuk bir PNG ornegi uretip cozer.
 *
 * Flow'un verdigi dosyalar .png adiyla kaydedilse de icerik JPEG olabiliyor;
 * dogrudan PNG cozucusu bu dosyalarda calismaz. ffmpeg araya girince analiz
 * bicimden bagimsiz olur.
 */
function sampleRgba(filePath: string, cols = 96): DecodedRgba | null {
  try {
    const out = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", filePath, "-vf", `scale=${cols}:-1`, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"],
      { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    );
    return decodePngRgba(Buffer.from(out));
  } catch {
    return null;
  }
}

function luminance(img: DecodedRgba, x: number, y: number): number {
  const { width: W, height: H, data } = img;
  const i = (Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4;
  return (data[i] + data[i + 1] + data[i + 2]) / 3;
}

/**
 * Kadro sheet'i ON + ARKA iki panelden olusur (SOL panel on gorunus).
 * Kirpma bu yuzden sol yarim uzerinden hesaplanir; ortadan kirpmak iki panel
 * arasindaki BOS gri bosluga denk geliyor ve neredeyse tek renk, islevsiz bir
 * referans uretiyordu.
 *
 * Sol yarimda figurun sinirlari orneklenir; bulunamazsa sol yarimin tamami
 * kullanilir (yine dogru panel, sadece daha genis).
 */
export function frontPanelRectFromRgba(img: DecodedRgba): FrontPanelRect {
  const { width: W, height: H } = img;
  const halfW = Math.floor(W / 2);
  if (halfW < 8 || H < 8) return FRONT_PANEL_LEFT_HALF;

  // Zemin (studyo grisi) tahmini: sol yarimin ust seridi.
  const bgSamples: number[] = [];
  const bgY = Math.max(0, Math.floor(H * 0.03));
  for (let x = 1; x < halfW; x += 1) bgSamples.push(luminance(img, x, bgY));
  bgSamples.sort((a, b) => a - b);
  const background = bgSamples[Math.floor(bgSamples.length / 2)] ?? 128;

  const colHit: number[] = new Array(halfW).fill(0);
  const rowHit: number[] = new Array(H).fill(0);
  for (let x = 0; x < halfW; x += 1) {
    for (let y = 0; y < H; y += 1) {
      if (Math.abs(luminance(img, x, y) - background) > 18) {
        colHit[x] += 1;
        rowHit[y] += 1;
      }
    }
  }
  const colThreshold = Math.max(2, Math.floor(H * 0.04));
  const rowThreshold = Math.max(2, Math.floor(halfW * 0.04));
  const firstCol = colHit.findIndex((v) => v >= colThreshold);
  const lastCol = colHit.length - 1 - [...colHit].reverse().findIndex((v) => v >= colThreshold);
  const firstRow = rowHit.findIndex((v) => v >= rowThreshold);
  const lastRow = rowHit.length - 1 - [...rowHit].reverse().findIndex((v) => v >= rowThreshold);
  if (firstCol < 0 || lastCol <= firstCol || firstRow < 0 || lastRow <= firstRow) return FRONT_PANEL_LEFT_HALF;

  const padX = W * 0.03;
  const padY = H * 0.03;
  const x0 = Math.max(0, firstCol - padX);
  const x1 = Math.min(halfW, lastCol + padX);
  const y0 = Math.max(0, firstRow - padY);
  const y1 = Math.min(H, lastRow + padY);
  const w = x1 - x0;
  const h = y1 - y0;
  // Cok ince serit (panel cizgisi / kenar) yakalandiysa sol yarimi kullan.
  if (w < halfW * 0.25 || h < H * 0.3) return FRONT_PANEL_LEFT_HALF;

  return { wFrac: w / W, hFrac: h / H, xFrac: x0 / W, yFrac: y0 / H };
}

/** Neredeyse tek renk (bos gri) kare: referans olarak ise yaramaz. */
export function rgbaLooksBlank(img: DecodedRgba): boolean {
  const { width: W, height: H } = img;
  const values: number[] = [];
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) values.push(luminance(img, x, y));
  }
  if (values.length === 0) return false;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) < 14;
}

/** Dosyadan bos/gri kontrolu (bicim bagimsiz). Okunamazsa "bos degil" varsayilir. */
export function fileLooksBlank(filePath: string): boolean {
  const sample = sampleRgba(filePath, 64);
  return sample ? rgbaLooksBlank(sample) : false;
}

/**
 * Kare uretiminde isteme eklenecek ON gorunum referansi.
 * Sheet'in sol (on) panelini kirpar; kirpma basarisiz veya BOS cikarsa
 * orijinal sheet kullanilir ve bozuk kirpma dosyasi silinir.
 */
export function ensureStillFrontReference(sheetPath: string): string {
  if (!sheetPath || !fs.existsSync(sheetPath)) return sheetPath;
  const dir = path.dirname(sheetPath);
  const ext = path.extname(sheetPath) || ".png";
  const base = path.basename(sheetPath, ext);
  if (/-front$/i.test(base)) return sheetPath;
  const out = path.join(dir, `${base}-front.png`);
  try {
    const sample = sampleRgba(sheetPath);
    const rect = sample ? frontPanelRectFromRgba(sample) : FRONT_PANEL_LEFT_HALF;
    execFileSync("ffmpeg", ["-y", "-i", sheetPath, "-vf", cropFilterFor(rect), out], {
      stdio: "pipe",
      windowsHide: true,
    });
    if (fs.existsSync(out) && fs.statSync(out).size > 8_000 && !fileLooksBlank(out)) return out;
    // Bos/gri kirpma isteme EKLENMEZ; kalinti dosya da silinir.
    fs.rmSync(out, { force: true });
  } catch {
    // kirpma olmazsa orijinal sheet (eski davranis)
  }
  return sheetPath;
}

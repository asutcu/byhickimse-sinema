import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { getSettings } from "@/server/services/settings";

const execFileAsync = promisify(execFile);

export interface CheckResult {
  ok: boolean;
  label: string;
  detail: string;
}

/**
 * Kurulum kontrolleri her sayfa acilisinda islem baslatiyordu (ffmpeg -version,
 * ffprobe -version, playwright import). Otomasyon calisirken bu spawn'lar
 * istekleri saniyelerce bekletiyor. Sonuc pratikte hic degismedigi icin
 * bellekte tutulur; yol/ayar degisirse anahtar degisir ve yeniden olculur.
 */
const CHECK_TTL_MS = 60_000;
const checkCache = new Map<string, { at: number; value: unknown }>();

async function cachedCheck<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = checkCache.get(key);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.value as T;
  const value = await run();
  checkCache.set(key, { at: Date.now(), value });
  return value;
}

/** ffmpeg/ffprobe kurulum ve surum kontrolu. */
export async function checkFfmpeg(): Promise<{ ffmpeg: CheckResult; ffprobe: CheckResult }> {
  const settings = await getSettings();
  const ffmpegPath = settings.ffmpegPath || "ffmpeg";
  const ffprobePath = settings.ffprobePath || "ffprobe";
  return cachedCheck(`ffmpeg:${ffmpegPath}|${ffprobePath}`, async () => ({
    ffmpeg: await checkBinary(ffmpegPath, "FFmpeg"),
    ffprobe: await checkBinary(ffprobePath, "ffprobe"),
  }));
}

async function checkBinary(bin: string, label: string): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync(bin, ["-version"], { timeout: 10_000, windowsHide: true });
    const firstLine = stdout.split(/\r?\n/)[0] ?? "";
    return { ok: true, label, detail: firstLine.trim() };
  } catch {
    return {
      ok: false,
      label,
      detail: `${label} bulunamadi. Kurulum icin: winget install Gyan.FFmpeg (kurulumdan sonra terminali yeniden acin)`,
    };
  }
}

/** Node surumu kontrolu (>=22 onerilir). */
export function checkNode(): CheckResult {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  return {
    ok: major >= 22,
    label: "Node.js",
    detail: major >= 22 ? `v${version}` : `v${version} — Node 22 veya ustu onerilir`,
  };
}

/** Chrome kurulum kontrolu (bilinen kurulum yollari). */
export function checkChrome(): CheckResult {
  const candidates = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return { ok: true, label: "Google Chrome", detail: candidate };
    }
  }
  return { ok: false, label: "Google Chrome", detail: "Chrome bulunamadi. https://www.google.com/chrome/ adresinden kurun." };
}

/** Playwright paketinin kurulu olup olmadigini kontrol eder. */
export async function checkPlaywright(): Promise<CheckResult> {
  return cachedCheck("playwright", async () => {
    try {
      const { chromium } = await import("playwright");
      return {
        ok: true,
        label: "Playwright",
        detail: `Kurulu (sistem Chrome'u "channel: chrome" ile kullanilacak). Executable: ${chromium.name()}`,
      };
    } catch {
      return { ok: false, label: "Playwright", detail: "playwright paketi yuklenemedi. npm install calistirin." };
    }
  });
}

/** Kalici Chrome profil klasoru mevcut mu / olusturulabilir mi? */
export async function checkChromeProfile(): Promise<CheckResult> {
  const settings = await getSettings();
  const dir = settings.chromeProfileDir;
  if (!dir) return { ok: false, label: "Chrome Profili", detail: "Profil klasoru ayarlanmamis" };
  return cachedCheck(`chrome-profile:${dir}`, async () => {
    const exists = fs.existsSync(dir);
    return {
      ok: true,
      label: "Chrome Profili",
      detail: exists
        ? `${dir} (mevcut${fs.existsSync(path.join(dir, "Default")) ? ", oturum verisi var" : ""})`
        : `${dir} (ilk acilista olusturulacak)`,
    };
  });
}

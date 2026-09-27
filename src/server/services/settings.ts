import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/server/db";
import { encryptSecret, decryptSecret } from "@/server/lib/crypto";
import { DEFAULT_CHROME_PROFILE_DIR, PROJECTS_ROOT } from "@/server/lib/paths";
import { logger } from "@/server/lib/logger";
import type { AppSettings } from "@prisma/client";

/**
 * Uygulama ayarlari + OpenAI anahtar yonetimi.
 * Anahtar saklama modlari:
 *  - memory: yalnizca calisan surecte bellekte tutulur (varsayilan)
 *  - encrypted: AES-256-GCM ile sifrelenip veritabanina yazilir
 * Anahtar istemciye asla gonderilmez; API yanitlarinda yalnizca maskeli ozet yer alir.
 */

const globalForKey = globalThis as unknown as { openaiKeyInMemory?: string | null };
if (globalForKey.openaiKeyInMemory === undefined) globalForKey.openaiKeyInMemory = null;

/** Model destek matrisi: sure/oran/referans/ses destegi dogrulamasi icin. */
export interface ModelSupport {
  durations: number[];
  aspectRatios: string[];
  supportsReference: boolean;
  supportsAudio: boolean;
  supportsStartFrame: boolean;
}

/** Proje/yeni proje secicilerinde her zaman gosterilecek kanonik model listesi. */
export const KNOWN_FLOW_MODELS = [
  "Veo 3.1 Lite",
  "Veo 3.1 Fast",
  "Veo 3.1 Quality",
  "Gemini Omni Flash",
] as const;

const veoLite: ModelSupport = {
  durations: [4, 6, 8],
  aspectRatios: ["16:9", "9:16"],
  supportsReference: false,
  supportsAudio: true,
  supportsStartFrame: true,
};

const veoFast: ModelSupport = {
  durations: [4, 6, 8],
  aspectRatios: ["16:9", "9:16"],
  supportsReference: true,
  supportsAudio: true,
  supportsStartFrame: true,
};

const veoQuality: ModelSupport = {
  durations: [4, 6, 8, 10],
  aspectRatios: ["16:9", "9:16"],
  supportsReference: true,
  supportsAudio: true,
  supportsStartFrame: true,
};

const omniFlash: ModelSupport = {
  durations: [4, 6, 8, 10],
  aspectRatios: ["16:9", "9:16"],
  supportsReference: true,
  supportsAudio: true,
  supportsStartFrame: true,
};

export const DEFAULT_MODEL_SUPPORT_MATRIX: Record<string, ModelSupport> = {
  "Veo 3.1 Lite": veoLite,
  "Veo 3.1 Fast": veoFast,
  "Veo 3.1 Quality": veoQuality,
  "Gemini Omni Flash": omniFlash,
  "Veo 3.1 - Lite": veoLite,
  "Veo 3.1 - Fast": veoFast,
  "Veo 3.1 - Quality": veoQuality,
  "Gemini - Omni Flash": omniFlash,
};

function canonicalMatrixJson(): string {
  return JSON.stringify(Object.fromEntries(KNOWN_FLOW_MODELS.map((name) => [name, DEFAULT_MODEL_SUPPORT_MATRIX[name]])));
}

export async function getSettings(): Promise<AppSettings> {
  const existing = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!existing) {
    return prisma.appSettings.create({
      data: {
        id: 1,
        chromeProfileDir: DEFAULT_CHROME_PROFILE_DIR,
        downloadDir: PROJECTS_ROOT,
        modelSupportMatrix: canonicalMatrixJson(),
      },
    });
  }

  // Omni eklenirken diger modellerin silinmesini onle — eksik kanonik modelleri tamamla
  try {
    const parsed = JSON.parse(existing.modelSupportMatrix || "{}") as Record<string, unknown>;
    let dirty = false;
    for (const name of KNOWN_FLOW_MODELS) {
      if (!parsed[name] || typeof parsed[name] !== "object") {
        parsed[name] = DEFAULT_MODEL_SUPPORT_MATRIX[name];
        dirty = true;
      }
    }
    const omni = parsed["Gemini Omni Flash"] as ModelSupport | undefined;
    if (omni && (!Array.isArray(omni.durations) || !omni.durations.includes(10) || !omni.supportsReference)) {
      parsed["Gemini Omni Flash"] = DEFAULT_MODEL_SUPPORT_MATRIX["Gemini Omni Flash"];
      dirty = true;
    }
    if (dirty) {
      return prisma.appSettings.update({
        where: { id: 1 },
        data: { modelSupportMatrix: JSON.stringify(parsed) },
      });
    }
  } catch {
    return prisma.appSettings.update({
      where: { id: 1 },
      data: { modelSupportMatrix: canonicalMatrixJson() },
    });
  }

  return existing;
}

/** Eski proje klasorune isaret eden Chrome profilini bu uygulama kokune ceker. */
export async function healChromeProfileDirIfStale(): Promise<string> {
  const settings = await getSettings();
  const current = (settings.chromeProfileDir || "").trim();
  const preferred = DEFAULT_CHROME_PROFILE_DIR;
  if (!current) {
    await updateSettings({ chromeProfileDir: preferred });
    return preferred;
  }
  const resolved = path.resolve(current);
  const preferredResolved = path.resolve(preferred);
  if (resolved === preferredResolved) return preferredResolved;

  // Eski "FLOW HIKAYE BOT" vb. masaustu kopyalarina sabitlenmis ayar
  const looksLikeSiblingBot =
    /FLOW\s*H[İI]KAYE\s*BOT|flow\s*hikaye/i.test(resolved) ||
    (!fs.existsSync(resolved) && fs.existsSync(preferredResolved));

  if (looksLikeSiblingBot || !fs.existsSync(resolved)) {
    await updateSettings({ chromeProfileDir: preferredResolved });
    logger.info({ from: resolved, to: preferredResolved }, "chromeProfileDir stale path healed");
    return preferredResolved;
  }
  return resolved;
}

export type SettingsUpdate = Partial<
  Pick<
    AppSettings,
    | "openaiModel"
    | "flowUrl"
    | "chromeProfileDir"
    | "downloadDir"
    | "ffmpegPath"
    | "ffprobePath"
    | "maxRetries"
    | "waitBetweenGenerationsMs"
    | "generationTimeoutMs"
    | "pollIntervalMs"
    | "defaultFlowModel"
    | "defaultClipSeconds"
    | "defaultAspectRatio"
    | "headless"
    | "slowMoMs"
    | "maxParallelProjects"
    | "wpmSlow"
    | "wpmNormal"
    | "wpmFast"
    | "modelSupportMatrix"
    | "sunoApiBaseUrl"
    | "sunoDefaultModel"
  >
> &
  Partial<Omit<TtsSettingsView, "googleTtsKeyEncrypted" | "azureSpeechKeyEncrypted" | "elevenLabsKeyEncrypted">>;

export async function updateSettings(update: SettingsUpdate): Promise<AppSettings> {
  await getSettings();
  return prisma.appSettings.update({
    where: { id: 1 },
    data: update as Parameters<typeof prisma.appSettings.update>[0]["data"],
  });
}

/** Anahtari secilen moda gore kaydeder. mode=memory ise DB'deki sifreli kopya silinir. */
export async function setOpenAiKey(key: string, mode: "memory" | "encrypted"): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API anahtari bos olamaz");
  await getSettings();
  globalForKey.openaiKeyInMemory = trimmed;
  if (mode === "encrypted") {
    await prisma.appSettings.update({
      where: { id: 1 },
      data: { openaiKeyStorageMode: "encrypted", openaiApiKeyEncrypted: encryptSecret(trimmed) },
    });
  } else {
    await prisma.appSettings.update({
      where: { id: 1 },
      data: { openaiKeyStorageMode: "memory", openaiApiKeyEncrypted: null },
    });
  }
}

/** Kayitli anahtari tamamen unutturur (bellek + DB). */
export async function clearOpenAiKey(): Promise<void> {
  globalForKey.openaiKeyInMemory = null;
  await getSettings();
  await prisma.appSettings.update({
    where: { id: 1 },
    data: { openaiKeyStorageMode: "memory", openaiApiKeyEncrypted: null },
  });
}

/**
 * Anahtar cozumleme sirasi:
 * 1. Bellekteki anahtar
 * 2. DB'deki sifreli anahtar (mode=encrypted ise)
 * 3. OPENAI_API_KEY ortam degiskeni (.env)
 */
export async function resolveOpenAiKey(): Promise<string | null> {
  if (globalForKey.openaiKeyInMemory) return globalForKey.openaiKeyInMemory;
  const settings = await getSettings();
  if (settings.openaiKeyStorageMode === "encrypted" && settings.openaiApiKeyEncrypted) {
    try {
      const key = decryptSecret(settings.openaiApiKeyEncrypted);
      globalForKey.openaiKeyInMemory = key;
      return key;
    } catch (err) {
      logger.error({ err }, "Sifreli OpenAI anahtari cozulemedi");
      return null;
    }
  }
  return process.env.OPENAI_API_KEY?.trim() || null;
}

/** Anahtarin nereden geldigini ve maskeli halini dondurur (arayuz icin). */
export async function describeOpenAiKey(): Promise<{ present: boolean; source: string; masked: string; storageMode: string }> {
  const settings = await getSettings();
  const key = await resolveOpenAiKey();
  const { maskApiKey } = await import("@/server/lib/mask");
  let source = "yok";
  if (globalForKey.openaiKeyInMemory) source = settings.openaiKeyStorageMode === "encrypted" ? "sifreli-db" : "bellek";
  else if (process.env.OPENAI_API_KEY) source = "env";
  return {
    present: !!key,
    source,
    masked: maskApiKey(key),
    storageMode: settings.openaiKeyStorageMode,
  };
}

/* ------------------------------------------------------------------ */
/* Seslendirme (TTS) anahtarlari                                       */
/* ------------------------------------------------------------------ */

export type TtsSecretKind = "google" | "azure" | "elevenlabs";

/**
 * Seslendirme alanlarinin dar gorunumu.
 *
 * Prisma istemcisi calisan sunucu tarafindan kilitliyken yeniden uretilemedigi
 * icin bu alanlar AppSettings tipinde henuz gorunmuyor olabilir; okuma bu
 * gorunum uzerinden yapilir ve varsayilanlar burada uygulanir.
 */
export interface TtsSettingsView {
  ttsProvider: string;
  googleTtsKeyEncrypted: string | null;
  azureSpeechKeyEncrypted: string | null;
  azureSpeechRegion: string;
  elevenLabsKeyEncrypted: string | null;
  elevenLabsVoiceId: string;
  piperPython: string;
  piperModelDir: string;
}

export function ttsSettingsView(settings: AppSettings): TtsSettingsView {
  const row = settings as unknown as Partial<TtsSettingsView>;
  return {
    ttsProvider: row.ttsProvider?.trim() || "openai",
    googleTtsKeyEncrypted: row.googleTtsKeyEncrypted ?? null,
    azureSpeechKeyEncrypted: row.azureSpeechKeyEncrypted ?? null,
    azureSpeechRegion: row.azureSpeechRegion?.trim() || "westeurope",
    elevenLabsKeyEncrypted: row.elevenLabsKeyEncrypted ?? null,
    elevenLabsVoiceId: row.elevenLabsVoiceId?.trim() || "",
    piperPython: row.piperPython?.trim() || "python",
    piperModelDir: row.piperModelDir?.trim() || "",
  };
}

const TTS_SECRET_FIELDS: Record<TtsSecretKind, keyof TtsSettingsView> = {
  google: "googleTtsKeyEncrypted",
  azure: "azureSpeechKeyEncrypted",
  elevenlabs: "elevenLabsKeyEncrypted",
};

const TTS_ENV_FALLBACK: Record<TtsSecretKind, string> = {
  google: "GOOGLE_TTS_API_KEY",
  azure: "AZURE_SPEECH_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};

/**
 * Sifreli anahtari cozer. Bulunamazsa .env yedegine bakar; boylece anahtari
 * arayuze girmeden de calistirmak mumkun.
 */
export function ttsSecret(settings: AppSettings, kind: TtsSecretKind): string | null {
  const stored = ttsSettingsView(settings)[TTS_SECRET_FIELDS[kind]];
  if (typeof stored === "string" && stored.trim()) {
    try {
      return decryptSecret(stored);
    } catch (err) {
      logger.error({ err, kind }, "Sifreli TTS anahtari cozulemedi");
    }
  }
  return process.env[TTS_ENV_FALLBACK[kind]]?.trim() || null;
}

/** Anahtari sifreleyip kaydeder; bos deger anahtari siler. */
export async function setTtsSecret(kind: TtsSecretKind, value: string): Promise<void> {
  await getSettings();
  const trimmed = value.trim();
  const data = { [TTS_SECRET_FIELDS[kind]]: trimmed ? encryptSecret(trimmed) : null };
  await prisma.appSettings.update({
    where: { id: 1 },
    data: data as Parameters<typeof prisma.appSettings.update>[0]["data"],
  });
}

/** Arayuz icin: hangi saglayicilarin anahtari hazir (maskesiz deger donmez). */
export function describeTtsSecrets(settings: AppSettings): Record<TtsSecretKind, boolean> {
  return {
    google: !!ttsSecret(settings, "google"),
    azure: !!ttsSecret(settings, "azure"),
    elevenlabs: !!ttsSecret(settings, "elevenlabs"),
  };
}

/** Suno API anahtari ayarla; bos deger siler. */
export async function setSunoSecret(value: string): Promise<void> {
  await getSettings();
  const trimmed = value.trim();
  await prisma.appSettings.update({
    where: { id: 1 },
    data: { sunoApiKeyEncrypted: trimmed ? encryptSecret(trimmed) : null } as Parameters<
      typeof prisma.appSettings.update
    >[0]["data"],
  });
}

export async function resolveSunoApiKey(): Promise<string | null> {
  const fromEnv = process.env.SUNO_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const settings = await getSettings();
  const row = settings as unknown as { sunoApiKeyEncrypted?: string | null };
  if (row.sunoApiKeyEncrypted) {
    try {
      return decryptSecret(row.sunoApiKeyEncrypted);
    } catch (err) {
      logger.error({ err }, "Suno API anahtari cozulemedi");
    }
  }
  return null;
}

export async function describeSunoKey(): Promise<{ present: boolean; baseUrl: string; defaultModel: string }> {
  const settings = await getSettings();
  const row = settings as unknown as { sunoApiBaseUrl?: string; sunoDefaultModel?: string; sunoApiKeyEncrypted?: string | null };
  return {
    present: !!(await resolveSunoApiKey()),
    baseUrl: row.sunoApiBaseUrl?.trim() || process.env.SUNO_API_BASE_URL?.trim() || "https://api.kie.ai",
    defaultModel: row.sunoDefaultModel?.trim() || "V4_5",
  };
}

/** Konusma hizina gore dakikadaki kelime sayisi. */
export function wpmForPace(settings: AppSettings, pace: string): number {
  if (pace === "slow") return settings.wpmSlow;
  if (pace === "fast") return settings.wpmFast;
  return settings.wpmNormal;
}

/**
 * DB matrisi ile varsayilani birlestirir.
 * - Varsayilan modeller HICBIR ZAMAN dusmez (Omni eklenince digerleri kaybolmaz)
 * - DB'deki ayni anahtar varsayilani ezer (kullanici ozellestirmesi)
 * - DB'deki ekstra modeller korunur
 */
export function mergeModelSupportMatrix(stored: Record<string, ModelSupport> | null | undefined): Record<string, ModelSupport> {
  const merged: Record<string, ModelSupport> = { ...DEFAULT_MODEL_SUPPORT_MATRIX };
  if (!stored || typeof stored !== "object") return merged;
  for (const [name, support] of Object.entries(stored)) {
    if (!name.trim() || !support || typeof support !== "object") continue;
    const durations = Array.isArray(support.durations)
      ? support.durations.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : merged[name]?.durations ?? [4, 6, 8];
    const aspectRatios = Array.isArray(support.aspectRatios)
      ? support.aspectRatios.map(String).filter(Boolean)
      : merged[name]?.aspectRatios ?? ["16:9", "9:16"];
    merged[name] = {
      durations: durations.length > 0 ? durations : [4, 6, 8],
      aspectRatios: aspectRatios.length > 0 ? aspectRatios : ["16:9", "9:16"],
      supportsReference: Boolean(support.supportsReference),
      supportsAudio: support.supportsAudio !== false,
      supportsStartFrame: Boolean(support.supportsStartFrame),
    };
  }
  return merged;
}

export function parseModelSupportMatrix(settings: AppSettings): Record<string, ModelSupport> {
  try {
    const parsed = JSON.parse(settings.modelSupportMatrix || "{}") as Record<string, ModelSupport>;
    return mergeModelSupportMatrix(parsed);
  } catch {
    return { ...DEFAULT_MODEL_SUPPORT_MATRIX };
  }
}

/** Secici listesi: kanonik modeller + matristeki ekstra adlar (tireli varyantlar haric tekrar yok). */
export function listSelectableFlowModels(matrix: Record<string, ModelSupport>): string[] {
  const ordered: string[] = [...KNOWN_FLOW_MODELS];
  for (const name of Object.keys(matrix)) {
    if (ordered.includes(name)) continue;
    // Tireli alias'lari ayri secenek olarak gosterme (ayni model)
    if (/^\s*Veo 3\.1\s*-\s*(Lite|Fast|Quality)\s*$/i.test(name)) continue;
    if (/^\s*Gemini\s*-\s*Omni Flash\s*$/i.test(name)) continue;
    ordered.push(name);
  }
  return ordered;
}

/**
 * Secilen model/sure/oran/ozellik kombinasyonunu dogrular.
 * Matriste olmayan (kullanici tanimli) modeller icin uyari dondurur ama engellemez.
 */
export function validateFlowConfig(
  matrix: Record<string, ModelSupport>,
  config: { model: string; clipSeconds: number; aspectRatio: string; useReference: boolean; useStartFrame: boolean }
): { ok: boolean; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const support = resolveModelSupport(matrix, config.model);
  if (!support) {
    warnings.push(`"${config.model}" destek matrisinde tanimli degil; dogrulama atlandi. Ayarlar > Model Destek Matrisi'nden ekleyebilirsiniz.`);
    return { ok: true, warnings, errors };
  }
  if (!support.durations.includes(config.clipSeconds)) {
    errors.push(`"${config.model}" ${config.clipSeconds} saniyelik klip desteklemiyor. Desteklenen: ${support.durations.join(", ")} sn`);
  }
  if (!support.aspectRatios.includes(config.aspectRatio)) {
    errors.push(`"${config.model}" ${config.aspectRatio} oranini desteklemiyor. Desteklenen: ${support.aspectRatios.join(", ")}`);
  }
  if (config.useReference && !support.supportsReference) {
    errors.push(`"${config.model}" referans gorseli desteklemiyor.`);
  }
  if (config.useStartFrame && !support.supportsStartFrame) {
    errors.push(`"${config.model}" baslangic karesi desteklemiyor.`);
  }
  return { ok: errors.length === 0, warnings, errors };
}

/** Model adini tireli/tiresiz varyantlarla eslestirerek destek kaydini bulur. */
export function resolveModelSupport(matrix: Record<string, ModelSupport>, modelName: string): ModelSupport | null {
  const raw = modelName.trim();
  if (!raw) return null;
  if (matrix[raw]) return matrix[raw];
  const norm = raw.replace(/\s+/g, " ").toLowerCase();
  for (const [key, value] of Object.entries(matrix)) {
    if (key.replace(/\s+/g, " ").toLowerCase() === norm) return value;
  }
  // "Veo 3.1 - Fast" <-> "Veo 3.1 Fast"
  const stripped = norm.replace(/\s*-\s*/g, " ");
  for (const [key, value] of Object.entries(matrix)) {
    if (key.replace(/\s+/g, " ").replace(/\s*-\s*/g, " ").toLowerCase() === stripped) return value;
  }
  return null;
}

/** Model degisince desteklenmeyen sure/ref ayarlarini guvenli degerlere ceker. */
export function clampConfigToModelSupport(
  support: ModelSupport,
  config: { clipSeconds: number; aspectRatio: string; useReference: boolean; useStartFrame: boolean; usePrevLastFrame: boolean }
): typeof config {
  let clipSeconds = config.clipSeconds;
  if (!support.durations.includes(clipSeconds)) {
    clipSeconds = support.durations.includes(8)
      ? 8
      : support.durations[support.durations.length - 1] ?? 8;
  }
  let aspectRatio = config.aspectRatio;
  if (!support.aspectRatios.includes(aspectRatio)) {
    aspectRatio = support.aspectRatios[0] ?? "16:9";
  }
  const useReference = support.supportsReference ? config.useReference : false;
  const useStartFrame = support.supportsStartFrame ? config.useStartFrame : false;
  const usePrevLastFrame = support.supportsStartFrame ? config.usePrevLastFrame : false;
  return { clipSeconds, aspectRatio, useReference, useStartFrame, usePrevLastFrame };
}

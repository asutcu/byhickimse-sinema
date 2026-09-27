import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@/server/db";
import { structuredCall } from "@/server/services/openai";
import { buildSrtContent, buildSrtCues, type SrtCue } from "@/server/services/srt";
import { selectClipsForRender } from "@/server/services/render";
import { ensureProjectDirs } from "@/server/lib/paths";
import { recordEvent } from "@/server/lib/logger";

/**
 * YouTube soft altyazi paketi (TR / EN / DE / FR / ES / AR).
 * Hiz: diller paralel + batch'ler paralel + hizli model (gpt-4o-mini).
 */

export const YOUTUBE_SUBTITLE_LANGS = [
  { code: "tr", name: "Türkçe", fileLabel: "turkce", youtube: "Turkish" },
  { code: "en", name: "English", fileLabel: "english", youtube: "English" },
  { code: "de", name: "Deutsch", fileLabel: "almanca", youtube: "German" },
  { code: "fr", name: "Français", fileLabel: "fransizca", youtube: "French" },
  { code: "es", name: "Español", fileLabel: "ispanyolca", youtube: "Spanish" },
  { code: "ar", name: "العربية", fileLabel: "arapca", youtube: "Arabic" },
] as const;

export type YoutubeSubtitleCode = (typeof YOUTUBE_SUBTITLE_LANGS)[number]["code"];

export const YOUTUBE_SUBTITLE_LANG_COUNT = YOUTUBE_SUBTITLE_LANGS.length;

export interface YoutubeSubtitleFile {
  code: YoutubeSubtitleCode;
  name: string;
  youtube: string;
  path: string;
  downloadName: string;
  cueCount: number;
  skippedTranslation?: boolean;
  fromCache?: boolean;
}

export interface YoutubeSubtitleLangError {
  code: YoutubeSubtitleCode;
  name: string;
  message: string;
}

/** Sirali metin dizisi — index tasiyamadan hizli ceviri. */
const orderedTextsSchema = z.object({
  texts: z.array(z.string()),
});

/** Altyazi cevirisi icin hizli model (ana hikaye modelinden bagimsiz). */
const FAST_TRANSLATE_MODEL = "gpt-4o-mini";
const TRANSLATE_CHUNK = 40;

function detectSourceLangCode(speechLanguage: string): YoutubeSubtitleCode {
  const s = speechLanguage.toLowerCase();
  if (/engl|ingiliz/.test(s)) return "en";
  if (/deut|german|alman/.test(s)) return "de";
  if (/fran|fransiz|french/.test(s)) return "fr";
  if (/span|espa|ispan/.test(s)) return "es";
  if (/arab|arap|عربي|عرب/.test(s)) return "ar";
  return "tr";
}

/** Final render ile ayni klip sirasi + sureler. */
export async function loadPrimaryClipsForSubtitles(projectId: string) {
  const all = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  const { included } = selectClipsForRender(all);
  if (included.length === 0) {
    throw new Error("Altyazi icin videosu olan klip yok — once klipleri uretin / final ile ayni set gerekli.");
  }
  const byIndex = new Map(all.map((c) => [c.index, c]));
  return included.map((row) => {
    const clip = byIndex.get(row.index)!;
    return {
      index: clip.index,
      dialogue: clip.dialogue.trim(),
      durationSeconds: clip.actualDurationSeconds ?? clip.estimatedDurationSeconds ?? 8,
    };
  });
}

async function translateBatchOrdered(
  batch: SrtCue[],
  target: (typeof YOUTUBE_SUBTITLE_LANGS)[number],
  sourceLabel: string,
  model: string | undefined = FAST_TRANSLATE_MODEL
): Promise<string[]> {
  const lines = batch.map((c, i) => `${i + 1}. ${c.text.replace(/\n/g, " ")}`).join("\n");
  const langHint =
    target.code === "ar"
      ? "Use Modern Standard Arabic (MSA) in Arabic script; natural kid-safe spoken captions; short lines."
      : `Natural spoken ${target.name}, kid-safe, no speaker names, no brackets. Keep short for captions.`;
  try {
    const result = await structuredCall<z.infer<typeof orderedTextsSchema>>({
      system: `Fast subtitle translator. Target: ${target.name} (${target.youtube}). Source: ${sourceLabel}.
Return ONLY JSON { "texts": string[] } with EXACTLY ${batch.length} strings in the SAME order.
${langHint}`,
      user: `Translate ${batch.length} cues to ${target.name}:\n${lines}`,
      schemaName: `srt_fast_${target.code}`,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          texts: { type: "array", items: { type: "string" } },
        },
        required: ["texts"],
      },
      zodSchema: orderedTextsSchema,
      ...(model ? { model } : {}),
      maxOutputTokens: 8_000,
      reasoningEffort: "minimal",
      timeoutMs: 90_000,
    });

    if (result.texts.length !== batch.length) {
      const texts = result.texts.map((t) => t.replace(/\s+/g, " ").trim());
      while (texts.length < batch.length) texts.push(batch[texts.length].text);
      return texts.slice(0, batch.length).map((t, i) => t || batch[i].text);
    }
    return result.texts.map((t, i) => t.replace(/\s+/g, " ").trim() || batch[i].text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (model === FAST_TRANSLATE_MODEL && /model|not found|does not exist|unsupported/i.test(msg)) {
      return translateBatchOrdered(batch, target, sourceLabel, undefined);
    }
    throw err;
  }
}

/** Tum batch'leri paralel cevir — tek dil icin birkac saniye. */
async function translateCueTextsFast(
  cues: SrtCue[],
  target: (typeof YOUTUBE_SUBTITLE_LANGS)[number],
  sourceLabel: string
): Promise<SrtCue[]> {
  if (cues.length === 0) return [];

  const batches: SrtCue[][] = [];
  for (let i = 0; i < cues.length; i += TRANSLATE_CHUNK) {
    batches.push(cues.slice(i, i + TRANSLATE_CHUNK));
  }

  const parts = await Promise.all(
    batches.map(async (batch) => {
      try {
        return await translateBatchOrdered(batch, target, sourceLabel);
      } catch {
        // Tek batch dustuyse bir kez daha dene
        return translateBatchOrdered(batch, target, sourceLabel);
      }
    })
  );

  const flat = parts.flat();
  return cues.map((c, i) => ({ ...c, text: flat[i] || c.text }));
}

function subtitlePath(slug: string, fileLabel: string): { downloadName: string; filePath: string; outDir: string } {
  const root = ensureProjectDirs(slug);
  const outDir = path.join(root, "output", "publish", "subtitles");
  fs.mkdirSync(outDir, { recursive: true });
  const downloadName = `youtube-altyazi-${fileLabel}.srt`;
  return { downloadName, filePath: path.join(outDir, downloadName), outDir };
}

async function writeSubtitleFile(
  projectId: string,
  slug: string,
  lang: (typeof YOUTUBE_SUBTITLE_LANGS)[number],
  cues: SrtCue[],
  sourceLang: YoutubeSubtitleCode,
  extra?: { skippedTranslation?: boolean; fromCache?: boolean }
): Promise<YoutubeSubtitleFile> {
  const { downloadName, filePath } = subtitlePath(slug, lang.fileLabel);
  const content = buildSrtContent(cues);
  fs.writeFileSync(filePath, `\uFEFF${content}`, "utf8");

  await prisma.generatedAsset.create({
    data: {
      projectId,
      kind: "srt",
      path: filePath,
      bytes: Buffer.byteLength(content, "utf8"),
      languageVariant: lang.code,
      meta: JSON.stringify({
        youtubeLanguage: lang.youtube,
        code: lang.code,
        downloadName,
        cueCount: cues.length,
        sourceLang,
        fastModel: FAST_TRANSLATE_MODEL,
      }),
    },
  });

  return {
    code: lang.code,
    name: lang.name,
    youtube: lang.youtube,
    path: filePath,
    downloadName,
    cueCount: cues.length,
    skippedTranslation: extra?.skippedTranslation,
    fromCache: extra?.fromCache,
  };
}

/**
 * TR / EN / DE / ES / AR SRT paketi.
 * Kaynak dil aninda yazilir; diger diller PARALEL cevrilir (gpt-4o-mini).
 */
export async function generateYoutubeSubtitlePack(
  projectId: string,
  options?: { force?: boolean; onlyMissing?: boolean }
): Promise<{
  files: YoutubeSubtitleFile[];
  errors: YoutubeSubtitleLangError[];
  cueCount: number;
  sourceLang: YoutubeSubtitleCode;
  complete: boolean;
}> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const sourceLang = detectSourceLangCode(project.speechLanguage || "Türkçe");
  const sourceLabel =
    YOUTUBE_SUBTITLE_LANGS.find((l) => l.code === sourceLang)?.name || project.speechLanguage || "Türkçe";

  const clips = await loadPrimaryClipsForSubtitles(projectId);
  const baseCues = buildSrtCues(clips);
  if (baseCues.length === 0) {
    throw new Error("Altyazi kuyrugu bos — diyalog metni olan klipler gerekli.");
  }

  const force = options?.force === true;
  const onlyMissing = options?.onlyMissing !== false;

  await recordEvent({
    projectId,
    step: "publish",
    message: `YouTube altyazi HIZLI paket: ${baseCues.length} kuyruk, model=${FAST_TRANSLATE_MODEL}, paralel EN/DE/ES/AR`,
  });

  const files: YoutubeSubtitleFile[] = [];
  const errors: YoutubeSubtitleLangError[] = [];

  const langsToBuild = YOUTUBE_SUBTITLE_LANGS.filter((lang) => {
    const { filePath } = subtitlePath(project.slug, lang.fileLabel);
    if (!force && onlyMissing && fs.existsSync(filePath) && fs.statSync(filePath).size > 40) {
      files.push({
        code: lang.code,
        name: lang.name,
        youtube: lang.youtube,
        path: filePath,
        downloadName: `youtube-altyazi-${lang.fileLabel}.srt`,
        cueCount: baseCues.length,
        fromCache: true,
      });
      return false;
    }
    return true;
  });

  // Kaynak dil once (ceviri yok) — hizli yaz
  const sourceLangDef = langsToBuild.find((l) => l.code === sourceLang);
  const translateLangs = langsToBuild.filter((l) => l.code !== sourceLang);

  if (sourceLangDef) {
    try {
      files.push(
        await writeSubtitleFile(projectId, project.slug, sourceLangDef, baseCues, sourceLang, {
          skippedTranslation: true,
        })
      );
    } catch (err) {
      errors.push({
        code: sourceLangDef.code,
        name: sourceLangDef.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // EN + DE + ES + AR ayni anda
  if (translateLangs.length > 0) {
    await recordEvent({
      projectId,
      step: "publish",
      message: `Paralel ceviri: ${translateLangs.map((l) => l.name).join(", ")}`,
    });

    const results = await Promise.all(
      translateLangs.map(async (lang) => {
        try {
          const cues = await translateCueTextsFast(baseCues, lang, sourceLabel);
          const file = await writeSubtitleFile(projectId, project.slug, lang, cues, sourceLang);
          return { ok: true as const, file };
        } catch (err) {
          return {
            ok: false as const,
            code: lang.code,
            name: lang.name,
            message: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    for (const r of results) {
      if (r.ok) files.push(r.file);
      else {
        errors.push({ code: r.code, name: r.name, message: r.message });
        await recordEvent({
          projectId,
          step: "publish",
          level: "error",
          message: `Altyazi basarisiz (${r.name}): ${r.message}`,
        });
      }
    }
  }

  // Disk artiklari
  for (const lang of YOUTUBE_SUBTITLE_LANGS) {
    if (files.some((f) => f.code === lang.code)) continue;
    const { downloadName, filePath } = subtitlePath(project.slug, lang.fileLabel);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 40) {
      files.push({
        code: lang.code,
        name: lang.name,
        youtube: lang.youtube,
        path: filePath,
        downloadName,
        cueCount: baseCues.length,
        fromCache: true,
      });
    }
  }

  files.sort(
    (a, b) =>
      YOUTUBE_SUBTITLE_LANGS.findIndex((l) => l.code === a.code) -
      YOUTUBE_SUBTITLE_LANGS.findIndex((l) => l.code === b.code)
  );

  const complete = YOUTUBE_SUBTITLE_LANGS.every((l) => files.some((f) => f.code === l.code));

  await recordEvent({
    projectId,
    step: "publish",
    level: complete ? "info" : "warning",
    message: complete
      ? `YouTube altyazi paketi hazir: ${files.map((f) => f.downloadName).join(", ")}`
      : `YouTube altyazi KISMI: ${files.map((f) => f.code).join(", ")}; hatalar: ${errors.map((e) => e.code).join(", ")}`,
  });

  if (files.length === 0) {
    throw new Error(`Hicbir altyazi dosyasi uretilemedi. ${errors[0]?.message ?? ""}`);
  }

  return { files, errors, cueCount: baseCues.length, sourceLang, complete };
}

/** Diskteki son altyazi paketini listeler. */
export function listYoutubeSubtitleFiles(projectIdSlug: string): YoutubeSubtitleFile[] {
  const outDir = path.join(ensureProjectDirs(projectIdSlug), "output", "publish", "subtitles");
  if (!fs.existsSync(outDir)) return [];
  const files: YoutubeSubtitleFile[] = [];
  for (const lang of YOUTUBE_SUBTITLE_LANGS) {
    const downloadName = `youtube-altyazi-${lang.fileLabel}.srt`;
    const filePath = path.join(outDir, downloadName);
    if (!fs.existsSync(filePath)) continue;
    files.push({
      code: lang.code,
      name: lang.name,
      youtube: lang.youtube,
      path: filePath,
      downloadName,
      cueCount: 0,
    });
  }
  return files;
}

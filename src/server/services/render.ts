import fs from "node:fs";
import { prisma } from "@/server/db";
import {
  mergeClips,
  mixBackgroundMusic,
  probeVideo,
  FfmpegCancelledError,
  type MergeOptions,
  type VideoInfo,
} from "@/server/services/ffmpeg";
import { ensureProjectDirs, nextAvailablePath, relocateStoredProjectFile, safeProjectPath } from "@/server/lib/paths";
import { recordEvent } from "@/server/lib/logger";
import { publishEvent } from "@/server/lib/events";
import {
  countActiveRenderJobs,
  createRenderJob,
  finishRenderJob,
  getRenderJobPreviousStatus,
  listRenderJobs,
  RenderCancelledError,
  setRenderJobOutput,
  type RenderJobPublic,
} from "@/server/services/render-jobs";

/**
 * Final video render sureci: tamamlanan klipleri siraya gore birlestirir,
 * kalite raporu uretir.
 */

export interface QualityReport {
  outputPath: string;
  totalDurationSeconds: number;
  fileSizeBytes: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  clipCount: number;
  skippedClipCount: number;
  /** Final'e girmeyen klip indexleri (or. oncesine eklenen henuz uretilmemis) */
  skippedIndexes: number[];
  /** Final'e giren klip indexleri sirayla */
  includedIndexes: number[];
  mode: "direct" | "reencode";
  warnings: string[];
  jobId?: string;
  /** Kullanicinin sectigi hedef: source | 1080 | 1440 | 2160 */
  outputResolution?: string;
}

export interface FinalRenderSummary {
  path: string;
  fileName: string;
  bytes: number;
  createdAt: string;
  mode: "direct" | "reencode" | string;
  outputResolution: string;
  width: number | null;
  height: number | null;
}

/** Vide belgesi olan klipleri final'e al — status tutarsizliginda da dosya varsa dahil et. */
export function selectClipsForRender(
  clips: Array<{
    index: number;
    status: string;
    videoPath: string | null;
  }>
): {
  included: Array<{ index: number; status: string; videoPath: string }>;
  skipped: Array<{ index: number; reason: string }>;
} {
  const included: Array<{ index: number; status: string; videoPath: string }> = [];
  const skipped: Array<{ index: number; reason: string }> = [];

  for (const c of clips) {
    const videoPath = relocateStoredProjectFile(c.videoPath);
    if (!c.videoPath) {
      skipped.push({ index: c.index, reason: "video yok" });
      continue;
    }
    if (!videoPath) {
      skipped.push({ index: c.index, reason: "dosya bulunamadi" });
      continue;
    }
    let size = 0;
    try {
      size = fs.statSync(videoPath).size;
    } catch {
      skipped.push({ index: c.index, reason: "dosya okunamadi" });
      continue;
    }
    if (size < 40_000) {
      skipped.push({ index: c.index, reason: "dosya cok kucuk" });
      continue;
    }
    // Video dosyasi varsa final'e al (status draft kalsa bile — oncesine sahne sonrasi kurtarma)
    included.push({ index: c.index, status: c.status, videoPath });
  }

  return { included, skipped };
}

/** Final'e giren kliplerin konusma metni — gomulu altyazi icin ayni sira. */
export function clipDialoguesForRender(
  included: Array<{ index: number }>,
  clips: Array<{ index: number; dialogue: string | null | undefined }>
): string[] {
  const byIndex = new Map(clips.map((c) => [c.index, (c.dialogue || "").trim()]));
  return included.map((c) => byIndex.get(c.index) || "");
}

function isCancelError(err: unknown): boolean {
  return err instanceof FfmpegCancelledError || err instanceof RenderCancelledError;
}

async function settleProjectStatusAfterJob(
  projectId: string,
  jobId: string,
  outcome: "completed" | "cancelled" | "failed"
): Promise<void> {
  if (countActiveRenderJobs(projectId, jobId) > 0) {
    // Baska birlestirme hala kosuyor — proje durumunu bozma
    await prisma.project.update({ where: { id: projectId }, data: { status: "rendering" } });
    publishEvent(projectId, { type: "project", payload: { id: projectId, status: "rendering" } });
    return;
  }

  if (outcome === "completed") {
    await prisma.project.update({ where: { id: projectId }, data: { status: "completed" } });
    publishEvent(projectId, { type: "project", payload: { id: projectId, status: "completed" } });
    return;
  }

  if (outcome === "cancelled") {
    const prev = getRenderJobPreviousStatus(jobId) || "clips_done";
    const restore = prev === "rendering" ? "clips_done" : prev;
    await prisma.project.update({ where: { id: projectId }, data: { status: restore } });
    publishEvent(projectId, { type: "project", payload: { id: projectId, status: restore } });
    return;
  }

  await prisma.project.update({ where: { id: projectId }, data: { status: "render_failed" } });
  publishEvent(projectId, { type: "project", payload: { id: projectId, status: "render_failed" } });
}

function safeUnlinkPartial(outputPath: string): void {
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch {
    /* ignore */
  }
}

export async function renderProject(projectId: string, options: MergeOptions): Promise<QualityReport> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const allClips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  const { included, skipped } = selectClipsForRender(allClips);
  if (included.length === 0) throw new Error("Birlestirilecek tamamlanmis klip yok");

  const warnings: string[] = [];
  const skippedIndexes = skipped.map((s) => s.index);
  const includedIndexes = included.map((c) => c.index);

  if (skipped.length > 0) {
    const detail = skipped
      .slice(0, 12)
      .map((s) => `#${s.index} (${s.reason})`)
      .join(", ");
    const msg = `${skipped.length} klip birlestirmeye dahil edilmeyecek: ${detail}`;
    warnings.push(msg);
    await recordEvent({
      projectId,
      step: "render",
      level: "warning",
      message: msg,
    });
  }

  if (includedIndexes[0] != null && includedIndexes[0] > 1) {
    const gap = Array.from({ length: includedIndexes[0] - 1 }, (_, i) => i + 1);
    const gapMsg = `Final #${includedIndexes[0]}'den basliyor — onceki sahneler (#${gap.join(", #")}) henuz uretilmemis veya videosu yok. Oncesine eklenen sahneleri otomasyonda tamamlayin.`;
    warnings.push(gapMsg);
    await recordEvent({ projectId, step: "render", level: "warning", message: gapMsg });
  }

  // Sirada kopukluk (or. 1,2,5) — yine uyar
  for (let i = 1; i < includedIndexes.length; i++) {
    if (includedIndexes[i] !== includedIndexes[i - 1] + 1) {
      warnings.push(
        `Klip sirasinda bosluk: #${includedIndexes[i - 1]} sonrasi #${includedIndexes[i]} (aradaki sahneler atlandi)`
      );
      break;
    }
  }

  const burnSubtitles = Boolean(options.burnSubtitles);
  const mergeOptions: MergeOptions = {
    ...options,
    burnSubtitles,
    clipDialogues: burnSubtitles ? clipDialoguesForRender(included, allClips) : undefined,
  };

  const { jobId, signal } = createRenderJob(projectId, mergeOptions, project.status, included.length);

  await recordEvent({
    projectId,
    step: "render",
    message: `Final birlestirme [#${jobId.slice(0, 8)}]: ${includedIndexes.length} klip (#${includedIndexes[0]}…#${includedIndexes[includedIndexes.length - 1]}), cozunurluk=${options.outputResolution ?? "source"}${burnSubtitles ? ", gomulu altyazi" : ""}`,
  });

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "rendering", allowSubtitles: burnSubtitles },
  });
  publishEvent(projectId, { type: "project", payload: { id: projectId, status: "rendering" } });

  ensureProjectDirs(project.slug);
  const outputPath = nextAvailablePath(safeProjectPath(project.slug, "output", "final.mp4"));
  setRenderJobOutput(jobId, outputPath);

  try {
    const result = await mergeClips(
      included.map((c) => c.videoPath),
      outputPath,
      mergeOptions,
      projectId,
      { signal, renderJobId: jobId }
    );

    const allWarnings = [...warnings, ...result.warnings];

    if (project.templateType === "time_travel") {
      const { parseTimeTravelSettings } = await import("@/lib/time-travel");
      const musicName = parseTimeTravelSettings(project.timeTravelSettings).musicFileName.trim();
      if (musicName) {
        const { listLocalMusicFiles } = await import("@/server/services/longform");
        const music = listLocalMusicFiles(project.slug).find((f) => f.fileName === musicName);
        if (music) {
          result.info = await mixBackgroundMusic(result.outputPath, music.path, { signal, renderJobId: jobId });
          await recordEvent({ projectId, step: "render", message: `Arka plan muzigi eklendi: ${music.fileName}` });
        } else {
          const msg = `Secili muzik bulunamadi (${musicName}) — final muziksiz birakildi. Dosyayi music klasorune koyun.`;
          allWarnings.push(msg);
          await recordEvent({ projectId, step: "render", level: "warning", message: msg });
        }
      }
    }

    await prisma.generatedAsset.create({
      data: {
        projectId,
        kind: "final_video",
        path: result.outputPath,
        bytes: result.info.sizeBytes,
        meta: JSON.stringify({
          mode: result.mode,
          clipCount: result.clipCount,
          warnings: allWarnings,
          includedIndexes,
          skippedIndexes,
          outputResolution: options.outputResolution ?? "source",
          jobId,
        }),
      },
    });

    finishRenderJob(jobId, "completed", { outputPath: result.outputPath });
    await settleProjectStatusAfterJob(projectId, jobId, "completed");

    return {
      ...buildQualityReport(
        result.outputPath,
        result.info,
        included.length,
        skipped.length,
        result.mode,
        allWarnings,
        includedIndexes,
        skippedIndexes,
        options.outputResolution ?? "source"
      ),
      jobId,
    };
  } catch (err) {
    if (isCancelError(err)) {
      safeUnlinkPartial(outputPath);
      finishRenderJob(jobId, "cancelled");
      await settleProjectStatusAfterJob(projectId, jobId, "cancelled");
      await recordEvent({
        projectId,
        step: "render",
        level: "warning",
        message: `Birlestirme iptal edildi (#${jobId.slice(0, 8)}) — diger isler etkilenmedi`,
      });
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    finishRenderJob(jobId, "failed", { errorMessage: message });
    await settleProjectStatusAfterJob(projectId, jobId, "failed");
    throw err;
  }
}

export function getProjectRenderJobs(projectId: string): RenderJobPublic[] {
  return listRenderJobs(projectId);
}

function buildQualityReport(
  outputPath: string,
  info: VideoInfo,
  clipCount: number,
  skippedClipCount: number,
  mode: "direct" | "reencode",
  warnings: string[],
  includedIndexes: number[] = [],
  skippedIndexes: number[] = [],
  outputResolution: string = "source"
): QualityReport {
  return {
    outputPath,
    totalDurationSeconds: info.durationSeconds,
    fileSizeBytes: info.sizeBytes,
    width: info.width,
    height: info.height,
    fps: info.fps,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    clipCount,
    skippedClipCount,
    skippedIndexes,
    includedIndexes,
    mode,
    warnings,
    outputResolution,
  };
}

function resolutionLabelFromSize(width: number, height: number): string {
  const short = Math.min(width, height);
  if (short >= 2100) return "2160";
  if (short >= 1400) return "1440";
  if (short >= 1000) return "1080";
  return "source";
}

/** Son final videolarin ozeti (QHD/1080 vs kaynak karisikligini ayirt etmek icin). */
export async function listFinalRenders(projectId: string, limit = 8): Promise<FinalRenderSummary[]> {
  const assets = await prisma.generatedAsset.findMany({
    where: { projectId, kind: "final_video" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const out: FinalRenderSummary[] = [];
  for (const asset of assets) {
    const assetPath = relocateStoredProjectFile(asset.path);
    if (!assetPath) continue;
    const meta = JSON.parse(asset.meta || "{}") as {
      mode?: string;
      outputResolution?: string;
    };
    let width: number | null = null;
    let height: number | null = null;
    let outputResolution = meta.outputResolution ?? "source";
    try {
      const info = await probeVideo(assetPath);
      width = info.width;
      height = info.height;
      if (!meta.outputResolution || meta.outputResolution === "source") {
        // Eski kayitlarda meta eksik olabilir — gercek boyuttan tahmin
        const guessed = resolutionLabelFromSize(info.width, info.height);
        if (guessed !== "source") outputResolution = guessed;
      }
    } catch {
      /* probe basarisizsa meta ile devam */
    }
    out.push({
      path: assetPath,
      fileName: assetPath.split(/[/\\]/).pop() || assetPath,
      bytes: asset.bytes,
      createdAt: asset.createdAt.toISOString(),
      mode: meta.mode ?? "direct",
      outputResolution,
      width,
      height,
    });
  }
  return out;
}

/** Mevcut final videonun kalite raporunu getirir. */
export async function getLatestRenderReport(projectId: string): Promise<QualityReport | null> {
  const asset = await prisma.generatedAsset.findFirst({
    where: { projectId, kind: "final_video" },
    orderBy: { createdAt: "desc" },
  });
  if (!asset || !fs.existsSync(asset.path)) return null;
  const info = await probeVideo(asset.path);
  const meta = JSON.parse(asset.meta || "{}") as {
    mode?: "direct" | "reencode";
    clipCount?: number;
    warnings?: string[];
    includedIndexes?: number[];
    skippedIndexes?: number[];
    outputResolution?: string;
  };
  const clipCount = meta.clipCount ?? 0;
  const totalClips = await prisma.clip.count({ where: { projectId, languageVariant: "primary" } });
  const skippedIndexes = meta.skippedIndexes ?? [];
  const includedIndexes = meta.includedIndexes ?? [];
  const outputResolution =
    meta.outputResolution && meta.outputResolution !== "source"
      ? meta.outputResolution
      : resolutionLabelFromSize(info.width, info.height);
  return buildQualityReport(
    asset.path,
    info,
    clipCount,
    skippedIndexes.length || Math.max(0, totalClips - clipCount),
    meta.mode ?? "direct",
    meta.warnings ?? [],
    includedIndexes,
    skippedIndexes,
    outputResolution
  );
}

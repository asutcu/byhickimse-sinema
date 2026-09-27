import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { publishEvent } from "@/server/lib/events";
import type { MergeOptions } from "@/server/services/ffmpeg";

/**
 * Final birlestirme isleri (surec ici). Cift tiklamada iki is paralel kosabilir;
 * her biri ayri id ile takip edilir ve tek tek iptal edilebilir.
 */

export type RenderJobStatus = "running" | "cancelling" | "completed" | "cancelled" | "failed";

export interface RenderJobPublic {
  id: string;
  projectId: string;
  status: RenderJobStatus;
  startedAt: string;
  finishedAt: string | null;
  outputPath: string | null;
  label: string;
  errorMessage: string | null;
  clipCount: number | null;
  options: {
    mode: MergeOptions["mode"];
    outputResolution: MergeOptions["outputResolution"];
    audioFadeMs: number;
    trimSilence: boolean;
    trimBlack: boolean;
  };
}

interface RenderJobInternal {
  public: RenderJobPublic;
  controller: AbortController;
  killCurrent: (() => void) | null;
  previousProjectStatus: string;
}

export class RenderCancelledError extends Error {
  jobId: string;
  constructor(jobId: string) {
    super(`Birlestirme iptal edildi (${jobId})`);
    this.name = "RenderCancelledError";
    this.jobId = jobId;
  }
}

const globalForRender = globalThis as unknown as { renderJobs?: Map<string, RenderJobInternal> };

const jobs: Map<string, RenderJobInternal> =
  globalForRender.renderJobs ?? new Map<string, RenderJobInternal>();
if (!globalForRender.renderJobs) globalForRender.renderJobs = jobs;

const MAX_FINISHED = 20;

function jobLabel(options: MergeOptions, clipCount?: number): string {
  const res =
    options.outputResolution === "2160"
      ? "4K"
      : options.outputResolution === "1440"
        ? "QHD"
        : options.outputResolution === "1080"
          ? "1080p"
          : "kaynak";
  const mode = options.mode === "auto" ? "otomatik" : options.mode === "direct" ? "dogrudan" : "yeniden kodla";
  const clips = clipCount != null ? ` · ${clipCount} klip` : "";
  const subs = options.burnSubtitles ? " · altyazi" : "";
  return `${res} · ${mode}${clips}${subs}`;
}

function emit(projectId: string, job: RenderJobPublic): void {
  publishEvent(projectId, { type: "render_job", payload: job });
}

function pruneFinished(): void {
  const finished = [...jobs.values()]
    .filter((j) => j.public.status === "completed" || j.public.status === "cancelled" || j.public.status === "failed")
    .sort((a, b) => (b.public.finishedAt ?? "").localeCompare(a.public.finishedAt ?? ""));
  for (const extra of finished.slice(MAX_FINISHED)) {
    jobs.delete(extra.public.id);
  }
}

export function createRenderJob(
  projectId: string,
  options: MergeOptions,
  previousProjectStatus: string,
  clipCount?: number
): { jobId: string; signal: AbortSignal } {
  const id = randomUUID();
  const controller = new AbortController();
  const publicJob: RenderJobPublic = {
    id,
    projectId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outputPath: null,
    label: jobLabel(options, clipCount),
    errorMessage: null,
    clipCount: clipCount ?? null,
    options: {
      mode: options.mode,
      outputResolution: options.outputResolution ?? "source",
      audioFadeMs: options.audioFadeMs,
      trimSilence: options.trimSilence,
      trimBlack: options.trimBlack,
    },
  };
  jobs.set(id, {
    public: publicJob,
    controller,
    killCurrent: null,
    previousProjectStatus,
  });
  emit(projectId, publicJob);
  return { jobId: id, signal: controller.signal };
}

export function attachRenderChild(jobId: string, child: ChildProcess): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.killCurrent = () => {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  };
}

export function clearRenderChild(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) job.killCurrent = null;
}

export function setRenderJobOutput(jobId: string, outputPath: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.public.outputPath = outputPath;
  emit(job.public.projectId, { ...job.public });
}

export function assertRenderJobContinuing(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.controller.signal.aborted || job.public.status === "cancelling" || job.public.status === "cancelled") {
    throw new RenderCancelledError(jobId);
  }
}

export function cancelRenderJob(jobId: string, projectId?: string): RenderJobPublic | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (projectId && job.public.projectId !== projectId) return null;
  if (job.public.status !== "running" && job.public.status !== "cancelling") {
    return { ...job.public };
  }
  job.public.status = "cancelling";
  emit(job.public.projectId, { ...job.public });
  try {
    job.controller.abort();
  } catch {
    /* ignore */
  }
  job.killCurrent?.();
  return { ...job.public };
}

export function finishRenderJob(
  jobId: string,
  status: "completed" | "cancelled" | "failed",
  extra?: { errorMessage?: string; outputPath?: string }
): RenderJobPublic | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.public.status = status;
  job.public.finishedAt = new Date().toISOString();
  job.killCurrent = null;
  if (extra?.errorMessage) job.public.errorMessage = extra.errorMessage;
  if (extra?.outputPath) job.public.outputPath = extra.outputPath;
  emit(job.public.projectId, { ...job.public });
  pruneFinished();
  return { ...job.public };
}

export function getRenderJob(jobId: string): RenderJobPublic | null {
  const job = jobs.get(jobId);
  return job ? { ...job.public } : null;
}

export function getRenderJobPreviousStatus(jobId: string): string | null {
  return jobs.get(jobId)?.previousProjectStatus ?? null;
}

export function listRenderJobs(projectId: string): RenderJobPublic[] {
  return [...jobs.values()]
    .filter((j) => j.public.projectId === projectId)
    .map((j) => ({ ...j.public }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function countActiveRenderJobs(projectId: string, exceptJobId?: string): number {
  return [...jobs.values()].filter(
    (j) =>
      j.public.projectId === projectId &&
      j.public.id !== exceptJobId &&
      (j.public.status === "running" || j.public.status === "cancelling")
  ).length;
}

export function isRenderJobActive(jobId: string): boolean {
  const job = jobs.get(jobId);
  return Boolean(job && (job.public.status === "running" || job.public.status === "cancelling"));
}

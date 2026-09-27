import fs from "node:fs";
import path from "node:path";
import { publishEvent } from "@/server/lib/events";
import { APP_ROOT } from "@/server/lib/paths";

export type LongformPhase = "idle" | "story" | "beats" | "tts" | "stills" | "mix" | "done" | "failed" | "cancelled";

export interface LongformJobPublic {
  projectId: string;
  phase: LongformPhase;
  step: number;
  totalSteps: number;
  message: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  outputPath: string | null;
  cancelRequested: boolean;
}

interface LongformJobInternal {
  public: LongformJobPublic;
  controller: AbortController;
}

const globalForLongform = globalThis as unknown as { longformJobs?: Map<string, LongformJobInternal> };
const jobs: Map<string, LongformJobInternal> =
  globalForLongform.longformJobs ?? new Map<string, LongformJobInternal>();
if (!globalForLongform.longformJobs) globalForLongform.longformJobs = jobs;

const JOBS_DIR = path.join(APP_ROOT, "data", "longform-jobs");

const PHASE_STEP: Record<LongformPhase, number> = {
  idle: 0,
  story: 1,
  beats: 2,
  tts: 3,
  stills: 4,
  mix: 5,
  done: 6,
  failed: 0,
  cancelled: 0,
};

export function longformJobFilePath(projectId: string): string {
  return path.join(JOBS_DIR, `${projectId}.json`);
}

function persistJob(job: LongformJobPublic): void {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.writeFileSync(longformJobFilePath(job.projectId), JSON.stringify(job, null, 2), "utf8");
}

export function readPersistedLongformJob(projectId: string): LongformJobPublic | null {
  const filePath = longformJobFilePath(projectId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as LongformJobPublic;
    if (!parsed || typeof parsed !== "object" || parsed.projectId !== projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function recoverPersistedJob(projectId: string): LongformJobPublic | null {
  const disk = readPersistedLongformJob(projectId);
  if (!disk) return null;
  const running = !disk.finishedAt && disk.phase !== "failed" && disk.phase !== "cancelled" && disk.phase !== "done";
  if (!running) return disk;
  const recovered: LongformJobPublic = {
    ...disk,
    phase: "failed",
    finishedAt: new Date().toISOString(),
    error: "Sunucu yeniden basladi; gorsel slayt uretimi yarida kaldi. Tekrar deneyin.",
    message: "Kesildi",
    cancelRequested: false,
  };
  persistJob(recovered);
  return recovered;
}

function emit(job: LongformJobPublic): void {
  persistJob(job);
  publishEvent(job.projectId, { type: "longform", payload: job });
}

export function getLongformJob(projectId: string): LongformJobPublic | null {
  return jobs.get(projectId)?.public ?? recoverPersistedJob(projectId);
}

export function startLongformJob(projectId: string): LongformJobPublic {
  const existing = jobs.get(projectId);
  if (existing && !existing.public.finishedAt && existing.public.phase !== "failed") {
    throw new Error("Bu anlatinın gorsel uretimi zaten calisiyor");
  }
  const now = new Date().toISOString();
  const internal: LongformJobInternal = {
    controller: new AbortController(),
    public: {
      projectId,
      phase: "story",
      step: 1,
      totalSteps: 6,
      message: "Uretim basladi",
      error: null,
      startedAt: now,
      finishedAt: null,
      outputPath: null,
      cancelRequested: false,
    },
  };
  jobs.set(projectId, internal);
  emit(internal.public);
  return { ...internal.public };
}

export function updateLongformJob(
  projectId: string,
  patch: Partial<Pick<LongformJobPublic, "phase" | "message" | "outputPath">>
): LongformJobPublic | null {
  const job = jobs.get(projectId);
  if (!job) return null;
  if (patch.phase) {
    job.public.phase = patch.phase;
    job.public.step = PHASE_STEP[patch.phase] || job.public.step;
  }
  if (patch.message) job.public.message = patch.message;
  if (patch.outputPath !== undefined) job.public.outputPath = patch.outputPath;
  emit(job.public);
  return { ...job.public };
}

export function finishLongformJob(
  projectId: string,
  outcome: "done" | "failed" | "cancelled",
  extra?: { error?: string; outputPath?: string }
): LongformJobPublic | null {
  const job = jobs.get(projectId);
  if (!job) return null;
  job.public.phase = outcome;
  job.public.step = outcome === "done" ? 6 : job.public.step;
  job.public.finishedAt = new Date().toISOString();
  job.public.error = extra?.error ?? null;
  if (extra?.outputPath) job.public.outputPath = extra.outputPath;
  if (outcome === "done") job.public.message = "Gorsel slayt hazir";
  if (outcome === "cancelled") job.public.message = "Uretim iptal edildi";
  emit(job.public);
  return { ...job.public };
}

export function requestLongformCancel(projectId: string): boolean {
  const job = jobs.get(projectId);
  if (!job || job.public.finishedAt) return false;
  job.public.cancelRequested = true;
  job.controller.abort();
  emit(job.public);
  return true;
}

/** Kullanici bu is icin durdur dedi mi? (hata siniflandirmasinda kullanilir) */
export function isLongformCancelRequested(projectId: string): boolean {
  const job = jobs.get(projectId);
  return Boolean(job?.public.cancelRequested || job?.controller.signal.aborted);
}

export function assertLongformContinuing(projectId: string): void {
  const job = jobs.get(projectId);
  if (job?.public.cancelRequested || job?.controller.signal.aborted) {
    const err = new Error("Gorsel slayt uretimi iptal edildi");
    err.name = "LongformCancelledError";
    throw err;
  }
}

export function longformAbortSignal(projectId: string): AbortSignal | undefined {
  return jobs.get(projectId)?.controller.signal;
}

export function isLongformCancelledError(err: unknown): boolean {
  return err instanceof Error && err.name === "LongformCancelledError";
}

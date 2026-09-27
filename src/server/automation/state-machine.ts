/**
 * Otomasyon durum makinesi tanimi.
 * Klip ve is (job) durumlari ile gecerli gecisler burada merkezi olarak tutulur.
 */

export const CLIP_STATES = [
  "draft",
  "pending",
  "preparing",
  "opening_flow",
  "waiting_for_login",
  "selecting_project",
  "uploading_reference",
  "configuring_model",
  "entering_prompt",
  "generating",
  "waiting_for_completion",
  "downloading",
  "validating_download",
  "extracting_last_frame",
  "completed",
  "retrying",
  "paused",
  "needs_manual_action",
  "failed",
] as const;

export type ClipState = (typeof CLIP_STATES)[number];

export const JOB_STATES = ["pending", "running", "paused", "needs_manual_action", "completed", "failed", "stopped"] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Klip icin calistirma hattindaki sirali adimlar. */
export const CLIP_PIPELINE: ClipState[] = [
  "preparing",
  "opening_flow",
  "selecting_project",
  "uploading_reference",
  "configuring_model",
  "entering_prompt",
  "generating",
  "waiting_for_completion",
  "downloading",
  "validating_download",
  "extracting_last_frame",
  "completed",
];

const CLIP_TRANSITIONS: Record<string, ClipState[]> = {
  draft: ["pending", "preparing"],
  pending: ["preparing", "paused", "failed"],
  preparing: ["opening_flow", "retrying", "paused", "failed", "needs_manual_action"],
  opening_flow: ["waiting_for_login", "selecting_project", "retrying", "paused", "failed", "needs_manual_action"],
  waiting_for_login: ["opening_flow", "selecting_project", "paused", "needs_manual_action", "failed"],
  selecting_project: ["uploading_reference", "configuring_model", "retrying", "paused", "failed", "needs_manual_action"],
  uploading_reference: ["configuring_model", "entering_prompt", "retrying", "paused", "failed", "needs_manual_action"],
  configuring_model: ["entering_prompt", "retrying", "paused", "failed", "needs_manual_action"],
  entering_prompt: ["generating", "retrying", "paused", "failed", "needs_manual_action"],
  generating: ["waiting_for_completion", "retrying", "paused", "failed", "needs_manual_action"],
  waiting_for_completion: ["downloading", "retrying", "paused", "failed", "needs_manual_action"],
  downloading: ["validating_download", "retrying", "paused", "failed", "needs_manual_action"],
  validating_download: ["extracting_last_frame", "completed", "retrying", "paused", "failed", "needs_manual_action"],
  extracting_last_frame: ["completed", "retrying", "paused", "failed", "needs_manual_action"],
  completed: [],
  retrying: ["preparing", "paused", "failed", "needs_manual_action"],
  paused: ["preparing", "retrying", "pending", "failed", "needs_manual_action"],
  needs_manual_action: ["pending", "preparing", "retrying", "failed"],
  failed: ["pending", "preparing", "retrying"],
};

/** Gecis gecerli mi? (Ayni duruma gecis her zaman gecerlidir.) */
export function isValidClipTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = CLIP_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to as ClipState);
}

/** Yeniden baslatma sonrasi: tamamlanmamis kliplerden ilkini bulur. */
export function pickNextClipIndex(clips: Array<{ index: number; status: string }>): number | null {
  const sorted = [...clips].sort((a, b) => a.index - b.index);
  for (const clip of sorted) {
    if (clip.status !== "completed") return clip.index;
  }
  return null;
}

/** Yeniden deneme merdiveni: deneme sayisina gore strateji. */
export type RetryStrategy = "same_prompt" | "reload_page" | "reopen_project" | "manual";

export function retryStrategyForAttempt(attempt: number, maxRetries: number): RetryStrategy {
  if (attempt > maxRetries) return "manual";
  if (attempt <= 1) return "same_prompt";
  if (attempt === 2) return "reload_page";
  return "reopen_project";
}

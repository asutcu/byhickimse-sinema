/**
 * Merak akisi denetimi.
 * Uretilen sahne/klip dizisinde izleyiciyi kaybettirecek noktalari bulur:
 * kancasiz sahneler, art arda dusuk merak, duz (testere disi olmayan) akis.
 */

export interface CuriosityClipInput {
  index: number;
  curiosityScore: number;
  hasHook: boolean;
}

export interface CuriosityFlowReport {
  averageScore: number;
  peakScore: number;
  /** Kanca tasimayan sahne numaralari (son sahne haric). */
  missingHooks: number[];
  /** Art arda 5 altinda kalan iki veya daha fazla sahnenin numaralari. */
  flatRuns: number[][];
  /** Hicbir sahne 9+ degilse doruk yok demektir. */
  hasPeak: boolean;
  ok: boolean;
}

const LOW_SCORE = 5;
const PEAK_SCORE = 9;

export function analyzeCuriosityFlow(clips: CuriosityClipInput[]): CuriosityFlowReport {
  const sorted = [...clips].sort((a, b) => a.index - b.index);
  if (sorted.length === 0) {
    return { averageScore: 0, peakScore: 0, missingHooks: [], flatRuns: [], hasPeak: false, ok: false };
  }

  const total = sorted.reduce((sum, clip) => sum + clip.curiosityScore, 0);
  const averageScore = Number((total / sorted.length).toFixed(1));
  const peakScore = sorted.reduce((max, clip) => Math.max(max, clip.curiosityScore), 0);

  // Son sahne cozum sahnesidir; kanca tasimasi zorunlu degildir.
  const missingHooks = sorted.slice(0, -1).filter((clip) => !clip.hasHook).map((clip) => clip.index);

  const flatRuns: number[][] = [];
  let run: number[] = [];
  for (const clip of sorted) {
    if (clip.curiosityScore < LOW_SCORE) {
      run.push(clip.index);
    } else {
      if (run.length >= 2) flatRuns.push(run);
      run = [];
    }
  }
  if (run.length >= 2) flatRuns.push(run);

  const hasPeak = peakScore >= PEAK_SCORE;
  const ok = averageScore >= 6 && flatRuns.length === 0 && missingHooks.length === 0 && hasPeak;

  return { averageScore, peakScore, missingHooks, flatRuns, hasPeak, ok };
}

/** Panelde gosterilecek kisa Turkce uyari listesi. */
export function curiosityWarnings(report: CuriosityFlowReport): string[] {
  const warnings: string[] = [];
  if (report.averageScore < 6) warnings.push(`Ortalama merak ${report.averageScore}/10 — hedef en az 6.`);
  for (const run of report.flatRuns) {
    warnings.push(`Sahne ${run.join(", ")} art arda dusuk merak: izleyici burada birakir.`);
  }
  if (report.missingHooks.length > 0) {
    warnings.push(`Kanca tasimayan sahneler: ${report.missingHooks.join(", ")}.`);
  }
  if (!report.hasPeak) warnings.push("Doruk merak sahnesi yok (9+ puanli sahne ekleyin).");
  return warnings;
}

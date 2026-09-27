import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Clip, Project } from "@prisma/client";
import { prisma } from "@/server/db";
import { publishEvent } from "@/server/lib/events";
import { recordEvent } from "@/server/lib/logger";
import {
  clipFileName,
  clipFrameFileName,
  ensureProjectDirs,
  relocateStoredProjectFile,
  safeProjectPath,
} from "@/server/lib/paths";
import { emptyDialogueHint } from "@/lib/templates";
import { sameFlowProject } from "@/lib/flow-project-url";
import { getSettings, parseModelSupportMatrix, resolveModelSupport, validateFlowConfig } from "@/server/services/settings";
import { flowClipSeconds } from "@/lib/flow-generation-settings";
import { extractLastFrame, validateVideoFile } from "@/server/services/ffmpeg";
import {
  captureDebugSnapshot,
  configureGeneration,
  downloadClipVideo,
  ensureEditorReady,
  ensureFlowReady,
  ensureVideoOutputMode,
  enterPrompt,
  ManualActionNeededError,
  openFlowProject,
  PolicyBlockedError,
  snapshotVideoAssetIds,
  startGeneration,
  uploadReferenceImages,
  uniqueExistingImagePaths,
  waitForCompletion,
} from "@/server/automation/flow-adapter";
import {
  inferPolicyFloorFromPrompt,
  isPolicyRetryPending,
  policyFailCountFromMessage,
  policyMarkerForFailCount,
  rewritePromptAfterPolicyBlock,
} from "@/lib/flow-prompt-safety";
import { ensureDefaultSelectors, getSelectorConfig } from "@/server/automation/selectors";
import { retryStrategyForAttempt, type ClipState, type JobState } from "@/server/automation/state-machine";
import { getProjectPage, openFlowBrowser, releaseProjectPage } from "@/server/automation/browser";
import {
  collectNarratorOnScreenSheets,
  pickNarratorFilmReferencePaths,
} from "@/server/services/narrator-film";
import {
  allControls,
  controlFor,
  dropControl,
  liveProjectIds,
  peekControl,
  runInProjectContext,
  assertAutomationContinuing,
  interruptibleSleep,
  AutomationStoppedError,
  ClipCancelledError,
  HEARTBEAT_STALE_MS,
} from "@/server/automation/abort";

/**
 * SQLite destekli otomasyon motoru — PROJE BASINA bir isci.
 * - Her projenin kendi is kilidi, kendi Chrome sekmesi ve kendi durdur/duraklat
 *   bayraklari vardir; birden fazla proje ayni anda uretim yapabilir
 *   (ust sinir: AppSettings.maxParallelProjects)
 * - Is durumu her adimda veritabanina yazilir -> uygulama kapansa bile kaldigi yerden devam
 * - Yeniden deneme merdiveni: ayni prompt -> sayfa yenile -> projeyi yeniden ac -> elle mudahale
 */

export interface EngineStatus {
  runningJobId: string | null;
  pauseRequested: boolean;
  stopRequested: boolean;
  loopAlive: boolean;
  /** Su an canli dongusu olan proje kimlikleri (paralel calisma gorunurlugu). */
  runningProjectIds: string[];
}

/**
 * projectId verilirse O projenin durumu; verilmezse genel ozet
 * (ilk canli is, panelin eski alanlariyla uyumlu kalir).
 */
export function engineStatus(projectId?: string): EngineStatus {
  const runningProjectIds = liveProjectIds();

  if (projectId) {
    const control = peekControl(projectId);
    const loopAlive = !!control?.runningJobId && Date.now() - (control.loopHeartbeatMs || 0) < HEARTBEAT_STALE_MS;
    return {
      runningJobId: control?.runningJobId ?? null,
      pauseRequested: control?.pauseRequested ?? false,
      stopRequested: control?.stopRequested ?? false,
      loopAlive,
      runningProjectIds,
    };
  }

  const first = allControls().find(({ control }) => !!control.runningJobId);
  const loopAlive = !!first && Date.now() - (first.control.loopHeartbeatMs || 0) < HEARTBEAT_STALE_MS;
  return {
    runningJobId: first?.control.runningJobId ?? null,
    pauseRequested: first?.control.pauseRequested ?? false,
    stopRequested: first?.control.stopRequested ?? false,
    loopAlive,
    runningProjectIds,
  };
}

function isMissingRecordError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2025";
}

/** Is durumunu yazar. Kayit silinmisse (proje silme) sessizce false doner. */
async function setJobState(
  jobId: string,
  state: JobState,
  extra?: { pausedReason?: string | null; errorMessage?: string | null }
): Promise<boolean> {
  try {
    const job = await prisma.automationJob.update({
      where: { id: jobId },
      data: {
        state,
        ...(extra?.pausedReason !== undefined ? { pausedReason: extra.pausedReason } : {}),
        ...(extra?.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
        ...(state === "running" ? { startedAt: new Date() } : {}),
        ...(state === "completed" || state === "failed" || state === "stopped" ? { finishedAt: new Date() } : {}),
      },
    });
    publishEvent(job.projectId, {
      type: "job",
      payload: { id: job.id, state: job.state, pausedReason: job.pausedReason, currentClipId: job.currentClipId },
    });
    return true;
  } catch (err) {
    if (isMissingRecordError(err)) {
      console.warn(`[otomasyon] Is kaydi yok (silinmis olabilir): ${jobId} → ${state}`);
      return false;
    }
    throw err;
  }
}

async function setClipState(clip: Clip, state: ClipState, errorMessage?: string | null): Promise<Clip> {
  try {
    const updated = await prisma.clip.update({
      where: { id: clip.id },
      data: { status: state, ...(errorMessage !== undefined ? { errorMessage } : {}) },
    });
    publishEvent(clip.projectId, {
      type: "clip",
      payload: {
        id: updated.id,
        index: updated.index,
        status: updated.status,
        attemptCount: updated.attemptCount,
        errorMessage: updated.errorMessage,
        videoPath: updated.videoPath,
      },
    });
    return updated;
  } catch (err) {
    if (isMissingRecordError(err)) {
      console.warn(`[otomasyon] Klip kaydi yok (silinmis olabilir): ${clip.id} → ${state}`);
      return { ...clip, status: state, errorMessage: errorMessage ?? clip.errorMessage };
    }
    throw err;
  }
}

/** Duraklatma istegi varsa isi paused yapar ve devam/durdur bekler. */
async function waitWhilePaused(jobId: string, projectId: string): Promise<void> {
  const control = controlFor(projectId);
  if (!control.pauseRequested) return;
  await setJobState(jobId, "paused", { pausedReason: "Kullanici duraklatti" });
  await recordEvent({ projectId, jobId, step: "job", message: "Otomasyon duraklatildi" });
  while (control.pauseRequested && !control.stopRequested) {
    control.loopHeartbeatMs = Date.now();
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  }
  if (!control.stopRequested) {
    await setJobState(jobId, "running", { pausedReason: null });
    await recordEvent({ projectId, jobId, step: "job", message: "Otomasyon devam ediyor" });
  }
}

async function sleep(ms: number): Promise<void> {
  await interruptibleSleep(ms);
}

export class AutomationBusyError extends Error {
  constructor(message = "Bu projenin otomasyonu zaten calisiyor. Once onu durdurun veya bitmesini bekleyin.") {
    super(message);
    this.name = "AutomationBusyError";
  }
}

/** Otomasyonu baslatir (tamamlanmis klipler atlanir — kaldigi yerden devam). */
export async function startAutomation(projectId: string): Promise<{ jobId: string }> {
  // Yetim bellek kilidi varsa temizle
  await reconcileOrphanJobs(projectId);
  const control = controlFor(projectId);
  if (control.runningJobId) throw new AutomationBusyError();

  let project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.templateType === "longform") {
    throw new Error("Gorsel slayt anlatilari Flow otomasyonu kullanmaz. Anlatici studyosundan gorselleri uretin.");
  }

  // Paralel calisma siniri: her proje ayri Chrome sekmesi + ayri Flow uretimi
  // demektir; sinirsiz acmak makineyi ve Google tarafindaki kotayi zorlar.
  const parallelLimit = Math.max(1, (await getSettings()).maxParallelProjects ?? 4);
  const alreadyRunning = liveProjectIds().filter((id) => id !== projectId);
  if (alreadyRunning.length >= parallelLimit) {
    throw new AutomationBusyError(
      `Ayni anda en fazla ${parallelLimit} proje calisabilir (su an ${alreadyRunning.length} calisiyor). Ayarlar > "Paralel proje sayisi" ile artirabilir veya calisan bir isi durdurabilirsiniz.`
    );
  }

  // Paralel guvenlik: iki is AYNI Flow projesinde calisamaz — ayni composer'a
  // yazip birbirlerinin videosunu indirirler. Link bos ise ikinci is genel Flow
  // sayfasina duser ve ayni riski dogurur.
  if (alreadyRunning.length > 0) {
    const normalize = (url: string): string => url.trim().replace(/\/+$/, "").toLowerCase();
    const myUrl = normalize(project.flowProjectUrl);
    if (!myUrl) {
      throw new AutomationBusyError(
        `Baska bir proje calisirken bu projeyi baslatmak icin "Flow proje linki" dolu olmali (Proje Ayarlari). Link olmadan iki is ayni Flow sayfasini paylasir ve klipler birbirine karisir.`
      );
    }
    const others = await prisma.project.findMany({
      where: { id: { in: alreadyRunning } },
      select: { id: true, name: true, flowProjectUrl: true },
    });
    const clash = others.find(
      (other) => normalize(other.flowProjectUrl) === myUrl || sameFlowProject(other.flowProjectUrl, project.flowProjectUrl)
    );
    if (clash) {
      throw new AutomationBusyError(
        `"${clash.name}" projesi ayni Flow adresinde calisiyor. Her projenin Flow linki FARKLI olmali; ayni adreste iki is birbirinin promptunu ve indirmesini bozar.`
      );
    }
  }

  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant: "primary" }, orderBy: { index: "asc" } });
  if (clips.length === 0) throw new Error("Proje icin klip bulunamadi. Once hikayeyi kliplere bolun.");
  const withPrompts = clips.filter((c) => c.prompt.trim().length > 0);
  if (withPrompts.length === 0) throw new Error("Klip promptlari olusturulmamis. Once promptlari olusturun.");

  // Konusma metni bos olan klipler sessiz/anlamsiz video uretir
  const emptyDialogue = clips.filter((c) => !c.dialogue.trim());
  if (emptyDialogue.length > 0) {
    throw new Error(
      `${emptyDialogue.length} klibin konusma metni bos. ${emptyDialogueHint(project.templateType)}`
    );
  }

  // Prompt, guncel diyalogu iceriyor mu? (Diyalog sonradan uretildiyse prompt eskimis olur)
  const stalePrompts = clips.filter((c) => c.prompt.trim() && !c.prompt.includes(c.dialogue.trim().slice(0, 30)));
  if (stalePrompts.length > 0) {
    throw new Error(
      `${stalePrompts.length} klibin promptu guncel diyalogu icermiyor (metin sonradan degismis). Promptlar sekmesinden "Tum Promptlari Olustur" ile yenileyin.`
    );
  }

  // Model destek dogrulamasi
  const settings = await getSettings();
  const matrix = parseModelSupportMatrix(settings);
  const supportedDurations = resolveModelSupport(matrix, project.flowModel)?.durations;
  const clampedSeconds = flowClipSeconds(project.flowModel, project.clipSeconds, supportedDurations);
  if (clampedSeconds !== project.clipSeconds) {
    const previous = project.clipSeconds;
    await prisma.project.update({ where: { id: projectId }, data: { clipSeconds: clampedSeconds } });
    project = { ...project, clipSeconds: clampedSeconds };
    await recordEvent({
      projectId,
      step: "job",
      level: "warning",
      message: `Klip suresi ${previous}s → ${clampedSeconds}s (${project.flowModel} 10s destemiyor; 9:16 short 8s kullanilacak)`,
    });
  }
  const validation = validateFlowConfig(matrix, {
    model: project.flowModel,
    clipSeconds: project.clipSeconds,
    aspectRatio: project.aspectRatio,
    useReference: project.useReference,
    useStartFrame: project.useStartFrame || project.usePrevLastFrame,
  });
  if (!validation.ok) {
    throw new Error(
      `Flow ayarlari gecersiz: ${validation.errors.join(" | ")}. Bu ayarlar projeye ozeldir; "Proje Ayarlari" sekmesinden duzeltin (Ayarlar ekranindaki varsayilanlar yalnizca yeni projeleri etkiler).`
    );
  }
  for (const warning of validation.warnings) {
    await recordEvent({ projectId, step: "job", level: "warning", message: warning });
  }

  // Karakter gorseli yoksa Flow yuzu uydurur / bos oda uretir.
  // Otopilot ve manuel Baslat ayni sheet uretimini yapsin; onay bekletme.
  if (project.useReference) {
    const { generateMissingCastImages } = await import("@/server/services/character-flow");
    await generateMissingCastImages(projectId, {
      autoApprove: true,
      onProgress: (message) => {
        void recordEvent({ projectId, step: "character", message });
      },
    });
    project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  }

  // Karakter gorseli onay kontrolu (elle yuklenen onaysiz gorselle baslamayiz)
  const character = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
  if (project.useReference && character?.referenceImagePath && !character.imageApproved) {
    throw new Error("Karakter gorseli henuz onaylanmamis. Karakter sekmesinden onaylayin veya kendi gorselinizi yukleyin.");
  }
  if (project.templateType === "time_travel" && project.useReference) {
    // Sunucu ve yol arkadasi referanssiz uretilirse her klipte baska yuz / baska hayvan cikar.
    const { isTimeTravelCompanion } = await import("@/server/services/time-travel");
    const { parseTimeTravelSettings } = await import("@/lib/time-travel");
    const settings = parseTimeTravelSettings(project.timeTravelSettings);
    const missing: string[] = [];
    if (!relocateStoredProjectFile(character?.referenceImagePath)) missing.push(`sunucu (${character?.name || "ana karakter"})`);
    if (settings.companionEnabled) {
      const companion = (await prisma.characterProfile.findMany({ where: { projectId, role: "side" } })).find(isTimeTravelCompanion);
      if (!companion || !relocateStoredProjectFile(companion.referenceImagePath)) {
        missing.push(`yol arkadaşı (${companion?.name || settings.companionName || settings.companionSpecies})`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Kimlik görseli eksik: ${missing.join(", ")}. Karakter sekmesinden önce bu görselleri üretin; yoksa her klipte farklı yüz / farklı hayvan çıkar.`
      );
    }
  }

  await ensureDefaultSelectors();

  // Generate dugmesi auto modda kalibre edilmis olmali. promptInput artik
  // yerlesik bulucu ile (composer + "Ne olusturmak...") calisir; bos birincil
  // kayit otomasyonu engellemez.
  if (project.generateButtonMode === "auto") {
    const config = await getSelectorConfig("generateButton");
    if (!config || !config.value) {
      throw new Error(`Zorunlu secici eksik: generateButton. Kalibrasyon ekranindan ayarlayin veya Generate'i "elle" moduna alin.`);
    }
  }

  // Eski yarim kalmis isleri kapat: panelde "calisan gorev" sayisini sismesin
  await prisma.automationJob.updateMany({
    where: { projectId, state: { in: ["pending", "running", "paused", "needs_manual_action"] } },
    data: { state: "stopped", finishedAt: new Date() },
  });

  // Kuyrukta bekleyen kliplerin sayaci temiz baslasin (kesintiden kalan
  // yuksek deneme sayilari aninda "maksimum deneme" hatasi uretmesin)
  await prisma.clip.updateMany({
    where: { projectId, languageVariant: "primary", status: "pending", attemptCount: { gt: 0 } },
    data: { attemptCount: 0 },
  });

  const job = await prisma.automationJob.create({
    data: { projectId, type: "flow_generation", state: "pending", mode: project.automationMode },
  });
  control.runningJobId = job.id;
  control.pauseRequested = false;
  control.stopRequested = false;
  control.cancelCurrentClip = false;
  control.loopHeartbeatMs = Date.now();

  await prisma.project.update({ where: { id: projectId }, data: { status: "automating" } });
  publishEvent(projectId, { type: "project", payload: { id: projectId, status: "automating" } });

  // Ana dongu arka planda calisir; API cagrisi hemen doner.
  // runInProjectContext: dongunun icindeki TUM async cagrilar (Playwright dahil)
  // bu projeye ait sayilir; assertAutomationContinuing dogru bayraklari okur.
  void runInProjectContext(projectId, () => runJobLoop(job.id, projectId)).catch(async (err) => {
    await recordEvent({ projectId, jobId: job.id, step: "job", level: "error", message: `Is dongusu beklenmedik hata: ${err instanceof Error ? err.message : String(err)}` });
    await setJobState(job.id, "failed", { errorMessage: err instanceof Error ? err.message : String(err) });
    control.runningJobId = null;
  });

  return { jobId: job.id };
}

export function pauseAutomation(projectId: string): void {
  controlFor(projectId).pauseRequested = true;
}

export function resumeAutomation(projectId: string): void {
  controlFor(projectId).pauseRequested = false;
}

const ACTIVE_JOB_STATES = ["pending", "running", "paused", "needs_manual_action"] as const;

/**
 * Bellekte dongu yokken DB'de "calisiyor" kalan yetim isleri kapatir.
 * Sunucu yeniden baslatildiginda panelde sahte Durdur/Duraklat gorunmesini onler.
 *
 * PARALEL GUVENLIK: canli dongusu olan projelere DOKUNMAZ. Panel her durum
 * sorgusunda bu fonksiyonu cagirdigi icin, aksi halde bir projenin sorgusu
 * digerlerinin calisan islerini durdururdu.
 */
export async function reconcileOrphanJobs(projectId?: string): Promise<number> {
  const live = new Set(liveProjectIds());

  // Kalinti bellek kilidi temizligi (dongu olmeden bayrak kalmis olabilir)
  for (const { projectId: id, control } of allControls()) {
    if (live.has(id)) continue;
    if (control.runningJobId) {
      control.runningJobId = null;
      control.stopRequested = false;
      control.pauseRequested = false;
      control.cancelCurrentClip = false;
    }
    if (id !== projectId) dropControl(id);
  }

  if (projectId && live.has(projectId)) return 0;

  const liveIds = [...live];
  const result = await prisma.automationJob.updateMany({
    where: {
      state: { in: [...ACTIVE_JOB_STATES] },
      ...(projectId ? { projectId } : liveIds.length > 0 ? { projectId: { notIn: liveIds } } : {}),
    },
    data: {
      state: "stopped",
      finishedAt: new Date(),
      pausedReason: "Onceki oturum sonlandi (sunucu yeniden baslatildi veya is koptu)",
    },
  });
  if (result.count > 0) {
    await recordEvent({
      projectId: projectId ?? undefined,
      step: "job",
      level: "warning",
      message: `${result.count} yetim otomasyon isi durduruldu (canli dongu yoktu)`,
    });
    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
      if (project?.status === "automating") {
        await prisma.project.update({ where: { id: projectId }, data: { status: "prompts_ready" } });
        publishEvent(projectId, { type: "project", payload: { id: projectId, status: "prompts_ready" } });
      }
    }
  }
  return result.count;
}

/**
 * Durdur: o projenin canli dongusunu keser VE DB'yi hemen "stopped" yapar
 * (yetim islerde de calisir). projectId verilmezse TUM projeler durdurulur.
 * Diger projelerin isleri etkilenmez.
 */
export async function stopAutomation(projectId?: string): Promise<{
  stopping: true;
  jobId: string | null;
  forced: boolean;
  stoppedCount: number;
}> {
  if (!projectId) {
    const ids = allControls().map((entry) => entry.projectId);
    let stoppedCount = 0;
    let jobId: string | null = null;
    for (const id of ids) {
      const result = await stopAutomation(id);
      stoppedCount += result.stoppedCount;
      jobId = jobId ?? result.jobId;
    }
    return { stopping: true, jobId, forced: ids.length === 0, stoppedCount };
  }

  const control = controlFor(projectId);
  const liveJobId = control.runningJobId;
  control.stopRequested = true;
  control.pauseRequested = false;
  control.cancelCurrentClip = true;

  // Canli donguye kisa sure tani; waitForCompletion assert ile cikmali
  if (liveJobId) {
    for (let i = 0; i < 50 && control.runningJobId === liveJobId; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    if (control.runningJobId === liveJobId) {
      control.runningJobId = null;
    }
  }

  let stoppedCount = 0;
  {
    const updated = await prisma.automationJob.updateMany({
      where: { projectId, state: { in: [...ACTIVE_JOB_STATES] } },
      data: { state: "stopped", finishedAt: new Date(), pausedReason: null, errorMessage: null },
    });
    stoppedCount = updated.count;
  }

  {
    // Yarida kalan klip durumlarini kuyruga geri al
    await prisma.clip.updateMany({
      where: {
        projectId,
        languageVariant: "primary",
        status: {
          in: [
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
            "retrying",
            "paused",
          ],
        },
      },
      data: { status: "pending", errorMessage: "Otomasyon durduruldu" },
    });

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
    if (project?.status === "automating") {
      await prisma.project.update({ where: { id: projectId }, data: { status: "prompts_ready" } });
      publishEvent(projectId, { type: "project", payload: { id: projectId, status: "prompts_ready" } });
    }

    // UI'nin job badge'ini yenilemesi icin
    publishEvent(projectId, {
      type: "job",
      payload: { id: liveJobId ?? "stopped", state: "stopped", pausedReason: null, currentClipId: null },
    });
  }

  await recordEvent({
    projectId,
    jobId: liveJobId ?? undefined,
    step: "job",
    message: liveJobId
      ? "Otomasyon durduruldu (canli is kesildi)"
      : stoppedCount > 0
        ? `Otomasyon durduruldu (${stoppedCount} yetim/aktif is kapatildi)`
        : "Durdur istegi alindi (aktif is bulunamadi)",
  });

  // Sonraki baslatma icin bayraklari temizle (dongu finally de temizler)
  if (!control.runningJobId) {
    control.stopRequested = false;
    control.pauseRequested = false;
    control.cancelCurrentClip = false;
    await releaseProjectPage(projectId);
  }

  return { stopping: true, jobId: liveJobId, forced: !liveJobId, stoppedCount };
}

export function cancelCurrentClip(projectId: string): void {
  controlFor(projectId).cancelCurrentClip = true;
}

function throwIfCancelled(): void {
  assertAutomationContinuing();
}

async function runJobLoop(jobId: string, projectId: string): Promise<void> {
  const settings = await getSettings();
  const control = controlFor(projectId);
  control.loopHeartbeatMs = Date.now();
  await setJobState(jobId, "running");
  await recordEvent({ projectId, jobId, step: "job", message: "Otomasyon basladi" });

  try {
    while (true) {
      control.loopHeartbeatMs = Date.now();
      const projectStillThere = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!projectStillThere) {
        console.warn(`[otomasyon] Proje silindi, is durduruluyor: ${projectId}`);
        break;
      }

      if (control.stopRequested) {
        await setJobState(jobId, "stopped");
        await recordEvent({ projectId, jobId, step: "job", message: "Otomasyon kullanici istegiyle durduruldu" });
        break;
      }
      await waitWhilePaused(jobId, projectId);
      if (control.stopRequested) continue;

      const nextClip = await prisma.clip.findFirst({
        where: { projectId, languageVariant: "primary", status: { notIn: ["completed", "needs_manual_action", "failed"] } },
        orderBy: { index: "asc" },
      });

      if (!nextClip) {
        const remaining = await prisma.clip.count({
          where: { projectId, languageVariant: "primary", status: { in: ["needs_manual_action", "failed"] } },
        });
        if (remaining > 0) {
          await setJobState(jobId, "needs_manual_action", {
            pausedReason: `${remaining} klip elle mudahale bekliyor (basarisiz/kalibrasyonluk). Panelden yeniden deneyin.`,
          });
          await recordEvent({ projectId, jobId, step: "job", level: "warning", message: `Is tamamlanamadi: ${remaining} klip elle mudahale bekliyor` });
        } else {
          const ok = await setJobState(jobId, "completed");
          if (ok) {
            try {
              await prisma.project.update({ where: { id: projectId }, data: { status: "clips_done" } });
              publishEvent(projectId, { type: "project", payload: { id: projectId, status: "clips_done" } });
              await recordEvent({ projectId, jobId, step: "job", message: "Tum klipler tamamlandi. FFmpeg birlestirmeye hazir." });
            } catch (err) {
              if (!isMissingRecordError(err)) throw err;
            }
          }
        }
        break;
      }

      try {
        await prisma.automationJob.update({ where: { id: jobId }, data: { currentClipId: nextClip.id } });
      } catch (err) {
        if (isMissingRecordError(err)) {
          console.warn(`[otomasyon] Is kaydi yok, dongu sonlandi: ${jobId}`);
          break;
        }
        throw err;
      }
      const result = await processClip(jobId, projectId, nextClip.id);

      if (result === "stopped") {
        await setJobState(jobId, "stopped");
        await recordEvent({ projectId, jobId, step: "job", message: "Otomasyon kullanici istegiyle durduruldu" });
        break;
      }

      // Gercek mudahale (Flow girisi, kalibrasyon) — kullanici cozene kadar bekle.
      if (result === "manual") {
        await setJobState(jobId, "needs_manual_action", { pausedReason: "Elle dogrulama/mudahale gerekiyor" });
        // Kullanici sorunu cozup devam edene kadar bekle
        control.pauseRequested = true;
        await waitWhilePaused(jobId, projectId);
        if (control.stopRequested) continue;
      }

      // Uretimler arasi bekleme (sabit asiri hizli bot davranisi olusturmamak icin)
      // "skipped": deneme tavanina takilan klip — is durmaz, kuyruk ilerler.
      if (result === "completed" || result === "failed" || result === "skipped") {
        try {
          await sleep(settings.waitBetweenGenerationsMs);
        } catch (err) {
          if (err instanceof AutomationStoppedError) {
            await setJobState(jobId, "stopped");
            await recordEvent({ projectId, jobId, step: "job", message: "Otomasyon kullanici istegiyle durduruldu" });
            break;
          }
          if (!(err instanceof ClipCancelledError)) throw err;
        }
      }
    }
  } finally {
    control.runningJobId = null;
    control.pauseRequested = false;
    control.stopRequested = false;
    control.cancelCurrentClip = false;
    control.loopHeartbeatMs = 0;
    // Projeye ayrilmis Chrome sekmesini birak (ana sekme kapatilmaz)
    await releaseProjectPage(projectId).catch(() => {});
    projectPolicyFloor.delete(projectId);
  }
}

type ClipResult = "completed" | "manual" | "skipped" | "failed" | "cancelled" | "stopped";

/**
 * Bir klip icin TOPLAM deneme tavani.
 *
 * Politika kademeleri (POLITIKA-1..4) normal `maxRetries` sinirini bilerek
 * asabilir — merdiven bitmeden klip atlanmasin. Ama bu bypass sinirsizdi ve
 * ayni klip 6-7 kez denenip saatler harciyordu. Politika bonusu artik bu
 * tavana kadar surer; sonra klip atlanir ve kuyruk ilerler.
 */
const CLIP_ATTEMPT_HARD_CAP = 4;

/**
 * Politika merdiveninin son kademesi (yuzsuz sahne). Kademeler bu sayiya
 * sikistirildi ki DORDUNCU deneme son careyi gercekten kullansin:
 * 1. deneme ozgun istem → 2. yumusak → 3. isimsiz → 4. YUZSUZ SAHNE.
 */
const POLICY_LADDER_LAST_STAGE = 3;

/** Bu isten sonra gelen sahneler ayni politika kademesinden baslar. */
const projectPolicyFloor = new Map<string, number>();

function raiseProjectPolicyFloor(projectId: string, stage: number): number {
  const next = Math.max(projectPolicyFloor.get(projectId) ?? 0, stage);
  projectPolicyFloor.set(projectId, next);
  return next;
}

function projectPolicyFloorOf(projectId: string): number {
  return projectPolicyFloor.get(projectId) ?? 0;
}

function clipPolicyFloor(projectId: string, clip: { prompt: string; errorMessage: string | null }): number {
  return Math.max(
    projectPolicyFloorOf(projectId),
    policyFailCountFromMessage(clip.errorMessage),
    inferPolicyFloorFromPrompt(clip.prompt)
  );
}

/**
 * Bir klip politika reddi alinca kalan kuyruk ayni kademeye cekilir.
 * Boylece her sahne 4 deneme yakmaz; prompt/sahne otomatik degisir.
 */
async function hardenQueuedClipsAfterPolicy(opts: {
  projectId: string;
  jobId: string;
  afterIndex: number;
  stage: number;
}): Promise<number> {
  if (opts.stage < 1) return 0;
  raiseProjectPolicyFloor(opts.projectId, opts.stage);
  const queued = await prisma.clip.findMany({
    where: {
      projectId: opts.projectId,
      languageVariant: "primary",
      index: { gt: opts.afterIndex },
      status: { in: ["pending", "draft", "paused"] },
    },
    select: { id: true, prompt: true },
  });
  let n = 0;
  for (const q of queued) {
    if (!q.prompt?.trim()) continue;
    if (inferPolicyFloorFromPrompt(q.prompt) >= opts.stage) continue;
    const rewritten = rewritePromptAfterPolicyBlock(q.prompt, opts.stage);
    if (rewritten === q.prompt) continue;
    await prisma.clip.update({ where: { id: q.id }, data: { prompt: rewritten } });
    n += 1;
  }
  if (n > 0) {
    const rung =
      opts.stage >= 3 ? "yuzsuz kurgu (el/obje/siluet)" : opts.stage >= 2 ? "isimsiz + refsiz" : "yumusak";
    await recordEvent({
      projectId: opts.projectId,
      jobId: opts.jobId,
      step: "clip",
      level: "warning",
      message: `Politika: sonraki ${n} sahne otomatik guncellendi (${rung}). Yuz referansi yuklenmeyecek.`,
    });
  }
  return n;
}

async function processClip(jobId: string, projectId: string, clipId: string): Promise<ClipResult> {
  const settings = await getSettings();
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  let clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });
  const character = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });

  const attempt = clip.attemptCount + 1;
  try {
    clip = await prisma.clip.update({ where: { id: clip.id }, data: { attemptCount: attempt } });
  } catch (err) {
    if (isMissingRecordError(err)) return "cancelled";
    throw err;
  }
  const strategy = retryStrategyForAttempt(attempt, settings.maxRetries);

  const policyRetryPending = isPolicyRetryPending(clip.errorMessage);
  // Politika merdiveni siniri asabilir, ama yalnizca sert tavana kadar.
  if (strategy === "manual" && (!policyRetryPending || attempt > CLIP_ATTEMPT_HARD_CAP)) {
    const limit = policyRetryPending ? CLIP_ATTEMPT_HARD_CAP : settings.maxRetries;
    await setClipState(clip, "needs_manual_action", `Maksimum yeniden deneme (${limit}) asildi`);
    await recordEvent({
      projectId,
      jobId,
      clipId,
      step: "clip",
      level: "error",
      message: `Klip ${clip.index}: ${limit} deneme sonunda gecilemedi — klip atlandi, sonraki klibe geciliyor. Sonra "Basarisizlari yeniden dene" ile donebilirsiniz.`,
      attempt,
    });
    return "skipped";
  }

  await recordEvent({ projectId, jobId, clipId, step: "clip", message: `Klip ${clip.index} isleniyor (deneme ${attempt}, strateji: ${strategy})`, attempt });

  try {
    clip = await setClipState(clip, "preparing");
    throwIfCancelled();

    // 1) Flow acik mi + oturum hazir mi (bu projeye AYRILMIS sekmede)
    clip = await setClipState(clip, "opening_flow");
    let page = await ensureFlowReady(projectId, project.flowProjectUrl).catch(async (err) => {
      if (err instanceof ManualActionNeededError) {
        await setClipState(clip, "waiting_for_login", err.message);
        throw err;
      }
      throw err;
    });

    // Yeniden deneme stratejileri
    if (strategy === "reload_page") {
      await recordEvent({ projectId, jobId, clipId, step: "clip", message: "Strateji: sayfa yenileniyor", attempt });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      await sleep(2_000);
    } else if (strategy === "reopen_project") {
      // Once bu projeye ozel adres; yoksa genel Flow adresi (proje adresi iceriyorsa).
      const projectUrl = project.flowProjectUrl.trim();
      const canReopen = projectUrl.length > 0 || project.flowProjectName.trim().length > 0 || /\/project/i.test(settings.flowUrl);
      if (canReopen) {
        const target = projectUrl || settings.flowUrl;
        await recordEvent({ projectId, jobId, clipId, step: "clip", message: `Strateji: proje adresi yeniden aciliyor (${target})`, attempt });
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
      } else {
        await recordEvent({
          projectId,
          jobId,
          clipId,
          step: "clip",
          level: "warning",
          message:
            "Strateji: sayfa yenilendi (bu proje icin Flow adresi tanimli degil — Proje Ayarlari > 'Flow proje linki' alanini doldurmaniz onerilir)",
          attempt,
        });
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      }
      await sleep(2_000);
    }
    page = await ensureFlowReady(projectId, project.flowProjectUrl);
    throwIfCancelled();

    // 2) Dogru Flow projesi + editor ekraninda oldugumuzu garanti et.
    // Projeye ozel adres varsa HER klipte dogrulanir: openFlowProject zaten
    // dogru adreste ise hicbir sey yapmaz, yanlis projedeysek geri getirir
    // (baska bir akis sekmeyi kendi Flow projesine goturmus olabilir).
    clip = await setClipState(clip, "selecting_project");
    if (clip.index === 1 || strategy === "reopen_project" || project.flowProjectUrl.trim()) {
      await openFlowProject(page, project);
    }
    await ensureEditorReady(page, project);
    throwIfCancelled();

    // 3) Model/sure/oran ONCE — ayar degisimi composer'i sifirlayabilir;
    //    referanslar SONRA eklenmeli ki kaybolmasin.
    clip = await setClipState(clip, "configuring_model");
    if (clip.index === 1 || strategy === "reopen_project") {
      await configureGeneration(page, project);
    }
    throwIfCancelled();

    // 4) Referans gorseli / onceki son kare (cocuk: tum sabit kadro)
    clip = await setClipState(clip, "uploading_reference");
    const referencePaths = await resolveReferenceImages(project, clip, character?.referenceImagePath ?? null);
    // Ilk politika reddinden itibaren yuz sheet yuklenmez — unlu filtresinin ana tetikleyicisi.
    const policyFloor = clipPolicyFloor(projectId, clip);
    const skipRefs = policyFloor >= 1;
    if (referencePaths.length > 0 && !skipRefs) {
      await uploadReferenceImages(page, project, referencePaths);
    } else if (skipRefs && referencePaths.length > 0) {
      await recordEvent({
        projectId,
        jobId,
        clipId,
        step: "clip",
        level: "warning",
        message: `Klip ${clip.index}: politika kademesi ${policyFloor} — referans sheet yuklenmiyor (yuz filtresini tetiklemesin)`,
        attempt,
      });
    }
    throwIfCancelled();

    // 5) Prompt (once ciktinin VIDEO oldugundan emin ol: referans yuklemesi
    //    Flow'u bazen goruntu moduna kaydiriyor ve video yerine gorsel uretiliyor)
    clip = await setClipState(clip, "entering_prompt");
    await ensureVideoOutputMode(page, project, { repairSettings: true });
    // Politika reddinden donen / kuyrukta onceden sertlestirilmis sahnede
    // prompt YENIDEN kurulmaz — rebuild yumusatmayi ezerdi.
    const policyRetry = isPolicyRetryPending(clip.errorMessage) || policyFloor > 0;
    if (
      (project.templateType === "narrator" ||
        project.templateType === "time_travel" ||
        project.templateType === "kids_animation") &&
      !policyRetry
    ) {
      const { rebuildClipPrompt } = await import("@/server/services/clips");
      clip = await rebuildClipPrompt(clip.id);
    }
    if (policyFloor > 0 && clip.prompt?.trim()) {
      const rewritten = rewritePromptAfterPolicyBlock(clip.prompt, policyFloor);
      if (rewritten !== clip.prompt) {
        try {
          clip = await prisma.clip.update({ where: { id: clip.id }, data: { prompt: rewritten } });
        } catch (updateErr) {
          if (!isMissingRecordError(updateErr)) throw updateErr;
        }
      }
    }
    await enterPrompt(page, project, clip.prompt);
    throwIfCancelled();

    // 6) Generate — startGeneration icinde video modu TEKRAR zorlanir
    // Uretim oncesi varlik kimlikleri: "yeni video gercekten olustu mu" ve
    // "hangi kartin indirilecegi" sorularinin tek kesin dayanagi.
    const knownAssetIds = await snapshotVideoAssetIds(page);
    clip = await setClipState(clip, "generating");
    await startGeneration(page, project, project.generateButtonMode === "manual" ? "manual" : "auto");
    throwIfCancelled();

    // 7) Tamamlanma bekle
    clip = await setClipState(clip, "waiting_for_completion");
    const newAssetId = await waitForCompletion(page, project, knownAssetIds);
    throwIfCancelled();

    // 8) Indir
    clip = await setClipState(clip, "downloading");
    ensureProjectDirs(project.slug);
    const targetPath = safeProjectPath(project.slug, "clips", clipFileName(clip.index, clip.id));
    const savedPath = await downloadClipVideo(page, project, targetPath, newAssetId);
    throwIfCancelled();

    // 8b) AYNI VIDEO KONTROLU: indirilen dosya baska bir klibin videosuyla
    // birebir ayniysa (proje geneli indirme, yanlis kart vb.) klip tamamlanmis
    // sayilamaz — dosya silinir ve klip yeniden denenir.
    const duplicateOf = await findDuplicateClipVideo(projectId, clip.id, savedPath);
    if (duplicateOf !== null) {
      fs.rmSync(savedPath, { force: true });
      throw new Error(
        `Indirilen video, klip ${duplicateOf} ile birebir ayni (yeni uretim degil, eski video inmis). Klip yeniden denenecek.`
      );
    }

    // 9) Dogrula (boyut + ffprobe)
    clip = await setClipState(clip, "validating_download");
    const validation = await validateVideoFile(savedPath);
    if (!validation.ok || !validation.info) {
      throw new Error(`Indirilen video dogrulanamadi: ${validation.error}`);
    }
    await prisma.generatedAsset.create({
      data: {
        projectId,
        clipId: clip.id,
        kind: "clip_video",
        path: savedPath,
        bytes: validation.info.sizeBytes,
        meta: JSON.stringify({ duration: validation.info.durationSeconds, codec: validation.info.videoCodec }),
      },
    });

    // 10) Son kare (sonraki klip icin gerekiyorsa)
    let lastFramePath: string | null = null;
    if (project.usePrevLastFrame || project.useStartFrame) {
      clip = await setClipState(clip, "extracting_last_frame");
      lastFramePath = safeProjectPath(project.slug, "frames", clipFrameFileName(clip.index, clip.id, "last"));
      await extractLastFrame(savedPath, lastFramePath);
      await prisma.generatedAsset.create({
        data: { projectId, clipId: clip.id, kind: "last_frame", path: lastFramePath, bytes: fs.statSync(lastFramePath).size },
      });
    }

    clip = await prisma.clip.update({
      where: { id: clip.id },
      data: {
        videoPath: savedPath,
        lastFramePath,
        actualDurationSeconds: validation.info.durationSeconds,
        errorMessage: null,
      },
    });
    clip = await setClipState(clip, "completed");
    await recordEvent({
      projectId,
      jobId,
      clipId,
      step: "clip",
      message: `Klip ${clip.index} tamamlandi (${validation.info.durationSeconds.toFixed(1)} sn, ${(validation.info.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`,
      attempt,
    });
    return "completed";
  } catch (err) {
    if (err instanceof AutomationStoppedError) {
      await setClipState(clip, "paused", "Otomasyon durduruldu");
      await recordEvent({
        projectId,
        jobId,
        clipId,
        step: "clip",
        level: "warning",
        message: `Klip ${clip.index}: otomasyon durduruldu`,
        attempt,
      });
      return "stopped";
    }
    if (err instanceof ClipCancelledError) {
      await setClipState(clip, "paused", "Klip iptal edildi");
      await recordEvent({ projectId, jobId, clipId, step: "clip", level: "warning", message: `Klip ${clip.index} iptal edildi`, attempt });
      return "cancelled";
    }
    if (err instanceof PolicyBlockedError) {
      const next = Math.max(policyFailCountFromMessage(clip.errorMessage) + 1, 1);
      raiseProjectPolicyFloor(projectId, next);
      if (next <= POLICY_LADDER_LAST_STAGE && clip.prompt?.trim()) {
        const rewritten = rewritePromptAfterPolicyBlock(clip.prompt, next);
        try {
          clip = await prisma.clip.update({
            where: { id: clip.id },
            data: { prompt: rewritten },
          });
        } catch (updateErr) {
          if (!isMissingRecordError(updateErr)) throw updateErr;
        }
        await hardenQueuedClipsAfterPolicy({
          projectId,
          jobId,
          afterIndex: clip.index,
          stage: next,
        }).catch(() => {});
        const marker = policyMarkerForFailCount(next);
        const stepLabel =
          next <= 1
            ? "isim/yuz tetikleyicileri sokuldu, prompt yumusatildi; kalan sahneler de cekildi"
            : next === 2
              ? "isim ve yuz kilidi sokuldu (referans sheet yuklenmez); kalan sahneler ayni"
              : "SAHNE DEGISTI: yuzsuz kurgu (el / obje / siluet / arkadan) — kalan sahneler de yuzsuz";
        await setClipState(clip, "retrying", `${marker} ${err.message}`);
        await recordEvent({
          projectId,
          jobId,
          clipId,
          step: "clip",
          level: "warning",
          message: `Klip ${clip.index}: politika reddi (${marker}) — ${stepLabel}. Ret: ${err.message.slice(0, 160)}`,
          attempt,
        });
        return "failed";
      }
      await hardenQueuedClipsAfterPolicy({
        projectId,
        jobId,
        afterIndex: clip.index,
        stage: POLICY_LADDER_LAST_STAGE,
      }).catch(() => {});
      await setClipState(clip, "failed", err.message);
      await recordEvent({
        projectId,
        jobId,
        clipId,
        step: "clip",
        level: "error",
        message: `Klip ${clip.index}: politika reddi yuzsuz sahneye ragmen surdu — klip atlandi, sonraki sahneler yuzsuz kurguda. Ret: ${err.message.slice(0, 160)}`,
        attempt,
      });
      return "failed";
    }
    if (err instanceof ManualActionNeededError) {
      await setClipState(clip, "needs_manual_action", err.message);
      await recordEvent({ projectId, jobId, clipId, step: "clip", level: "warning", message: err.message, attempt });
      return "manual";
    }
    const message = err instanceof Error ? err.message : String(err);
    // Ekran goruntusu bu projenin KENDI sekmesinden alinmali (paralel calismada
    // ana sekme baska bir projeye ait olabilir).
    const page = getProjectPage(projectId);
    let screenshotPath: string | undefined;
    if (page) {
      const snapshot = await captureDebugSnapshot(page, project.slug, `clip-${clip.index}-error`);
      screenshotPath = snapshot.screenshotPath;
    }
    await setClipState(clip, "retrying", message);
    await recordEvent({
      projectId,
      jobId,
      clipId,
      step: "clip",
      level: "error",
      message: `Klip ${clip.index} hata (deneme ${attempt}): ${message}`,
      screenshotPath,
      attempt,
      detail: err instanceof Error ? { stack: err.stack?.slice(0, 2000) } : undefined,
    });
    return "failed";
  }
}

/**
 * Indirilen videonun ayni projedeki BASKA bir klibin videosuyla birebir ayni
 * olup olmadigini icerik ozetiyle (md5) kontrol eder. Ayniysa o klibin
 * sirasini dondurur; degilse null.
 *
 * Bu, "tamamlandi ama eski video indi" hatasina karsi son guvenlik agidir:
 * dosya adindaki zaman damgasi guvenilir degildir (Flow arsivi indirme aninda
 * olusturup o anin saatiyle adlandirir), icerik ozeti ise kesindir.
 */
async function findDuplicateClipVideo(projectId: string, clipId: string, videoPath: string): Promise<number | null> {
  if (!fs.existsSync(videoPath)) return null;
  const hashOf = (filePath: string): string =>
    crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");

  const newHash = hashOf(videoPath);
  const others = await prisma.clip.findMany({
    where: { projectId, id: { not: clipId }, videoPath: { not: null } },
    select: { index: true, videoPath: true },
    orderBy: { index: "asc" },
  });

  for (const other of others) {
    if (!other.videoPath || !fs.existsSync(other.videoPath)) continue;
    try {
      if (hashOf(other.videoPath) === newHash) return other.index;
    } catch {
      // okunamayan dosya kiyaslamayi durdurmasin
    }
  }
  return null;
}

/**
 * Referans gorsel(ler)i secimi.
 * - Cocuk animasyonu: sahnedeki [Kadro] uyelerinin referans gorselleri (bozulmayi onler)
 * - Anlatici film: sahnedeki kisinin solo kimlik gorseli; last-frame ile KARISTIRILMAZ
 *   (onceki klibin yuzu + bu klibin sheet'i Flow'u iki kisi / morph yapar).
 *   Anlatici portresi kesitte eklenmez; kameradaki itirafta ana kadin sheet'i kullanilir.
 */
async function resolveReferenceImages(project: Project, clip: Clip, characterImage: string | null): Promise<string[]> {
  if (project.templateType === "time_travel") {
    if (!project.useReference) return [];
    const { timeTravelReferencePaths } = await import("@/server/services/time-travel");
    const cast = await prisma.characterProfile.findMany({
      where: { projectId: project.id },
      select: { id: true, role: true, referenceImagePath: true, dnaCard: true },
    });
    const { paths, labels } = timeTravelReferencePaths(clip, cast);
    await recordEvent({
      projectId: project.id,
      clipId: clip.id,
      step: "flow",
      message:
        paths.length > 0
          ? `Klip ${clip.index}: referans — ${labels.join(", ")} (${paths.length} sheet)`
          : clip.shotType === "tt_pov"
            ? `Klip ${clip.index}: goz hizasi cekim — referans sheet gerekmiyor`
            : `Klip ${clip.index}: referans sheet yok (Karakter sekmesinden sunucu / yol arkadasi gorselini uretin)`,
      ...(paths.length === 0 && clip.shotType !== "tt_pov" ? { level: "warning" as const } : {}),
    });
    return paths;
  }
  if (project.templateType === "narrator") {
    const isNarratorTake = clip.shotType === "narrator";
    const cast = project.useReference
      ? await prisma.characterProfile.findMany({
          where: { projectId: project.id },
          select: { id: true, name: true, role: true, referenceImagePath: true },
        })
      : [];
    const { sheetPaths, selectedNames, missingNames, onScreen } = project.useReference
      ? collectNarratorOnScreenSheets({
          cast,
          characterId: clip.characterId,
          sceneDescription: clip.sceneDescription,
          imagePrompt: clip.imagePrompt,
          dialogue: clip.dialogue,
          shotType: clip.shotType,
        })
      : { sheetPaths: [] as string[], selectedNames: [] as string[], missingNames: [] as string[], onScreen: [] };

    if (isNarratorTake && characterImage && !sheetPaths.includes(characterImage) && fs.existsSync(characterImage)) {
      sheetPaths.unshift(characterImage);
      if (!selectedNames.includes("anlatıcı")) selectedNames.push("anlatıcı");
    }

    let previousLastFrame: string | null = null;
    const allowLastFrame =
      project.usePrevLastFrame &&
      sheetPaths.length === 0 &&
      (isNarratorTake || onScreen.length === 0);
    if (allowLastFrame && clip.index > 1) {
      const prev = await prisma.clip.findFirst({
        where: {
          projectId: project.id,
          languageVariant: clip.languageVariant,
          index: { lt: clip.index },
          lastFramePath: { not: null },
          ...(isNarratorTake ? { shotType: "narrator" } : { shotType: "cutaway" }),
        },
        orderBy: { index: "desc" },
      });
      if (prev?.lastFramePath && fs.existsSync(prev.lastFramePath)) previousLastFrame = prev.lastFramePath;
    }

    const paths = uniqueExistingImagePaths(
      pickNarratorFilmReferencePaths({
        previousLastFrame,
        sceneCharacterImages: sheetPaths,
        usePrevLastFrame: allowLastFrame,
        useReference: project.useReference,
      })
    );

    if (selectedNames.length > 0) {
      await recordEvent({
        projectId: project.id,
        clipId: clip.id,
        step: "flow",
        message: `Klip ${clip.index}: film referansi — ${selectedNames.join(", ")} (${paths.length} sheet, last-frame yok)`,
      });
    } else if (previousLastFrame && paths.length > 0) {
      await recordEvent({
        projectId: project.id,
        clipId: clip.id,
        step: "flow",
        message: `Klip ${clip.index}: kisisiz sahne — yalnizca onceki son kare (mekan/isik)`,
      });
    }

    if (missingNames.length > 0) {
      await recordEvent({
        projectId: project.id,
        clipId: clip.id,
        step: "flow",
        level: "warning",
        message: `Klip ${clip.index}: kadroda kimlik gorseli eksik — ${missingNames.join(", ")}. Karakter sekmesinden tek kisi gorseli uretin; yoksa yuz bozulabilir.`,
      });
    }

    return paths;
  }

  const paths: string[] = [];

  // Onceki son kare: anlaticida TEK referans.
  if (project.usePrevLastFrame && clip.index > 1) {
    const prev = await prisma.clip.findFirst({
      where: {
        projectId: project.id,
        languageVariant: clip.languageVariant,
        index: { lt: clip.index },
        shotType: "narrator",
        lastFramePath: { not: null },
      },
      orderBy: { index: "desc" },
    });
    if (prev?.lastFramePath && fs.existsSync(prev.lastFramePath)) {
      return [prev.lastFramePath];
    }
  }

  if (paths.length === 0 && project.useReference && characterImage && fs.existsSync(characterImage)) {
    paths.push(characterImage);
  }

  return uniqueExistingImagePaths(paths);
}

/** Basarisiz/elle-mudahale klibini kuyruga geri alir. */
export async function retryClip(clipId: string): Promise<void> {
  const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });

  // Tamamlanan klibi yeniden yap: eski video/kareyi sil ki motor yeniden uretsin
  if (clip.status === "completed") {
    for (const filePath of [clip.videoPath, clip.lastFramePath]) {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // silinemedi; yine de yollari temizleyip yeniden uretimi dene
        }
      }
    }
  }

  await prisma.clip.update({
    where: { id: clipId },
    data: {
      status: "pending",
      attemptCount: 0,
      errorMessage: null,
      videoPath: null,
      lastFramePath: null,
      actualDurationSeconds: null,
    },
  });
  publishEvent(clip.projectId, {
    type: "clip",
    payload: {
      id: clipId,
      index: clip.index,
      status: "pending",
      attemptCount: 0,
      errorMessage: null,
      videoPath: null,
    },
  });
  await recordEvent({
    projectId: clip.projectId,
    clipId,
    step: "clip",
    message:
      clip.status === "completed"
        ? `Klip ${clip.index} yeniden yapilacak (eski video temizlendi)`
        : `Klip ${clip.index} yeniden kuyruga alindi`,
  });
}

/** Tum basarisiz klipleri kuyruga geri alir. */
export async function retryAllFailedClips(projectId: string): Promise<number> {
  const failed = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary", status: { in: ["failed", "needs_manual_action", "retrying", "paused"] } },
  });
  for (const clip of failed) {
    await prisma.clip.update({ where: { id: clip.id }, data: { status: "pending", attemptCount: 0, errorMessage: null } });
    publishEvent(projectId, { type: "clip", payload: { id: clip.id, index: clip.index, status: "pending", attemptCount: 0 } });
  }
  await recordEvent({ projectId, step: "clip", message: `${failed.length} basarisiz klip yeniden kuyruga alindi` });
  return failed.length;
}

/**
 * Projeyi bastan baslatmak icin sifirlar: tum kliplerin durumunu "draft"a
 * dondurur, deneme sayacini ve hata mesajlarini temizler. Istege bagli olarak
 * uretilmis video/kare dosyalarini da diskten siler.
 */
export async function resetAutomation(projectId: string, options?: { deleteVideos?: boolean }): Promise<{ resetCount: number }> {
  // Bu proje icin su an calisan bir is varsa once durdur (diger projeler etkilenmez).
  const control = controlFor(projectId);
  if (control.runningJobId) {
    const runningJobId = control.runningJobId;
    control.stopRequested = true;
    control.pauseRequested = false;
    for (let i = 0; i < 40 && control.runningJobId === runningJobId; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }

  await prisma.automationJob.updateMany({
    where: { projectId, state: { in: ["pending", "running", "paused", "needs_manual_action"] } },
    data: { state: "stopped", finishedAt: new Date() },
  });

  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant: "primary" } });
  if (options?.deleteVideos) {
    for (const clip of clips) {
      for (const filePath of [clip.videoPath, clip.lastFramePath]) {
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch {
            // dosya silinemedi, sifirlamayi durdurmaya deger degil
          }
        }
      }
    }
  }

  const result = await prisma.clip.updateMany({
    where: { projectId, languageVariant: "primary" },
    data: {
      status: "draft",
      attemptCount: 0,
      videoPath: null,
      lastFramePath: null,
      errorMessage: null,
      actualDurationSeconds: null,
    },
  });

  for (const clip of clips) {
    publishEvent(projectId, {
      type: "clip",
      payload: { id: clip.id, index: clip.index, status: "draft", attemptCount: 0, errorMessage: null, videoPath: null },
    });
  }

  await prisma.project.update({ where: { id: projectId }, data: { status: "prompts_ready" } });
  publishEvent(projectId, { type: "project", payload: { id: projectId, status: "prompts_ready" } });

  await recordEvent({
    projectId,
    step: "job",
    message: `Otomasyon sifirlandi: ${result.count} klip 'taslak' durumuna alindi${options?.deleteVideos ? "; video dosyalari silindi" : ""}. Baslatildiginda 1. klipten basiyacak.`,
  });

  return { resetCount: result.count };
}

/** Uygulama yeniden basladiginda yarim kalan isleri isaretler (instrumentation'dan cagrilir). */
export async function recoverInterruptedJobs(): Promise<void> {
  const interrupted = await prisma.automationJob.findMany({ where: { state: { in: ["running", "pending"] } } });
  for (const job of interrupted) {
    try {
      const updated = await prisma.automationJob.updateMany({
        where: { id: job.id },
        data: {
          state: "paused",
          pausedReason: "Uygulama yeniden basladi; tamamlanmis kliplerden devam etmek icin otomasyonu tekrar baslatin",
        },
      });
      if (updated.count === 0) continue;
      const projectExists = await prisma.project.findUnique({ where: { id: job.projectId }, select: { id: true } });
      if (!projectExists) continue;
      await recordEvent({
        projectId: job.projectId,
        jobId: job.id,
        step: "job",
        level: "warning",
        message: "Uygulama yeniden basladi: is duraklatildi. Otomasyonu baslattiginizda tamamlanmis klipler atlanacak.",
      });
    } catch (err) {
      console.warn(`[otomasyon] Kesinti kurtarma atlandi (${job.id}):`, err instanceof Error ? err.message : err);
    }
  }
  // Yarim kalan klip durumlarini toparla. Kesinti bizim yeniden baslatmamizdan
  // kaynaklandigi icin deneme sayaci da sifirlanir; aksi halde klip haksiz yere
  // "maksimum deneme asildi"ya duser.
  await prisma.clip.updateMany({
    where: { status: { notIn: ["draft", "pending", "completed", "failed", "needs_manual_action"] } },
    data: { status: "pending", attemptCount: 0 },
  });
}

/** Yari otomatik modda tek klip calistirir (kuyruk olmadan). */
export async function ensureBrowserForManualFlow(): Promise<void> {
  await openFlowBrowser();
}

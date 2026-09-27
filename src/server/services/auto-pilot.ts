import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/server/db";
import { recordEvent } from "@/server/lib/logger";
import { publishEvent } from "@/server/lib/events";
import { ensureProjectDirs } from "@/server/lib/paths";
import { isLongformCancelledError } from "@/server/services/longform-jobs";

/**
 * Otopilot: proje olusur olusmaz zinciri kendi basina yurutur — RENDER HARIC.
 *
 * Sinema (narrator): hikaye → kliplere bol (film plani + kadro) → TUM kadro
 * gorselleri (ana + yan, sirayla) → Flow otomasyonu (klip videolari) →
 * otomasyon bitince kapak → "Render sizde".
 *
 * Gorsel anlati (longform): runLongformProduction("auto") — senaryo → beat →
 * ses → kareler; montaj kullanicida.
 *
 * Adimlar idempotent: var olan hikaye/klip/gorsel atlanir. Flow girisi gibi
 * elle mudahale gerekirse net olay kaydiyla durur; ayni buton kaldigi yerden
 * devam ettirir.
 */

export type AutoPilotPhase =
  | "idle"
  | "story"
  | "clips"
  | "characters"
  | "prompts"
  | "automation"
  | "thumbnail"
  | "produce"
  | "retrying"
  | "done"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface AutoPilotStatus {
  projectId: string;
  running: boolean;
  phase: AutoPilotPhase;
  message: string;
  error: string;
  startedAt: number;
  updatedAt: number;
}

/**
 * Is listesi globalThis'e baglanir: dev'de modul her guncellendiginde (HMR)
 * yeni kopya ayni haritayi gorur. Eskiden yeni kopya BOS harita aliyordu;
 * calisan dongu API'den ulasilamaz "zombi"ye donusuyor, kullanici durduramiyordu.
 */
type AutoPilotJob = AutoPilotStatus & { cancelRequested: boolean };
const globalForAutoPilot = globalThis as unknown as { autoPilotJobs?: Map<string, AutoPilotJob> };
const jobs: Map<string, AutoPilotJob> = globalForAutoPilot.autoPilotJobs ?? new Map<string, AutoPilotJob>();
if (!globalForAutoPilot.autoPilotJobs) globalForAutoPilot.autoPilotJobs = jobs;

/** Durum diske de yazilir: uygulama/dev yeniden baslasa bile "devam et" gorunur. */
async function statusFilePath(projectId: string): Promise<string | null> {
  try {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } });
    if (!project) return null;
    return path.join(ensureProjectDirs(project.slug), "autopilot.json");
  } catch {
    return null;
  }
}

function persistStatus(projectId: string): void {
  const pub = memoryStatus(projectId);
  if (!pub) return;
  void statusFilePath(projectId).then((file) => {
    if (!file) return;
    try {
      fs.writeFileSync(file, JSON.stringify(pub, null, 2), "utf8");
    } catch {
      // disk yazilamadiysa bellek durumu yeterli
    }
  });
}

function memoryStatus(projectId: string): AutoPilotStatus | null {
  const job = jobs.get(projectId);
  if (!job) return null;
  const { cancelRequested: _cancel, ...pub } = job;
  return pub;
}

export async function autoPilotStatus(projectId: string): Promise<AutoPilotStatus | null> {
  const mem = memoryStatus(projectId);
  if (mem) return mem;
  // Bellekte yok (uygulama yeniden basladi): diskteki son durumu goster.
  const file = await statusFilePath(projectId);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as AutoPilotStatus;
    if (saved.running) {
      // Kosarken uygulama kapanmis: kullaniciya devam butonu gosterilsin.
      return {
        ...saved,
        running: false,
        phase: "interrupted",
        message: "Uygulama yeniden basladi — Kaldigi yerden devam et ile surdurun.",
      };
    }
    return saved;
  } catch {
    return null;
  }
}

export function cancelAutoPilot(projectId: string): boolean {
  const job = jobs.get(projectId);
  if (!job || !job.running) return false;
  job.cancelRequested = true;
  job.message = "Iptal istendi — mevcut adim bitince durur";
  job.updatedAt = Date.now();
  persistStatus(projectId);
  return true;
}

class AutoPilotCancelledError extends Error {
  constructor() {
    super("Otopilot kullanici istegiyle durduruldu");
    this.name = "AutoPilotCancelledError";
  }
}

function update(projectId: string, patch: Partial<AutoPilotStatus>): void {
  const job = jobs.get(projectId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
  publishEvent(projectId, { type: "autopilot", payload: memoryStatus(projectId) });
  persistStatus(projectId);
}

function assertContinuing(projectId: string): void {
  const job = jobs.get(projectId);
  if (job?.cancelRequested) throw new AutoPilotCancelledError();
}

async function note(projectId: string, message: string, level: "info" | "warning" | "error" = "info"): Promise<void> {
  update(projectId, { message });
  await recordEvent({ projectId, step: "autopilot", level, message });
}

export function startAutoPilot(projectId: string): AutoPilotStatus {
  const existing = jobs.get(projectId);
  if (existing?.running) {
    throw new Error("Otopilot bu projede zaten calisiyor.");
  }
  const job: AutoPilotStatus & { cancelRequested: boolean } = {
    projectId,
    running: true,
    phase: "idle",
    message: "Otopilot basladi",
    error: "",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    cancelRequested: false,
  };
  jobs.set(projectId, job);
  persistStatus(projectId);

  // HATA MODU = KENDINI TOPARLA: adimlar idempotent oldugu icin hata alinca
  // 20 sn sonra kaldigi yerden OTOMATIK devam edilir (3 hakka kadar).
  // Yalnizca kullanici iptali otomatik devami durdurur.
  const AUTO_RESUME_DELAY_MS = 20_000;
  const MAX_RUNS = 4; // ilk kosu + 3 otomatik devam

  const safeEvent = (level: "warning" | "error", message: string) =>
    recordEvent({ projectId, step: "autopilot", level, message }).catch(() => {});

  const projectGone = (err: unknown, message: string): boolean => {
    const code =
      typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    // P2025: kayit yok, P2003: silinen projeye FK — ikisi de "proje gitti" demektir.
    return (
      code === "P2025" ||
      code === "P2003" ||
      /No 'Project' record|Record to update not found|kayit bulunamadi/i.test(message)
    );
  };

  // CANLILIK NABZI: arastirma / senaryo / cekim plani gibi uzun adimlar dakikalarca
  // durum guncellemez; ilerleme ucu 90 sn guncelleme gormeyince isi "durdu" sayiyordu
  // (is aslinda calisiyordu). Kosu boyunca 20 sn'de bir tazelenir; mesaj en son olaydan.
  const heartbeat = setInterval(() => {
    const job = jobs.get(projectId);
    if (!job?.running) return;
    void prisma.automationEvent
      .findFirst({
        where: { projectId, createdAt: { gte: new Date(job.startedAt) }, level: { not: "error" } },
        orderBy: { createdAt: "desc" },
        select: { message: true },
      })
      .then((latest) => {
        const current = jobs.get(projectId);
        if (!current?.running) return;
        if (latest?.message && current.phase !== "retrying") current.message = latest.message.slice(0, 200);
        current.updatedAt = Date.now();
        publishEvent(projectId, { type: "autopilot", payload: memoryStatus(projectId) });
        persistStatus(projectId);
      })
      .catch(() => {
        const current = jobs.get(projectId);
        if (!current?.running) return;
        current.updatedAt = Date.now();
        persistStatus(projectId);
      });
  }, 20_000);

  void (async () => {
    for (let run = 1; run <= MAX_RUNS; run += 1) {
      try {
        await runAutoPilot(projectId);
        const j = jobs.get(projectId);
        if (j && j.phase !== "failed" && j.phase !== "cancelled") {
          update(projectId, { phase: "done", running: false });
        } else if (j) {
          update(projectId, { running: false });
        }
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof AutoPilotCancelledError) {
          update(projectId, { phase: "cancelled", running: false, message });
          await safeEvent("warning", message);
          return;
        }
        // KULLANICI "durdur" dedi: gorsel uretim iptali HATA degildir.
        // Eskiden generic hata sayilip 20 sn sonra OTOMATIK yeniden baslatiliyordu;
        // kullanici durduramiyordu. Iptal = otopilot da durur.
        if (isLongformCancelledError(err)) {
          update(projectId, {
            phase: "cancelled",
            running: false,
            message: "Uretim kullanici istegiyle durduruldu — otopilot da durdu",
          });
          await safeEvent("warning", "Uretim iptal edildi; otopilot yeniden BASLATMAYACAK.");
          return;
        }
        // Proje silinmis: sessizce birak — tekrar denemenin anlami yok.
        if (projectGone(err, message)) {
          jobs.delete(projectId);
          return;
        }
        if (run < MAX_RUNS) {
          update(projectId, {
            phase: "retrying",
            running: true,
            error: message,
            message: `Hata: ${message.slice(0, 140)} — ${Math.round(AUTO_RESUME_DELAY_MS / 1000)} sn sonra kaldigi yerden OTOMATIK devam (deneme ${run + 1}/${MAX_RUNS})`,
          });
          await safeEvent(
            "warning",
            `Otopilot hata aldi, kaldigi yerden OTOMATIK devam edecek (${run + 1}/${MAX_RUNS}): ${message.slice(0, 160)}`
          );
          const until = Date.now() + AUTO_RESUME_DELAY_MS;
          while (Date.now() < until) {
            if (jobs.get(projectId)?.cancelRequested) {
              update(projectId, { phase: "cancelled", running: false, message: "Otopilot kullanici istegiyle durduruldu" });
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
          continue;
        }
        update(projectId, { phase: "failed", running: false, error: message, message: `Otopilot durdu: ${message}` });
        await safeEvent(
          "error",
          `Otopilot ${MAX_RUNS} denemeye ragmen ilerleyemedi: ${message.slice(0, 200)} — sorunu cozup "Kaldigi yerden devam et" ile surdurebilirsiniz.`
        );
        return;
      }
    }
  })().finally(() => clearInterval(heartbeat));
  return memoryStatus(projectId)!;
}

/**
 * Sunucu acilisinda yarim kalmis otopilotlari OTOMATIK surdurur —
 * uygulama kapansa bile is yarida kalmaz. (Iptal/bitmis olanlar dokunulmaz.)
 */
export async function resumeInterruptedAutoPilots(): Promise<number> {
  const projects = await prisma.project.findMany({ select: { id: true, slug: true } });
  let resumed = 0;
  for (const project of projects) {
    try {
      const file = path.join(ensureProjectDirs(project.slug), "autopilot.json");
      if (!fs.existsSync(file)) continue;
      const saved = JSON.parse(fs.readFileSync(file, "utf8")) as AutoPilotStatus;
      if (!saved?.running) continue;
      if (jobs.get(project.id)?.running) continue;
      await recordEvent({
        projectId: project.id,
        step: "autopilot",
        level: "warning",
        message: "Uygulama yeniden basladi — otopilot kaldigi yerden OTOMATIK devam ediyor.",
      });
      startAutoPilot(project.id);
      resumed += 1;
    } catch {
      continue;
    }
  }
  return resumed;
}

async function runAutoPilot(projectId: string): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  if (project.templateType === "longform") {
    // Gorsel anlati: mevcut orkestrator, mix haric.
    update(projectId, { phase: "produce" });
    await note(projectId, "Gorsel anlati otomatik uretim: senaryo → parcalar → ses → kareler (montaj sizde)");
    const { runLongformProduction } = await import("@/server/services/longform");
    await runLongformProduction(projectId, { step: "auto" });
    assertContinuing(projectId);
    update(projectId, { phase: "thumbnail" });
    await generateAutoThumbnailSafe(projectId);
    await note(projectId, "Otopilot bitti: her sey hazir — MONTAJ (render) sizde.");
    return;
  }

  // ---- Sinema (narrator) zinciri ----

  // 1) Hikaye
  assertContinuing(projectId);
  update(projectId, { phase: "story" });
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  if (!story?.fullStory.trim()) {
    await note(projectId, "Hikaye yaziliyor (secilen tur + sure + dil)");
    const { generateStory } = await import("@/server/services/story");
    await generateStory(projectId);
  } else {
    await note(projectId, "Hikaye zaten hazir — atlandi");
  }

  // 2) Kliplere bol (film plani + kadro cikarimi dahil)
  assertContinuing(projectId);
  update(projectId, { phase: "clips" });
  const clipCount = await prisma.clip.count({ where: { projectId, languageVariant: "primary" } });
  if (clipCount === 0) {
    await note(projectId, "Hikaye kliplere bolunuyor (film plani + kadro)");
    const { splitProjectStory } = await import("@/server/services/clips");
    await splitProjectStory(projectId);
  } else {
    await note(projectId, `${clipCount} klip zaten hazir — bolme atlandi`);
  }

  // 3) Kadro gorselleri: klipte adi gecen HERKES (ana + yan) sirayla.
  assertContinuing(projectId);
  update(projectId, { phase: "characters" });
  await generateMissingCastImages(projectId);

  // 4) Promptlar — manuel "Tum Promptlari Olustur" butonunun BIREBIR aynisi.
  //    (startAutomation promptsuz/eski promptlu klipleri reddeder; manuel akista
  //    kullanici bu butona basiyordu — otopilot ayni fonksiyonu cagirir.)
  assertContinuing(projectId);
  update(projectId, { phase: "prompts" });
  {
    const pending = await prisma.clip.count({
      where: { projectId, languageVariant: "primary", status: { not: "completed" } },
    });
    if (pending > 0) {
      await note(projectId, "Klip promptlari olusturuluyor (manuel butonla ayni)");
      const { buildPromptsForProject } = await import("@/server/services/clips");
      await buildPromptsForProject(projectId);
    } else {
      await note(projectId, "Tum klipler zaten tamam — prompt adimi atlandi");
    }
  }

  // 5) Flow otomasyonu — manuel Baslat/Devam butonlarinin BIREBIR aynisi:
  //    calisan is varsa duraklatma kaldirilir, yoksa yeni is baslatilir
  //    (tamamlanmis klipler motor tarafindan zaten atlanir).
  assertContinuing(projectId);
  update(projectId, { phase: "automation" });
  const { startAutomation, resumeAutomation, engineStatus } = await import("@/server/automation/engine");
  const remaining = await prisma.clip.count({
    where: { projectId, languageVariant: "primary", status: { not: "completed" } },
  });
  if (remaining === 0) {
    await note(projectId, "Tum klip videolari zaten hazir — otomasyon atlandi");
  } else if (engineStatus(projectId).loopAlive) {
    resumeAutomation(projectId);
    await note(projectId, "Calisan otomasyon devam ettirildi (manuel Devam ile ayni)");
  } else {
    await note(projectId, "Flow otomasyonu basladi — tum klipler uretilecek");
    await startAutomation(projectId);
  }

  // Otomasyonun bitisini bekle (iptal edilebilir; 15 sn'de bir kontrol)
  const finished = await waitForAutomation(projectId);
  assertContinuing(projectId);

  // 5) Kapak (render'i beklemez — klip videolarindan kare secer)
  update(projectId, { phase: "thumbnail" });
  await generateAutoThumbnailSafe(projectId);

  if (finished === "completed") {
    await note(projectId, "Otopilot bitti: hikaye, klipler, kadro, videolar ve kapak hazir — RENDER sizde.");
  } else {
    await note(
      projectId,
      `Otopilot bitti (otomasyon durumu: ${finished}). Basarisiz klipleri panelden inceleyip yeniden deneyebilirsiniz; render sizde.`,
      "warning"
    );
  }
}

/** Kadrodaki gorselsiz herkese sirayla Flow referans gorseli uretir; hatada atlar. */
async function generateMissingCastImages(projectId: string): Promise<void> {
  const { generateMissingCastImages: run } = await import("@/server/services/character-flow");
  const result = await run(projectId, {
    autoApprove: true,
    onProgress: (message) => update(projectId, { message }),
    assertContinuing: () => assertContinuing(projectId),
  });
  if (result.failed.length > 0) {
    await note(
      projectId,
      `Kadro gorselleri: ${result.ok} uretildi, ${result.failed.length} atlandi (${result.failed.join(", ")}) — Karakter sekmesinden tek tek yeniden deneyebilirsiniz.`,
      "warning"
    );
  } else if (result.ok > 0) {
    await note(projectId, `Kadro gorselleri tamam: ${result.ok} kisi uretildi`);
  } else {
    await note(projectId, `Kadro gorselleri tam — atlandi`);
  }
}

/** Otomasyon isinin bitisini DB'den izler. */
async function waitForAutomation(projectId: string): Promise<string> {
  for (;;) {
    assertContinuing(projectId);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const job = await prisma.automationJob.findFirst({
      where: { projectId, type: "flow_generation" },
      orderBy: { createdAt: "desc" },
    });
    if (!job) return "yok";
    if (["completed", "failed", "stopped", "needs_manual_action"].includes(job.state)) {
      return job.state;
    }
    update(projectId, { message: "Flow otomasyonu calisiyor — klipler uretiliyor" });
  }
}

/** Kapak uretimi otopilotu asla dusurmesin. */
async function generateAutoThumbnailSafe(projectId: string): Promise<void> {
  try {
    const { generateAutoThumbnail } = await import("@/server/services/publish");
    const result = await generateAutoThumbnail(projectId);
    await note(projectId, `Kapak hazir: ${result.note}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordEvent({
      projectId,
      step: "autopilot",
      level: "warning",
      message: `Kapak otomatik uretilemedi (Yayin sekmesinden manuel uretebilirsiniz): ${msg.slice(0, 160)}`,
    });
  }
}

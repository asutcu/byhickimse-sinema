import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Otomasyon iptal / durdur bayraklari — PROJE BASINA.
 *
 * Birden fazla proje ayni anda calisabildigi icin tek global bayrak yeterli
 * degildir: bir projeyi durdurmak digerlerini durdurmamali. Her projenin kendi
 * kontrol nesnesi vardir.
 *
 * Flow adapter'daki onlarca `assertAutomationContinuing()` cagrisina projectId
 * tasimamak icin AsyncLocalStorage kullanilir: is dongusu kendini bir proje
 * baglaminda calistirir, derinlerdeki cagrilar hangi projeye ait olduklarini
 * otomatik bilir. Baglam disinda (kalibrasyon, karakter uretimi) kontrol yoktur
 * ve cagrilar sessizce gecer — eski davranisla ayni.
 */

export interface AutomationControl {
  runningJobId: string | null;
  pauseRequested: boolean;
  stopRequested: boolean;
  cancelCurrentClip: boolean;
  /** runJobLoop her turda gunceller; yetim runningJobId tespiti icin. */
  loopHeartbeatMs: number;
}

/**
 * Bir dongunun "canli" sayilmasi icin heartbeat'in ne kadar TAZE olmasi gerektigi.
 *
 * ONEMLI: Tek bir otomasyon ADIMI (ör. cok referansli uploadReferenceImages,
 * her biri birkac saniye suren birden fazla tiklama/yukleme icerir) heartbeat'i
 * yalniz adim BASLARKEN ve BITERKEN dokunur (throwIfCancelled/assertAutomationContinuing
 * adim sinirlarinda cagrilir); adimin KENDI ICINDE dokunulmaz. Gozlemlenen gercek
 * gecikme tek bir referans yukleme adiminda ~36 sn'ye kadar cikabiliyor. Esik
 * cok dusuk olursa (eski deger: 15 sn) reconcileOrphanJobs GERCEKTEN CALISAN bir
 * isi "yetim" sanip runningJobId'yi sifirlar ve kontrolu haritadan duserur — bu
 * durumda is arka planda gorunmez/durdurulamaz sekilde calismaya devam eder.
 * generationTimeoutMs varsayilani 420 sn (7 dk) oldugundan 180 sn hem gercek
 * adim gecikmelerine bol pay birakir hem de gercekten donmus bir isi makul
 * surede tespit eder.
 */
export const HEARTBEAT_STALE_MS = 180_000;

interface EngineState {
  controls: Map<string, AutomationControl>;
  storage: AsyncLocalStorage<string>;
}

const globalForEngine = globalThis as unknown as { automationEngineState?: EngineState };

const engineState: EngineState = globalForEngine.automationEngineState ?? {
  controls: new Map<string, AutomationControl>(),
  storage: new AsyncLocalStorage<string>(),
};
if (!globalForEngine.automationEngineState) globalForEngine.automationEngineState = engineState;

function emptyControl(): AutomationControl {
  return {
    runningJobId: null,
    pauseRequested: false,
    stopRequested: false,
    cancelCurrentClip: false,
    loopHeartbeatMs: 0,
  };
}

/** Projenin kontrol nesnesi (yoksa olusturur). */
export function controlFor(projectId: string): AutomationControl {
  const existing = engineState.controls.get(projectId);
  if (existing) return existing;
  const created = emptyControl();
  engineState.controls.set(projectId, created);
  return created;
}

/** Kontrol nesnesi varsa dondurur; yoksa olusturmaz (durum sorgulari icin). */
export function peekControl(projectId: string): AutomationControl | null {
  return engineState.controls.get(projectId) ?? null;
}

export function dropControl(projectId: string): void {
  engineState.controls.delete(projectId);
}

/** Bir isi olan (veya kalintisi duran) tum projeler. */
export function allControls(): Array<{ projectId: string; control: AutomationControl }> {
  return [...engineState.controls.entries()].map(([projectId, control]) => ({ projectId, control }));
}

/** Canli dongusu olan projeler (heartbeat HEARTBEAT_STALE_MS icinde). */
export function liveProjectIds(): string[] {
  const now = Date.now();
  return allControls()
    .filter(({ control }) => !!control.runningJobId && now - (control.loopHeartbeatMs || 0) < HEARTBEAT_STALE_MS)
    .map(({ projectId }) => projectId);
}

/** Icindeki tum async cagrilar bu projeye ait sayilir. */
export function runInProjectContext<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  return engineState.storage.run(projectId, fn);
}

/** Bulundugumuz async baglamdaki proje (yoksa null). */
export function currentProjectId(): string | null {
  return engineState.storage.getStore() ?? null;
}

export class AutomationStoppedError extends Error {
  constructor() {
    super("Otomasyon kullanici tarafindan durduruldu");
    this.name = "AutomationStoppedError";
  }
}

export class ClipCancelledError extends Error {
  constructor() {
    super("Klip kullanici tarafindan iptal edildi");
    this.name = "ClipCancelledError";
  }
}

/**
 * Uzun Playwright / bekleme dongulerinde cagir — durdur veya klip iptali firlatir.
 * Bir is baglaminda degilsek (kalibrasyon, karakter uretimi) hicbir sey yapmaz.
 */
export function assertAutomationContinuing(): void {
  const projectId = currentProjectId();
  if (!projectId) return;
  const control = peekControl(projectId);
  if (!control) return;

  control.loopHeartbeatMs = Date.now();
  if (control.stopRequested) {
    throw new AutomationStoppedError();
  }
  if (control.cancelCurrentClip) {
    control.cancelCurrentClip = false;
    throw new ClipCancelledError();
  }
}

/** Durdur/iptal dinleyen uyku (sayfa bagimsiz). */
export async function interruptibleSleep(ms: number, stepMs = 250): Promise<void> {
  const deadline = Date.now() + Math.max(0, ms);
  while (Date.now() < deadline) {
    assertAutomationContinuing();
    const slice = Math.min(stepMs, deadline - Date.now());
    if (slice <= 0) break;
    await new Promise<void>((resolve) => setTimeout(resolve, slice));
  }
}

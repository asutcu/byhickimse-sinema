import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSettings, healChromeProfileDirIfStale } from "@/server/services/settings";
import { recordEvent } from "@/server/lib/logger";
import { publishEvent } from "@/server/lib/events";
import { flowProjectIdFromUrl, sameFlowProject } from "@/lib/flow-project-url";

const execFileAsync = promisify(execFile);

/**
 * Ayni user-data-dir ile acik Chrome sureclerini bulur (Windows).
 * Playwright profili kilitliyken yeni launch "browser has been closed" ile dusar.
 */
async function listChromePidsUsingProfile(profileDir: string): Promise<number[]> {
  if (process.platform !== "win32") return [];
  const needle = path.resolve(profileDir).toLowerCase();
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
        { windowsHide: true, timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }
    );
    const raw = stdout.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { ProcessId?: number; CommandLine?: string } | Array<{ ProcessId?: number; CommandLine?: string }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const pids: number[] = [];
    for (const row of rows) {
      const cmd = (row.CommandLine || "").toLowerCase();
      const pid = Number(row.ProcessId);
      if (!pid || !cmd.includes("--user-data-dir=")) continue;
      // Yol eslesmesi: bosluklu/Unicode klasor adlari icin normalize
      const normalizedCmd = cmd.replace(/\//g, "\\");
      if (normalizedCmd.includes(needle) || normalizedCmd.includes(needle.replace(/\\/g, "\\\\"))) {
        pids.push(pid);
      }
    }
    return [...new Set(pids)];
  } catch {
    return [];
  }
}

/** Olu kilit dosyalarini siler; canli Chrome yoksa Singleton* kalintilarini temizler. */
function clearStaleProfileLockFiles(profileDir: string): void {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const file = path.join(profileDir, name);
    try {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    } catch {
      // kilitli dosya olabilir; asagidaki kill denemesi sonrasi tekrar denenir
    }
  }
}

/**
 * Bu otomasyon profilini tutan Chrome sureclerini kapatir.
 * Kullanicinin normal Chrome oturumuna dokunmaz — yalnizca ayni --user-data-dir.
 */
async function releaseChromeProfile(profileDir: string): Promise<void> {
  const pids = await listChromePidsUsingProfile(profileDir);
  if (pids.length > 0) {
    await recordEvent({
      step: "browser",
      level: "warning",
      message: `Ayni Chrome profilini tutan ${pids.length} surec kapatiliyor (kilit acilsin): ${pids.slice(0, 8).join(", ")}`,
    });
    for (const pid of pids) {
      try {
        process.kill(pid);
      } catch {
        // zaten olmus olabilir
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  clearStaleProfileLockFiles(profileDir);
}

function isBrowserClosedLaunchError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /has been closed|Target page, context or browser|Browser closed|Target closed/i.test(message);
}

/**
 * Kalici profilli Chrome yonetimi.
 * - Google sifresi hicbir yerde saklanmaz/istenmez
 * - Kullanici ilk calistirmada acilan Chrome'da Google'a ELLE giris yapar
 * - Oturum, profil klasorunde kalici olarak saklanir
 *
 * PARALEL PROJE DESTEGI: tek Chrome penceresi (tek profil = tek Google oturumu)
 * icinde PROJE BASINA AYRI SEKME acilir. Ayri profil kullanmiyoruz: her profil
 * ayri Google girisi ister ve ayni hesabi cok oturumda surekli otomatize etmek
 * risklidir. Sekmeler ayni oturumu paylasir, birbirinden bagimsiz calisir.
 */

interface BrowserState {
  context: BrowserContext | null;
  /** Paylasilan ana sekme: kalibrasyon, oturum kontrolu, tek-proje akislari. */
  page: Page | null;
  /** projectId -> o projeye ayrilmis sekme (paralel otomasyon). */
  projectPages: Map<string, Page>;
  opening: Promise<Page> | null;
  /** openFlowBrowser baslama zamani; takili acilisi iptal etmek icin. */
  openingStartedAt: number;
}

const globalForBrowser = globalThis as unknown as { flowBrowser?: BrowserState };
const state: BrowserState = globalForBrowser.flowBrowser ?? {
  context: null,
  page: null,
  projectPages: new Map<string, Page>(),
  opening: null,
  openingStartedAt: 0,
};
if (!globalForBrowser.flowBrowser) globalForBrowser.flowBrowser = state;
// Eski surecten devralinan state'te alan eksik olabilir (sicak yeniden yukleme)
if (!state.projectPages) state.projectPages = new Map<string, Page>();
if (typeof state.openingStartedAt !== "number") state.openingStartedAt = 0;

/** Bos / yeni sekme — Flow adresine gidilmesi gerekir. */
export function flowPageNeedsNavigation(url: string): boolean {
  const u = (url || "").trim().toLowerCase();
  if (!u || u === "about:blank") return true;
  return u.startsWith("chrome://") || u.startsWith("edge://") || u.startsWith("devtools://");
}

/**
 * Eski Chrome context kapaninca state'i sil: yalnizca HALEN o context ise.
 * Aksi halde yeni acilan oturum, eskisinin "close" olayiyla silinir ve
 * "Tarayici baglami acilamadi" ile Flow gorunmez kalir.
 */
export function shouldDropBrowserState(active: unknown, closed: unknown): boolean {
  return active === closed;
}

/** Takili Promise'i sinirla — olu Chrome'da newPage/goto sonsuza kadar bekleyebiliyor. */
export function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} (${ms}ms zaman asimi)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function isOpeningStale(startedAt: number, now = Date.now(), limitMs = 45_000): boolean {
  if (startedAt <= 0) return true;
  return now - startedAt > limitMs;
}

/**
 * Paylasilan ana sekme bu projeye verilebilir mi?
 *
 * Verilemezse projeye KENDI sekmesi acilir. Ana sekme baska bir projenin
 * elindeyken calinirsa iki proje ayni sekmede kalir ve son gidilen Flow
 * adresinde uretim yapilir — video klipleri gorsel anlatinin projesine
 * dusuyordu. Her projenin kendi Flow linki ancak kendi sekmesinde korunur.
 */
export function canTakeMainPage(input: {
  projectId: string;
  /** Ana sekme kimin adina kayitli (yoksa null). */
  mainPageOccupantId: string | null;
  /** Baska projelerin kendi (ana sekme olmayan) acik sekmesi var mi. */
  hasOtherDedicatedTabs: boolean;
}): boolean {
  if (input.hasOtherDedicatedTabs) return false;
  return !input.mainPageOccupantId || input.mainPageOccupantId === input.projectId;
}

/** Session restore / bos sekmeler arasindan Flow sekmesini sec. */
export function pickPreferredPageIndex(urls: string[]): number {
  if (urls.length === 0) return -1;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i] || "";
    if (/labs\.google|flow\.google|\/flow/i.test(url) && !flowPageNeedsNavigation(url)) return i;
  }
  for (let i = 0; i < urls.length; i++) {
    if (!flowPageNeedsNavigation(urls[i] || "")) return i;
  }
  return 0;
}

function contextLooksAlive(context: BrowserContext | null): boolean {
  if (!context) return false;
  try {
    const browser = context.browser();
    if (browser && !browser.isConnected()) return false;
    void context.pages();
    return true;
  } catch {
    return false;
  }
}

function pageIsOpen(page: Page | null): boolean {
  if (!page) return false;
  try {
    return !page.isClosed();
  } catch {
    return false;
  }
}

async function pingPage(page: Page, ms = 2_000): Promise<boolean> {
  if (!pageIsOpen(page)) return false;
  try {
    await raceTimeout(page.evaluate(() => 1), ms, "Chrome sayfa ping");
    return true;
  } catch {
    return false;
  }
}

function forgetDeadHandles(): void {
  if (state.context && !contextLooksAlive(state.context)) {
    state.context = null;
    state.page = null;
    state.projectPages.clear();
    return;
  }
  if (state.page && !pageIsOpen(state.page)) state.page = null;
  for (const [id, page] of state.projectPages) {
    if (!pageIsOpen(page)) state.projectPages.delete(id);
  }
}

function openPagesOf(context: BrowserContext): Page[] {
  try {
    return context.pages().filter((page) => pageIsOpen(page));
  } catch {
    return [];
  }
}

function selectWorkingPage(context: BrowserContext): Page | null {
  const pages = openPagesOf(context);
  if (pages.length === 0) return null;
  const urls = pages.map((page) => {
    try {
      return page.url();
    } catch {
      return "";
    }
  });
  return pages[Math.max(0, pickPreferredPageIndex(urls))];
}

/**
 * Session restore ve probe newPage fazladan sekme biriktiriyordu.
 * claimed disindaki her sekmeyi kapat.
 */
export async function closeUnclaimedFlowTabs(keep: Page): Promise<number> {
  if (!pageIsOpen(keep)) return 0;
  const claimed = new Set<Page>([keep]);
  for (const page of state.projectPages.values()) {
    if (pageIsOpen(page)) claimed.add(page);
  }
  let closed = 0;
  for (const page of openPagesOf(keep.context())) {
    if (claimed.has(page)) continue;
    await page.close().catch(() => {});
    closed += 1;
  }
  return closed;
}

/**
 * Karakter yenileme: bu sekme disindaki BASIBOS sekmeleri kapatir.
 * BASKA projeye ayrilmis sekmeler korunur — onlari kapatmak paralel calisan
 * uretimleri olduruyordu (sekme kapaninca o isin Playwright cagrilari patlar).
 */
export async function keepOnlyThisTab(keep: Page): Promise<void> {
  if (!pageIsOpen(keep)) return;
  const claimedByOthers = new Set<Page>();
  for (const page of state.projectPages.values()) {
    if (page !== keep && pageIsOpen(page)) claimedByOthers.add(page);
  }
  for (const page of openPagesOf(keep.context())) {
    if (page === keep || claimedByOthers.has(page)) continue;
    await page.close().catch(() => {});
  }
  if (!pageIsOpen(state.page)) state.page = keep;
  for (const [id, page] of [...state.projectPages.entries()]) {
    if (!pageIsOpen(page)) state.projectPages.delete(id);
  }
}

async function discardZombieContext(): Promise<void> {
  forgetDeadHandles();
  const context = state.context;
  if (!context) return;

  let responsive = false;
  try {
    const page = selectWorkingPage(context) ?? (state.page && pageIsOpen(state.page) ? state.page : null);
    if (page) {
      responsive = await pingPage(page, 2_000);
      if (responsive) state.page = page;
    }
  } catch {
    responsive = false;
  }

  if (responsive) return;

  state.context = null;
  state.page = null;
  state.projectPages.clear();
  await context.close().catch(() => {});
  await recordEvent({
    step: "browser",
    level: "warning",
    message: "Olu Chrome oturumu atildi; Flow yeniden acilacak",
  });
}

/**
 * Mevcut sekmeyi one al — kucult/geri ac ve tum Chrome pencerelerini
 * ShowWindow ile hortlatma (4-5 pencere aciliyordu).
 */
export async function revealFlowWindow(page: Page): Promise<void> {
  if (!pageIsOpen(page)) return;
  await page.bringToFront().catch(() => {});
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = (await session.send("Browser.getWindowForTarget")) as { windowId: number };
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    await session.detach().catch(() => {});
  } catch {
    // headless veya CDP yok
  }
}

export function isBrowserOpen(): boolean {
  forgetDeadHandles();
  return contextLooksAlive(state.context) && pageIsOpen(state.page);
}

export function getPage(): Page | null {
  return isBrowserOpen() ? state.page : null;
}

/** Projeye ayrilmis sekme (yoksa null). Paralel calismada hata/ekran goruntusu icin. */
export function getProjectPage(projectId: string): Page | null {
  const page = state.projectPages.get(projectId);
  if (!pageIsOpen(page ?? null)) return null;
  return page!;
}

/** Su an sekmesi acik olan proje kimlikleri. */
export function openProjectPageIds(): string[] {
  return [...state.projectPages.entries()].filter(([, page]) => pageIsOpen(page)).map(([id]) => id);
}

async function attachMainPageFromAliveContext(): Promise<Page | null> {
  if (!state.context) return null;
  const page = selectWorkingPage(state.context) ?? (state.page && pageIsOpen(state.page) ? state.page : null);
  if (!page || !(await pingPage(page, 2_000))) return null;
  page.setDefaultTimeout(15_000);
  state.page = page;
  const closed = await closeUnclaimedFlowTabs(page);
  if (flowPageNeedsNavigation(page.url())) {
    const settings = await getSettings();
    await page.goto(settings.flowUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
  }
  await revealFlowWindow(page);
  publishEvent(null, { type: "system", payload: { browser: "open" } });
  await recordEvent({
    step: "browser",
    message: `Mevcut Chrome oturumu yeniden kullanildi${closed > 0 ? ` (${closed} fazla sekme kapatildi)` : ""}`,
    pageUrl: page.url(),
  });
  return page;
}

/** Flow'u kalici profille acar (zaten aciksa mevcut sayfayi dondurur). */
export async function openFlowBrowser(): Promise<Page> {
  if (state.opening) {
    if (isOpeningStale(state.openingStartedAt)) {
      state.opening = null;
      await recordEvent({
        step: "browser",
        level: "warning",
        message: "Onceki Chrome acilisi takildi; yeniden deneniyor",
      });
    } else {
      return state.opening;
    }
  }

  const opening = (async () => {
    await recordEvent({ step: "browser", message: "Flow tarayicisi hazirlaniyor" });
    await discardZombieContext();

    if (state.page && (await pingPage(state.page, 2_000))) {
      await revealFlowWindow(state.page);
      return state.page;
    }

    const reused = await attachMainPageFromAliveContext().catch(() => null);
    if (reused) return reused;

    const settings = await getSettings();
    const profileDir = await healChromeProfileDirIfStale();
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

    await recordEvent({
      step: "browser",
      message: `Chrome aciliyor (profil: ${profileDir}, gorunur pencere)`,
    });

    /*
     * Ayni profil klasorunu kullanan eski Chrome sureci tam kapanmadan yenisi
     * acilirsa, yeni surec eskiye "Mevcut tarayici oturumunda aciliyor" deyip
     * aninda kapanir ("browser has been closed"). Acmadan once kilidi cozeriz.
     */
    await releaseChromeProfile(profileDir);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) await releaseChromeProfile(profileDir);

        const context = await raceTimeout(
          chromium.launchPersistentContext(profileDir, {
            // Karakter yenilemede pencere gorunsun — headless ayari Flow'u "acilmamis" gosteriyordu.
            headless: false,
            channel: "chrome",
            acceptDownloads: true,
            viewport: null,
            timeout: 25_000,
            slowMo: settings.slowMoMs,
            args: [
              "--disable-blink-features=AutomationControlled",
              "--disable-background-timer-throttling",
              "--disable-backgrounding-occluded-windows",
              "--disable-renderer-backgrounding",
            ],
          }),
          30_000,
          "Chrome baslatma"
        );

        const page =
          selectWorkingPage(context) ?? (await raceTimeout(context.newPage(), 8_000, "ilk sekme"));
        page.setDefaultTimeout(15_000);
        const extras = await closeUnclaimedFlowTabs(page);
        if (extras > 0) {
          await recordEvent({
            step: "browser",
            message: `Chrome oturumundan ${extras} fazla sekme kapatildi`,
          });
        }

        await page.waitForTimeout(800);
        if (page.isClosed()) {
          await context.close().catch(() => {});
          throw new Error(
            "Tarayici acilir acilmaz kapandi (Chrome profili baska bir pencerede acik). Bu profili kullanan tum Chrome pencerelerini kapatip tekrar deneyin."
          );
        }

        context.on("close", () => {
          if (!shouldDropBrowserState(state.context, context)) return;
          state.context = null;
          state.page = null;
          state.projectPages.clear();
          publishEvent(null, { type: "system", payload: { browser: "closed" } });
        });

        await page.goto(settings.flowUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });

        state.context = context;
        state.page = page;
        publishEvent(null, { type: "system", payload: { browser: "open" } });
        await recordEvent({ step: "browser", message: "Flow sayfasi acildi", pageUrl: page.url() });
        await revealFlowWindow(page);
        return page;
      } catch (err) {
        lastError = err;
        state.context = null;
        state.page = null;
        if (attempt < 3) {
          await recordEvent({
            step: "browser",
            level: "warning",
            message: `Tarayici acilisi tutmadi (deneme ${attempt}/3); profil kilidi temizlenip 3 sn bekleniyor`,
          });
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    if (isBrowserClosedLaunchError(lastError)) {
      throw new Error(
        `Chrome otomasyon profili acilamadi (profil kilitli veya aninda kapandi). ` +
          `Ayarlar > Chrome profil klasoru: ${profileDir}. ` +
          `Bu klasoru kullanan Chrome pencerelerini kapatin, sonra sheet uretimini tekrar deneyin. (${detail.slice(0, 160)})`
      );
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  })();

  state.openingStartedAt = Date.now();
  state.opening = opening;
  try {
    return await opening;
  } finally {
    if (state.opening === opening) state.opening = null;
  }
}

/**
 * Bir projeye AYRILMIS sekmeyi dondurur; yoksa acar.
 *
 * Ilk proje paylasilan ana sekmeyi devralir (tek proje calisirken bugunku
 * davranis birebir korunur: fazladan sekme acilmaz). Ikinci ve sonraki
 * projeler kendi sekmelerinde acilir, boylece paralel otomasyon birbirinin
 * sayfasina dokunmaz.
 *
 * @param flowProjectUrl Bu projeye ozel Flow adresi; bos ise genel Flow adresi.
 */
/** Sayfa hedef Flow projesinde mi (labs.google -> flow.google.com yonlendirmesi ayni proje sayilir). */
export function pageIsOnTarget(pageUrl: string, targetUrl: string): boolean {
  if (flowProjectIdFromUrl(targetUrl)) return sameFlowProject(pageUrl, targetUrl);
  return pageUrl.split(/[?#]/)[0].startsWith(targetUrl.replace(/\/+$/, ""));
}

export async function acquireProjectPage(projectId: string, flowProjectUrl?: string): Promise<Page> {
  const mainPage = await openFlowBrowser();
  const context = state.context;
  if (!context) throw new Error("Tarayici baglami acilamadi");

  const existing = state.projectPages.get(projectId);
  if (existing && pageIsOpen(existing)) {
    await closeUnclaimedFlowTabs(existing);
    await revealFlowWindow(existing);
    const targetUrl = flowProjectUrl?.trim().replace(/\/+$/, "") || "";
    if (targetUrl && !pageIsOnTarget(existing.url(), targetUrl)) {
      await existing.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    }
    return existing;
  }

  const targetUrl = flowProjectUrl?.trim() || "";

  const occupantId = [...state.projectPages.entries()].find(([, page]) => page === mainPage && pageIsOpen(page))?.[0];
  const otherOwnTabs = [...state.projectPages.entries()].some(
    ([id, page]) => id !== projectId && page !== mainPage && pageIsOpen(page)
  );
  // Serbest ana sekme varsa onu kullan (tek is icin fazladan sekme ACMA);
  // baska projenin elindeyse asagida bu projeye ayri sekme acilir.
  if (canTakeMainPage({ projectId, mainPageOccupantId: occupantId ?? null, hasOtherDedicatedTabs: otherOwnTabs })) {
    state.projectPages.set(projectId, mainPage);
    if (targetUrl && !pageIsOnTarget(mainPage.url(), targetUrl)) {
      await mainPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(async (err: Error) => {
        await recordEvent({
          projectId,
          step: "browser",
          level: "warning",
          message: `Proje adresi acilamadi (${targetUrl}): ${err.message}`,
        });
      });
    }
    await closeUnclaimedFlowTabs(mainPage);
    await revealFlowWindow(mainPage);
    return mainPage;
  }

  const settings = await getSettings();
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("close", () => {
    if (state.projectPages.get(projectId) === page) state.projectPages.delete(projectId);
  });

  await page.goto(targetUrl || settings.flowUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  state.projectPages.set(projectId, page);
  await recordEvent({
    projectId,
    step: "browser",
    message: `Bu proje icin ayri Flow sekmesi acildi (paralel uretim)${targetUrl ? "" : " — proje adresi bos, genel Flow adresi kullanildi"}`,
    pageUrl: page.url(),
  });
  await revealFlowWindow(page);
  return page;
}

/** Proje sekmesini kapatir (is bitince cagrilir; ana sekme kapatilmaz). */
export async function releaseProjectPage(projectId: string): Promise<void> {
  const page = state.projectPages.get(projectId);
  state.projectPages.delete(projectId);
  if (!page || page.isClosed()) return;
  // Ana sekme paylasilan kaynaktir: sadece haritadan dusuruluyor, kapatilmiyor.
  if (page === state.page) return;
  await page.close().catch(() => {});
}

/**
 * DURDUR = ANINDA DUR: projenin Flow sekmesini zorla kapatir.
 * Sekme kapaninca o an bekleyen TUM Playwright cagrilari aninda hata firlatir;
 * iptal bayragini dakikalarca bekleyen uretim dongusu boylece saniyeler icinde
 * duser. Ana sekme paylasildigi icin o da kapatilir — sonraki uretim yeniden acar.
 */
export async function forceCloseProjectPage(projectId: string): Promise<void> {
  const page = state.projectPages.get(projectId);
  state.projectPages.delete(projectId);
  if (!page || page.isClosed()) return;
  if (page === state.page) state.page = null;
  await page.close().catch(() => {});
  await recordEvent({
    projectId,
    step: "browser",
    level: "warning",
    message: "Durdurma istegi: projenin Flow sekmesi kapatildi (bekleyen islemler aninda kesilir)",
  });
}

/** Tarayiciyi kapatir. */
export async function closeFlowBrowser(): Promise<void> {
  if (state.context) {
    try {
      await state.context.close();
    } catch {
      // zaten kapanmis olabilir
    }
  }
  state.context = null;
  state.page = null;
  state.projectPages.clear();
  publishEvent(null, { type: "system", payload: { browser: "closed" } });
  await recordEvent({ step: "browser", message: "Tarayici kapatildi" });
}

export type SessionStatus = "closed" | "ready" | "needs_login" | "needs_verification";

/**
 * Kullanici "bu bir yanlis alarm" dediginde guvenlik kontrolu atlanir.
 * Yalnizca calisan surec icin gecerlidir (kalici degil) ve YALNIZCA tespiti
 * atlar; hicbir dogrulamayi asma girisimi yapilmaz.
 */
const globalForOverride = globalThis as unknown as { flowSessionCheckOverride?: boolean };

export function setSessionCheckOverride(ignore: boolean): void {
  globalForOverride.flowSessionCheckOverride = ignore;
}

export function isSessionCheckOverridden(): boolean {
  return globalForOverride.flowSessionCheckOverride === true;
}

/**
 * Oturum durumu:
 * - needs_login: Google giris ekrani gorunuyor
 * - needs_verification: CAPTCHA / 2FA / hesap dogrulama ekrani gorunuyor (ASILMAZ, kullanici cozer)
 * - ready: Flow arayuzu kullanilabilir
 *
 * Tespit dar tutulur: "guvenlik", "dogrula" gibi tek kelimeler normal arayuz
 * metinlerinde (alt bilgi baglantilari, menuler) gecebildigi icin yalnizca
 * dogrulama ekranlarina ozgu adresler, reCAPTCHA cerceveleri ve tam ifadeler
 * dikkate alinir.
 */
export async function checkSessionStatus(targetPage?: Page | null): Promise<{ status: SessionStatus; detail: string; url?: string }> {
  const page = targetPage && !targetPage.isClosed() ? targetPage : getPage();
  if (!page) return { status: "closed", detail: "Tarayici kapali" };
  try {
    const url = page.url();

    // 1) Hesap dogrulama / challenge adresleri
    if (/accounts\.google\.com\/.*(challenge|speedbump|deniedsigninrejected)/i.test(url)) {
      return {
        status: "needs_verification",
        detail: "Google hesap dogrulama ekrani acik. Dogrulamayi Chrome penceresinde elle tamamlayin.",
        url,
      };
    }
    if (/accounts\.google\.com|ServiceLogin|\/signin(\/|$|\?)/i.test(url)) {
      return { status: "needs_login", detail: "Google giris ekrani acik. Acilan Chrome penceresinde hesabiniza elle giris yapin.", url };
    }

    const captcha = page.locator("iframe[src*='recaptcha'], iframe[title*='recaptcha'], .g-recaptcha, #captcha-form").first();
    const strongPhrase = page
      .getByText(
        /verify it'?s you|unusual traffic|confirm you'?re not a robot|2-step verification|kimli[gğ]inizi do[gğ]rula|robot olmad[iı][gğ][iı]n[iı]z[iı]|[iİ]ki a[sş]amal[iı] do[gğ]rulama/i
      )
      .first();
    const signIn = page.getByRole("button", { name: /^\s*(sign in|oturum a[cç]|giri[sş] yap)\s*$/i }).first();
    const signInLink = page.getByRole("link", { name: /^\s*(sign in|oturum a[cç]|giri[sş] yap)\s*$/i }).first();
    const probe = { timeout: 180 } as const;
    const [hasCaptcha, hasPhrase, hasSignIn, hasSignInLink] = await Promise.all([
      captcha.isVisible(probe).catch(() => false),
      strongPhrase.isVisible(probe).catch(() => false),
      signIn.isVisible(probe).catch(() => false),
      signInLink.isVisible(probe).catch(() => false),
    ]);
    if (hasCaptcha) {
      return { status: "needs_verification", detail: "CAPTCHA tespit edildi. Dogrulamayi Chrome penceresinde elle tamamlayin.", url };
    }
    if (hasPhrase) {
      const matched = (await strongPhrase.textContent().catch(() => "")) ?? "";
      return {
        status: "needs_verification",
        detail: `Dogrulama ekrani tespit edildi ("${matched.trim().slice(0, 60)}"). Dogrulamayi Chrome penceresinde elle tamamlayin.`,
        url,
      };
    }
    if (hasSignIn || hasSignInLink) {
      return { status: "needs_login", detail: "Oturum acilmamis gorunuyor. Chrome penceresinde Google hesabiniza giris yapin.", url };
    }

    return { status: "ready", detail: "Flow oturumu hazir", url };
  } catch (err) {
    return { status: "closed", detail: `Sayfa durumu okunamadi: ${err instanceof Error ? err.message : String(err)}` };
  }
}

type SessionSnapshot = Awaited<ReturnType<typeof checkSessionStatus>>;
let sessionCache: { at: number; value: SessionSnapshot } | null = null;
let sessionProbe: Promise<SessionSnapshot> | null = null;
const SESSION_CACHE_MS = 15_000;
/** Otomasyon sayfayi mesgul ederken sidebar isteginin bekleyecegi ust sinir. */
const SESSION_PROBE_BUDGET_MS = 1_200;

/**
 * Sidebar / dashboard poll icin — her istekte Playwright bekletmez.
 *
 * Otomasyon ayni sekmede uretim yaparken `checkSessionStatus` saniyelerce
 * kuyrukta kaliyor ve TUM sayfa gecislerini yavaslatiyordu. Burada olcum
 * arka planda surer; istek en fazla kisa bir sure bekler, sonra elindeki
 * son bilinen degeri dondurur.
 */
export async function checkSessionStatusCached(): Promise<SessionSnapshot> {
  if (sessionCache && Date.now() - sessionCache.at < SESSION_CACHE_MS) {
    return sessionCache.value;
  }
  if (!sessionProbe) {
    sessionProbe = checkSessionStatus()
      .then((value) => {
        sessionCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        sessionProbe = null;
      });
  }
  const pending = sessionProbe;
  const stale = sessionCache?.value;
  // Ilk olcumde beklenecek onceki deger yok; sonrakilerde bayat deger yeter.
  if (!stale) return pending;
  return Promise.race([
    pending,
    new Promise<SessionSnapshot>((resolve) => setTimeout(() => resolve(stale), SESSION_PROBE_BUDGET_MS)),
  ]);
}

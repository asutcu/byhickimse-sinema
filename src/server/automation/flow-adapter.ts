import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { Locator, Page } from "playwright";
import type { Project } from "@prisma/client";
import {
  buildLocator,
  getCandidatesFor,
  locatorFor,
  resolveSelector,
  saveCandidates,
  type SelectorCandidate,
} from "@/server/automation/selectors";
import {
  acquireProjectPage,
  checkSessionStatus,
  closeUnclaimedFlowTabs,
  isSessionCheckOverridden,
  keepOnlyThisTab,
  openFlowBrowser,
  revealFlowWindow,
} from "@/server/automation/browser";
import { assertAutomationContinuing, interruptibleSleep } from "@/server/automation/abort";
import { getSettings } from "@/server/services/settings";
import { prisma } from "@/server/db";
import { recordEvent } from "@/server/lib/logger";
import { nextAvailablePath, safeProjectPath } from "@/server/lib/paths";
import { flowProjectIdFromUrl, sameFlowProject } from "@/lib/flow-project-url";
import {
  clampPromptForFlowBox,
  compactPromptForFlow,
  ensureNoOnscreenTextLock,
  FLOW_HARD_CHAR_LIMIT,
  FLOW_PROMPT_MAX,
} from "@/lib/flow-prompt-compact";
import {
  chipNeedsRepair,
  flowClipSeconds,
  flowDurationTabPattern,
  generationChipMismatchMessage,
  imageModelNamesMatch,
  isImageFlowModel,
  FLOW_IMAGE_MODEL,
  resolveFlowImageModel,
  FLOW_POLICY_BLOCK_TEXT,
  isCelebrityPolicyText,
  isStuckFlowResolvingText,
  parseFlowSettingsChip,
  shouldTreatVisibleFailureAsNew,
} from "@/lib/flow-generation-settings";
import { bufferLooksLikeCharacterSheet, bufferLooksLikeStorySlide, readImageDimensions } from "@/lib/still-sheet-detect";
import { readProjectFlowImageModel } from "@/server/lib/flow-image-model-store";

/**
 * Flow sayfa adaptoru: prompt yazma, uretim baslatma, tamamlanma bekleme, indirme.
 * Tum secic erisimi selectors.ts uzerinden yapilir; bot tespiti asma,
 * sahte insan davranisi veya guvenlik kontrolu atlatma YOKTUR.
 */

export class ManualActionNeededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualActionNeededError";
  }
}

/**
 * Oturum boyunca kutuphaneye yuklenen referans dosya adlari.
 * 20+ klipten sonra ayni sheet'i tekrar upload etmek kutuphaneyi sisirir;
 * isim eslesmesi bozulur ve ayni karakter cifte eklenir.
 */
const libraryKnownByProject = new Map<string, Set<string>>();

function markLibraryKnown(projectId: string, imagePath: string): void {
  const key = path.basename(imagePath).toLowerCase();
  const set = libraryKnownByProject.get(projectId) ?? new Set<string>();
  set.add(key);
  libraryKnownByProject.set(projectId, set);
}

function isLibraryKnown(projectId: string, imagePath: string): boolean {
  return libraryKnownByProject.get(projectId)?.has(path.basename(imagePath).toLowerCase()) ?? false;
}

export function uniqueExistingImagePaths(imagePaths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of imagePaths) {
    const trimmed = raw?.trim();
    if (!trimmed || !fs.existsSync(trimmed)) continue;
    const resolved = path.resolve(trimmed);
    const norm = resolved.toLowerCase();
    const base = path.basename(resolved).toLowerCase();
    if (seen.has(norm) || seen.has(`base:${base}`)) continue;
    seen.add(norm);
    seen.add(`base:${base}`);
    out.push(resolved);
  }
  return out;
}

const SELECTOR_LABELS: Record<string, string> = {
  promptInput: "Prompt kutusu",
  generateButton: "Generate (Uret) dugmesi",
  assetMenuButton: "Video kartinin menu dugmesi",
  downloadMenuItem: "Indir menu ogesi",
};

export class SelectorMissingError extends Error {
  constructor(key: string) {
    const label = SELECTOR_LABELS[key] ?? key;
    super(
      `"${label}" Flow sayfasinda bulunamadi. Kalibrasyon ekranindan bu ogeyi yeniden tanitin (Flow arayuzu degismis olabilir). Teknik anahtar: ${key}`
    );
    this.name = "SelectorMissingError";
  }
}

/** Aday locator'lar arasindan sayfada gorunur olan ilkini dondurur. */
async function firstUsable(candidates: Array<Locator | null>, timeoutMs = 1_500): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if ((await candidate.count()) === 0) continue;
      if (await candidate.isVisible({ timeout: timeoutMs })) return candidate;
    } catch {
      // bu aday kullanilamiyor, sonrakine gec
    }
  }
  return null;
}

/**
 * Prompt kutusunu arar (bulamazsa null doner, hata atmaz).
 * Once merkezi aday zinciri (kalibrasyon + yerlesik yedekler), sonra
 * ic cerceveler (iframe) taranir.
 */
/**
 * GORUNTU DUZENLEME kutusunun ipucu metni. Yuklenen/uretilen bir gorsel tam
 * ekran acildiginda Flow, VIDEO prompt kutusu yerine "Neyi degistirmek
 * istiyorsunuz?" yazan bir Nano Banana duzenleme kutusu gosterir. Bu kutu da
 * contenteditable oldugu icin genel adaylara yakalanir; prompt buraya
 * yazilirsa video yerine GORUNTU uretilir ve klip zaman asimina ugrar.
 */
const EDIT_BOX_HINT = /neyi de[gğ]i[sş]tirmek istiyorsun|what (do you want|would you like) to change/i;

/**
 * Medya secim penceresi. Eski arayuz role="dialog" idi; flow.google.com'daki
 * yeni arayuzde rol tasimayan bir katman (cdk-overlay-pane + oge listesi).
 */
const MEDIA_PICKER_SELECTOR = "[role='dialog'], [aria-modal='true'], .cdk-overlay-pane:has(.asset-list-viewport)";

function mediaPicker(page: Page): Locator {
  return page.locator(MEDIA_PICKER_SELECTOR).first();
}

/** Ayar panelindeki secenek: eski arayuzde role="tab", yenisinde role="radio". */
function settingsChoice(page: Page, name: RegExp): Locator {
  return page.getByRole("tab", { name }).or(page.getByRole("radio", { name })).first();
}

/** `.../project/<uuid>` kokunu URL'den cikarir (`/edit/...` ve query haric). */
function flowProjectRootFromUrl(url: string): string {
  return url.match(/^(https?:\/\/[^?#]+\/project\/[0-9a-f][0-9a-f-]{7,})/i)?.[1]?.replace(/\/+$/, "") || "";
}

function flowProjectComposerRoot(page: Page, project: Project): string {
  const saved = (project.flowProjectUrl || "").trim().replace(/\/+$/, "");
  if (saved) return saved;
  return flowProjectRootFromUrl(page.url());
}

/** /edit/, /characters gibi alt sayfalar — prompt cubugu yok veya yanlis kutu. */
function isFlowProjectSubpage(url: string, projectRoot: string): boolean {
  const bare = url.split(/[?#]/)[0].replace(/\/+$/, "");
  const match = bare.match(/\/project\/([0-9a-f][0-9a-f-]{7,})\/.+$/i);
  if (!match) return false;
  const rootId = flowProjectIdFromUrl(projectRoot);
  return !rootId || rootId === match[1].toLowerCase();
}

/**
 * Acik Chrome sekmesindeki Flow proje sayfasini bu Narratif projesine kilitler.
 * Kayitli adres YOKSA yazar; varsa baska sayfaya gecmez (tek sayfa kilidi).
 */
export async function bindFlowProjectToOpenPage(project: Project, page: { url: () => string }): Promise<void> {
  const root = flowProjectRootFromUrl(page.url());
  if (!root) return;
  const current = (project.flowProjectUrl || "").trim().replace(/\/+$/, "");
  if (current) {
    if (sameFlowProject(current, root) && project.reuseFlowProject) return;
    if (!sameFlowProject(current, root)) return;
  }
  await prisma.project.update({
    where: { id: project.id },
    data: { flowProjectUrl: root, reuseFlowProject: true },
  });
  project.flowProjectUrl = root;
  project.reuseFlowProject = true;
  await recordEvent({
    projectId: project.id,
    step: "flow",
    message: `Flow proje adresi kaydedildi (tek sayfa, yeni sayfa acilmayacak): ${root}`,
  });
}

/**
 * Adayin GERCEK video prompt kutusu olup olmadigini dogrular.
 * Flow sayfasinda birden fazla contenteditable bulunur (medya penceresi arama
 * alani, gizli z-index:-1 kutular, goruntu duzenleme). Yanlisina yazmak
 * "prompt yazilmadi / Generate basilmadi" hatasina yol acar.
 */
async function isVideoPromptBox(candidate: Locator): Promise<boolean> {
  try {
    // Gorunur olmali. Bos Flow promptu ~20px yukseklik + genis cubuk;
    // eski esik (24px) gercek kutuyu eleyip "editor acik degil" hatasi uretiyordu.
    if (!(await candidate.isVisible({ timeout: 400 }).catch(() => false))) return false;
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || box.width < 120 || box.height < 14) return false;

    const meta = await candidate
      .evaluate((el) => {
        const style = window.getComputedStyle(el);
        const z = style.zIndex;
        const zNum = Number(z);
        return {
          zIndex: z,
          zIsNegative: Number.isFinite(zNum) && zNum < 0,
          pointerEvents: style.pointerEvents,
          ariaHidden: el.getAttribute("aria-hidden"),
          text: (el.textContent || "").replace(/\uFEFF/g, "").trim().slice(0, 120),
          placeholder: el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || "",
          inDialog: !!el.closest("[role='dialog'], [aria-modal='true']"),
        };
      })
      .catch(() => null);
    if (!meta) return false;
    if (meta.inDialog) return false;
    if (meta.ariaHidden === "true") return false;
    if (meta.pointerEvents === "none") return false;
    // Yalnizca HESAPLANAN negatif z-index elenir. Flow gercek prompta
    // HTML zindex="-1" ozelligi koyuyor ama computed "auto" — onu ELEME.
    if (meta.zIsNegative) return false;
    if (EDIT_BOX_HINT.test(meta.text) || EDIT_BOX_HINT.test(meta.placeholder)) return false;
    const pageUrl = candidate.page().url();
    if (/\/edit\//i.test(pageUrl)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Generate dugmesini iceren alt kompozisyon cubugu (prompt + gonder). */
function composerRoot(page: Page): Locator {
  return page
    .locator("div, form, section, footer")
    .filter({ has: page.locator("button").filter({ hasText: /arrow_forward/i }) })
    .filter({ has: page.locator("[contenteditable='true'], textarea") })
    .last();
}

/**
 * Kompozisyon cubugu ICINDEKI "arrow_forward" dugmesi (gercek Generate).
 * "arrow_forward" ikon metni sayfanin BASKA yerinde de gecebilir (or.
 * kutuphane/galeri onizlemesindeki "sonraki gorsel" oku); composerRoot ile
 * scope edilmezse sayfadaki ilk eslesme yanlislikla secilip prompt yazilir
 * ama Generate'e degil secili/var olan bir gorsele tiklanir — otomasyon o
 * gorseli acip orada takili kalir. composerRoot zaten "hem arrow_forward
 * dugmesi HEM prompt kutusu" barindiran konteyneri bulur; o konteynerin
 * ICINDEKI dugme sayfanin geri kalanindan izole, guvenilir bir hedeftir.
 */
function composerGenerateButton(page: Page): Locator {
  return composerRoot(page).locator("button").filter({ hasText: /arrow_forward/i }).last();
}

/**
 * Video prompt kutusunu bulur. Oncelik:
 *  1) Generate (arrow_forward) dugmesinin yakinindaki contenteditable
 *  2) "Ne olusturmak istiyorsunuz?" ipucu tasiyan kutu
 *  3) Kalibre edilmis / genel adaylar (yalnizca isVideoPromptBox gecenler)
 */
async function findPromptInput(page: Page, _projectId?: string): Promise<Locator | null> {
  // 1) En guvenilir: gonderme dugmesinin bulundugu kompozisyon cubugu
  const nearGenerate = composerRoot(page).locator("[contenteditable='true'], textarea").first();
  if (await isVideoPromptBox(nearGenerate)) return nearGenerate;

  // 2) Video promptunun yer tutucu metni (bos kutuda icerik olarak gelir)
  const byPlaceholder = page
    .locator("[contenteditable='true'], textarea")
    .filter({ hasText: /ne olu[sş]turmak istiyorsun|what do you want to create|generate a video/i })
    .first();
  if (await isVideoPromptBox(byPlaceholder)) return byPlaceholder;

  // 3) Kalibre edilmis secici — ama yalnizca gercekten kullanilabilirse
  //    (eski kalibrasyon z-index:-1 gizli kutuya takilabiliyordu)
  const resolved = await resolveSelector(page, "promptInput", { selfHeal: false, timeoutMs: 600 });
  if (resolved && (await isVideoPromptBox(resolved.locator))) return resolved.locator;

  // 4) Sayfadaki TUM contenteditable/textarea adaylarini tara; ilk uygun olan
  const all = page.locator("[contenteditable='true'], textarea");
  const count = await all.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 16); i++) {
    const candidate = all.nth(i);
    if (await isVideoPromptBox(candidate)) return candidate;
  }

  // 5) iframe yedegi
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    for (const pattern of ["textarea", "[contenteditable='true']"]) {
      const candidate = await firstUsable([frame.locator(pattern).first()], 600);
      if (candidate && (await isVideoPromptBox(candidate))) return candidate;
    }
  }

  // Flow yeni UI bazen kompozisyon cubugunu aria-modal icine aliyor;
  // isVideoPromptBox o zaman inDialog diye eleyip "editor acik degil" diyor.
  if (!/\/edit\//i.test(page.url())) {
    const composerBox = composerRoot(page).locator("[contenteditable='true'], textarea").first();
    if (await composerBox.isVisible({ timeout: 400 }).catch(() => false)) {
      const box = await composerBox.boundingBox().catch(() => null);
      const text = ((await composerBox.innerText().catch(() => "")) || "").replace(/\uFEFF/g, "").trim();
      if (box && box.width >= 120 && box.height >= 14 && !EDIT_BOX_HINT.test(text)) return composerBox;
    }
  }
  return null;
}

/** Ayarlar paneli / menu / dialog aciksa Escape ile kapat (prompt yazmayi engeller). */
async function dismissOverlaysBlockingPrompt(page: Page, project: Project, context: string): Promise<void> {
  const settingsOpen = await settingsChoice(page, /^x[1-4]$/i)
    .isVisible({ timeout: 300 })
    .catch(() => false);
  const dialogOpen = await mediaPicker(page)
    .isVisible({ timeout: 300 })
    .catch(() => false);
  const menuOpen = await page
    .locator("[role='menu']")
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);

  if (!settingsOpen && !dialogOpen && !menuOpen) return;

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
  // Hala ayarlar aciksa ozet dugmeye tekrar tiklayarak kapatmayi dene
  if (
    await settingsChoice(page, /^x[1-4]$/i)
      .isVisible({ timeout: 300 })
      .catch(() => false)
  ) {
    const toggle = await locatorFor(page, "generationSettingsButton", { timeoutMs: 800 });
    if (toggle) await toggle.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Prompt yazmadan once acik panel/pencere kapatildi (${context})`,
  });
}

/**
 * Flow'un PROJE EDITORU ekraninda oldugundan emin olur.
 * Ana sayfa/proje listesi ekraninda prompt kutusu bulunmaz; bu durumda
 * projeye girmeyi dener, basaramazsa elle mudahale ister (bosuna yeniden
 * denemelerle vakit harcamaz).
 */
export async function ensureEditorReady(page: Page, project: Project): Promise<Locator> {
  await closeStrayDialog(page, project, "editor acilis").catch(() => {});
  await dismissOverlaysBlockingPrompt(page, project, "editor acilis").catch(() => {});

  const composerRootUrl = flowProjectComposerRoot(page, project);
  if (composerRootUrl && isFlowProjectSubpage(page.url(), composerRootUrl)) {
    await page.goto(composerRootUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Flow editorune donuldu (alt sayfa kapatildi: ${page.url().slice(0, 120)})`,
    });
  }

  // Yuklenen/uretilen gorselin actigi tam ekran duzenleme gorunumu varsa kapat
  await escapeAssetDetailView(page, project);

  const waitForPrompt = async (ms: number): Promise<Locator | null> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (composerRootUrl && isFlowProjectSubpage(page.url(), composerRootUrl)) {
        await page.goto(composerRootUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
      } else {
        await escapeAssetDetailView(page, project, { mode: "soft" });
      }
      const found = await findPromptInput(page, project.id);
      if (found) return found;
      await page.waitForTimeout(1_500);
    }
    return null;
  };

  let existing = await findPromptInput(page, project.id);
  if (existing) return existing;

  // Flow agir bir SPA: sayfa "yuklendi" gorunse de govde birkac saniye sonra
  // gelir. Pes etmeden once sabirla bekle (ozellikle tarayici yeni acildiginda).
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  existing = await waitForPrompt(25_000);
    if (existing) return existing;

  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Prompt kutusu yok — Flow editoru acik degil gibi gorunuyor. Projeye girilmeye calisiliyor. Adres: ${page.url()}`,
  });

  const attempts: Array<{ label: string; run: () => Promise<boolean> }> = [];

  // En guvenilir kurtarma: projeye ozel adrese dogrudan git (yenile).
  // "Yeni proje" burada basilmaz; o tek sefer openFlowProject icinde olur.
  if (composerRootUrl) {
    attempts.push({
      label: `proje adresine gidildi (${composerRootUrl})`,
      run: async () => {
        await page.goto(composerRootUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        return true;
      },
    });
  } else if (project.flowProjectUrl?.trim()) {
    const projectUrl = project.flowProjectUrl.trim();
    attempts.push({
      label: `proje adresine gidildi (${projectUrl})`,
      run: async () => {
        await page.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        return true;
      },
    });
  }

  if (project.flowProjectName.trim() && !composerRootUrl) {
    attempts.push({
      label: `"${project.flowProjectName}" projesine tiklandi`,
      run: async () => {
        const card = page.getByText(project.flowProjectName, { exact: false }).first();
        if (!(await card.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
        await card.click();
        return true;
      },
    });
  }

  for (const attempt of attempts) {
    let clicked = false;
    try {
      clicked = await attempt.run();
    } catch {
      clicked = false;
    }
    if (!clicked) continue;

    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const input = await waitForPrompt(20_000);
    if (input) {
      await recordEvent({ projectId: project.id, step: "flow", message: `Flow editoru acildi (${attempt.label})` });
      return input;
    }
  }

  const snapshot = await captureDebugSnapshot(page, project.slug, "editor-not-open");
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "error",
    message: "Flow editoru acilamadi; elle mudahale gerekiyor",
    screenshotPath: snapshot.screenshotPath,
    pageUrl: page.url(),
  });
  throw new ManualActionNeededError(
    `Flow editoru acik degil (su anki adres: ${page.url()}). Chrome penceresinde projenizi acin — prompt kutusunun gorundugu ekranda kalin — sonra "Devam Ettir"e basin. Kalici cozum: Proje Ayarlari > "Flow proje linki" alanina bu projenin Flow adresini yazin (or. https://flow.google.com/project/XXXX); paralel calisma da bu linke dayanir.`
  );
}

/** Generate dugmesini bulur; kalibre edilmemisse yaygin adlarla arar. */
async function resolveGenerateButton(page: Page): Promise<Locator | null> {
  // Once composer'a scope edilmis hedef (bkz. composerGenerateButton) —
  // yapisal olarak dogru konteynerden geldigi icin unscoped aramadan cok
  // daha guvenilir. Bulunamazsa (Flow'un composer duzeni degismis olabilir)
  // kalibrasyon + yerlesik yedek zincirine dus.
  const scoped = composerGenerateButton(page);
  if (await scoped.isVisible({ timeout: 500 }).catch(() => false)) return scoped;
  return locatorFor(page, "generateButton");
}

/** Indirme menu ogesini bulur. */
async function resolveDownloadMenuItem(page: Page): Promise<Locator | null> {
  return locatorFor(page, "downloadMenuItem");
}

/** Uretilen varligin menu dugmesini bulur. */
async function resolveAssetMenuButton(page: Page): Promise<Locator | null> {
  return locatorFor(page, "assetMenuButton");
}

/** Hata ayiklama: ekran goruntusu + HTML anlik goruntusu kaydeder. */
export async function captureDebugSnapshot(page: Page, projectSlug: string, label: string): Promise<{ screenshotPath: string; htmlPath: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = nextAvailablePath(safeProjectPath(projectSlug, "screenshots", `${stamp}-${label}.png`));
  const htmlPath = nextAvailablePath(safeProjectPath(projectSlug, "screenshots", `${stamp}-${label}.html`));
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 15_000 });
  } catch {
    // ekran goruntusu alinamasa da devam et
  }
  try {
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, "utf8");
  } catch {
    // html alinamasa da devam et
  }
  return { screenshotPath, htmlPath };
}

/**
 * Flow'un acik ve oturumun hazir oldugunu garanti eder.
 *
 * projectId verilirse o projeye AYRILMIS sekme dondurulur (paralel calisma).
 * Verilmezse paylasilan ana sekme kullanilir — kalibrasyon, tekil karakter
 * uretimi gibi tek seferlik akislar icin.
 */
export async function ensureFlowReady(
  projectId?: string,
  flowProjectUrl?: string,
  options?: { singleTab?: boolean }
): Promise<Page> {
  const page = projectId ? await acquireProjectPage(projectId, flowProjectUrl) : await openFlowBrowser();
  if (options?.singleTab) {
    await keepOnlyThisTab(page);
  } else {
    const closed = await closeUnclaimedFlowTabs(page);
    if (closed > 0) {
      await recordEvent({
        projectId,
        step: "browser",
        message: `${closed} fazla Flow sekmesi kapatildi`,
      });
    }
  }
  await revealFlowWindow(page);
  const session = await checkSessionStatus(page);
  if (session.status === "needs_login") {
    throw new ManualActionNeededError("Google oturumu acik degil. Chrome penceresinde hesabiniza elle giris yapin, sonra devam edin.");
  }
  if (session.status === "needs_verification") {
    if (isSessionCheckOverridden()) {
      await recordEvent({
        projectId,
        step: "flow",
        level: "warning",
        message: `Dogrulama tespiti kullanici istegiyle atlandi (${session.detail.slice(0, 80)})`,
      });
    } else {
      throw new ManualActionNeededError(
        `${session.detail} Ekranda boyle bir dogrulama YOKSA bu bir yanlis alarmdir: panelde "Kontrolu atla" dugmesiyle devam edebilirsiniz.`
      );
    }
  }
  if (session.status === "closed") {
    throw new Error("Tarayici beklenmedik sekilde kapandi");
  }
  return page;
}

/**
 * Dogru Flow projesini acar — TEK kayitli sayfa.
 * Kayitli link varsa her zaman oraya doner; baska Flow projesinde kalsa bile
 * "Yeni proje"ye basmaz ve rastgele acik sayfaya kilitlenmez.
 */
export async function openFlowProject(page: Page, project: Project): Promise<void> {
  const saved = (project.flowProjectUrl || "").trim().replace(/\/+$/, "");
  if (saved) {
    const openRoot = flowProjectRootFromUrl(page.url());
    if (!sameFlowProject(openRoot, saved) || isFlowProjectSubpage(page.url(), saved)) {
      await page.goto(saved, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1_500);
      await recordEvent({ projectId: project.id, step: "flow", message: `Flow projesi adresinden acildi: ${saved}` });
    }
    return;
  }

  const openRoot = flowProjectRootFromUrl(page.url());
  if (openRoot) {
    // Zaman Yolcusu ile diger moduller ayni Flow projesine baglanmaz (kutuphane karisir).
    const owner = await prisma.project.findFirst({
      where: { id: { not: project.id }, flowProjectUrl: { contains: flowProjectIdFromUrl(openRoot) } },
      select: { templateType: true },
    });
    const crossModule = Boolean(owner) && (owner!.templateType === "time_travel") !== (project.templateType === "time_travel");
    if (!crossModule) {
      await bindFlowProjectToOpenPage(project, page);
      if (isFlowProjectSubpage(page.url(), openRoot)) {
        await page.goto(openRoot, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
      }
      return;
    }
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Acik Flow projesi baska bir module ait — bu proje icin ayri bir Flow projesi aciliyor",
    });
    const settings = await getSettings();
    await page.goto(settings.flowUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
  }

  if (project.reuseFlowProject && project.flowProjectName.trim()) {
  const projectItem = page.getByText(project.flowProjectName, { exact: false }).first();
  if (await projectItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await projectItem.click();
    await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1_500);
      await bindFlowProjectToOpenPage(project, page);
    await recordEvent({ projectId: project.id, step: "flow", message: `Flow projesi acildi: ${project.flowProjectName}` });
    return;
    }
  }

  // Ilk ve tek "Yeni proje": kayitli adres yok ve editor acik degil.
  const newProjectButton = await locatorFor(page, "newProjectButton");
  if (newProjectButton && (await newProjectButton.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await newProjectButton.click();
    await page.waitForLoadState("domcontentloaded");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !flowProjectRootFromUrl(page.url())) {
      await page.waitForTimeout(500);
    }
    await bindFlowProjectToOpenPage(project, page);
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: flowProjectRootFromUrl(page.url())
        ? `Yeni Flow projesi acildi; uretim bu sayfada kalacak: ${flowProjectRootFromUrl(page.url())}`
        : "Yeni Flow projesi dugmesine basildi; proje adresi henuz yakalanamadi",
    });
    return;
  }

  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: "Flow projesi listede bulunamadi; mevcut acik sayfa kullanilacak",
  });
}

/** Menu tabanli secim: menuyu ac, metinle secenegi tikla. Secici yoksa atlanir (uyari). */
async function configureMenuOption(page: Page, project: Project, menuKey: string, optionText: string, label: string): Promise<void> {
  const menu = await locatorFor(page, menuKey);
  if (!menu) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `${label} menusu kalibre edilmemis; Flow'daki mevcut secim kullanilacak`,
    });
    return;
  }
  if (!(await menu.isVisible({ timeout: 3_000 }).catch(() => false))) {
    await recordEvent({ projectId: project.id, step: "flow", level: "warning", message: `${label} menusu gorunmuyor; atlandi` });
    return;
  }
  await menu.click();
  await page.waitForTimeout(400);
  const option = page.getByText(new RegExp(optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first();
  if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await option.click();
    await recordEvent({ projectId: project.id, step: "flow", message: `${label} secildi: ${optionText}` });
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `${label} icin "${optionText}" secenegi bulunamadi; mevcut secim korundu`,
    });
  }
  await page.waitForTimeout(300);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Model adlarini gevsek karsilastirir. Flow arayuzu model adini "Veo 3.1 -
 * Fast" gibi TIRE ile yazarken proje ayarinda "Veo 3.1 Fast" (tiresiz)
 * tutulur; ayrica menu satirlarinin onunde ikon ligature metni ("volume_up")
 * dogrudan metne yapisik gelir ("volume_upVeo 3.1 - Fast"). Bu fonksiyon
 * bu farkliliklari yok sayarak karsilastirma yapar.
 */
function normalizeModelName(value: string): string {
  return value
    .replace(/volume_up|arrow_drop_down|arrow_drop_up/gi, " ")
    .toLowerCase()
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function modelNamesMatch(uiText: string, target: string): boolean {
  const a = normalizeModelName(uiText);
  const b = normalizeModelName(target);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Model/en-boy orani/cikti sayisi kontrolleri, prompt cubugunun yanindaki
 * ozet dugmeye ("Video · 16:9 · x1" gibi) tiklanip acilan bir panelde
 * gorunur; panel kapaliyken sayfada hic yoktur. Panel zaten aciksa
 * (x1..x4 sekmelerinden biri gorunuyorsa) dokunulmaz.
 */
async function openGenerationSettingsPanel(page: Page, project: Project): Promise<boolean> {
  const alreadyOpen = await settingsChoice(page, /^x[1-4]$/i)
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (alreadyOpen) return true;

  const toggle = await locatorFor(page, "generationSettingsButton", { timeoutMs: 2_000 });
  if (!toggle) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Uretim ayarlari paneli (model/oran/adet) bulunamadi; Flow'daki mevcut ayarlar kullanilacak",
    });
    return false;
  }
  // flow.google.com: Escape ile kapatilan panel ilk tiklamayi yutuyor; ikinci tik acar.
  let nowOpen = false;
  for (let attempt = 0; attempt < 3 && !nowOpen; attempt++) {
    await toggle.click().catch(() => {});
    await page.waitForTimeout(500);
    nowOpen = await settingsChoice(page, /^x[1-4]$/i)
      .isVisible({ timeout: 1_200 })
      .catch(() => false);
  }
  if (!nowOpen) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Uretim ayarlari paneli acilamadi; Flow'daki mevcut ayarlar kullanilacak",
    });
  }
  return nowOpen;
}

/** Model secimi: panel icindeki model dugmesini acar, listeden esleseni tiklar. */
async function selectModelInPanel(page: Page, project: Project): Promise<void> {
  const trigger = await locatorFor(page, "modelMenu", { timeoutMs: 2_000 });
  if (!trigger) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Model menusu bulunamadi; Flow'daki mevcut model kullanilacak",
    });
    return;
  }

  const currentText = (await trigger.textContent().catch(() => "")) ?? "";
  if (modelNamesMatch(currentText, project.flowModel)) {
    return; // zaten dogru model secili
  }

  await trigger.click().catch(() => {});
  await page.waitForTimeout(400);

  const items = page.getByRole("menuitem");
  const count = await items.count().catch(() => 0);
  let matched: Locator | null = null;
  const wantImage = isImageFlowModel(project.flowModel);
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const text = (await item.textContent().catch(() => "")) ?? "";
    if (!wantImage && isImageFlowModel(text)) continue;
    if (modelNamesMatch(text, project.flowModel)) {
      matched = item;
      break;
    }
  }

  if (matched) {
    await matched.click().catch(() => {});
    await recordEvent({ projectId: project.id, step: "flow", message: `Model secildi: ${project.flowModel}` });
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Model listesinde "${project.flowModel}" bulunamadi; mevcut secim korundu`,
    });
  }
  await page.waitForTimeout(300);
}

/**
 * Sekme tabanli tek tikla secim (en-boy orani / cikti sayisi). Bu kontroller
 * role="tab" ile isaretli oldugu icin metin aramasi ikon ligature'lariyla
 * (or. "crop_16_9") karismaz; kalibrasyon gerektirmez.
 */
async function selectSettingsTab(page: Page, project: Project, optionText: string, label: string): Promise<void> {
  const tab = settingsChoice(page, new RegExp(escapeRegExp(optionText), "i"));
  if (await tab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await tab.click().catch(() => {});
    await recordEvent({ projectId: project.id, step: "flow", message: `${label} secildi: ${optionText}` });
  } else {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `${label} icin "${optionText}" sekmesi bulunamadi; mevcut secim korundu`,
    });
  }
  await page.waitForTimeout(200);
}

function wantedClipSeconds(project: Project): number {
  return flowClipSeconds(project.flowModel, project.clipSeconds);
}

/**
 * Sure, en-boy gibi role="tab" (4s / 6s / 8s / 10s). Kalibrasyon gerekmez.
 * Veo Fast/Lite 10s destemez; 8s'ye cekilir. 9:16 short'ta Flow sikca 10s
 * birakir — o yuzden oran secildikten SONRA cagrilmali.
 */
async function selectDurationTab(page: Page, project: Project): Promise<boolean> {
  const seconds = wantedClipSeconds(project);
  const nameRe = flowDurationTabPattern(seconds);
  const candidates = [
    page.getByRole("tab", { name: nameRe }).first(),
    page.getByRole("radio", { name: nameRe }).first(),
    page.getByRole("button", { name: nameRe }).first(),
  ];

  for (const loc of candidates) {
    if (!(await loc.isVisible({ timeout: 1_200 }).catch(() => false))) continue;
    const selected =
      (await loc.getAttribute("aria-selected").catch(() => null)) === "true" ||
      (await loc.getAttribute("aria-checked").catch(() => null)) === "true";
    if (!selected) await loc.click().catch(() => {});
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: selected ? `Sure zaten ${seconds}s` : `Sure secildi: ${seconds}s`,
    });
    await page.waitForTimeout(200);
    return true;
  }

  // Bazi modellerde (or. Veo 3.1 Fast) sure secenegi yok, sure sabit; ozet cip dogruysa yeterli.
  const chipSeconds = parseFlowSettingsChip(await readOutputModeLabel(page)).durationSec;
  if (chipSeconds === seconds) {
    await recordEvent({ projectId: project.id, step: "flow", message: `Sure sabit ${seconds}s (modelde sure secenegi yok)` });
    return true;
  }

  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Sure sekmesi (${seconds}s) bulunamadi; Flow'daki mevcut sure kullanilacak`,
  });
  return false;
}

async function applyAspectOutputsAndDuration(page: Page, project: Project): Promise<void> {
  await selectSettingsTab(page, project, project.aspectRatio, "En-boy orani");
  await selectSettingsTab(page, project, `x${project.outputsPerGeneration}`, "Cikti sayisi");
  const tabOk = await selectDurationTab(page, project);
  if (!tabOk) {
    const seconds = wantedClipSeconds(project);
    await configureMenuOption(page, project, "durationMenu", `${seconds}s`, "Sure");
  }
}

/** Ozet cubugu (10s + 9:16 gibi) proje ayariyla uyusmuyorsa paneli acip duzeltir. */
async function repairGenerationChipIfNeeded(page: Page, project: Project): Promise<void> {
  const label = await readOutputModeLabel(page);
  const chip = parseFlowSettingsChip(label);
  const wantSec = wantedClipSeconds(project);
  const repair = chipNeedsRepair(chip, {
    durationSec: wantSec,
    aspect: project.aspectRatio,
    outputs: project.outputsPerGeneration,
  });
  if (!repair.duration && !repair.aspect && !repair.outputs) return;

  const panelOpen = await openGenerationSettingsPanel(page, project);
  if (!panelOpen) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Uretim ozeti uyumsuz (${label.slice(0, 40) || "?"}; hedef ${project.aspectRatio} ${wantSec}s) ama panel acilamadi`,
    });
    return;
  }
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Uretim ozeti duzeltiliyor: "${label.slice(0, 48)}" → ${project.aspectRatio} ${wantSec}s`,
  });
  await applyAspectOutputsAndDuration(page, project);
  await dismissOverlaysBlockingPrompt(page, project, "sure/oran duzeltmesi sonrasi");
}

/** Generate oncesi: 10s short ozeti varsa tiklama. Promptu silmemek icin panel acilmaz. */
async function assertGenerationChipReady(page: Page, project: Project): Promise<void> {
  const label = await readOutputModeLabel(page);
  const chip = parseFlowSettingsChip(label);
  const wantSec = wantedClipSeconds(project);
  const repair = chipNeedsRepair(chip, {
    durationSec: wantSec,
    aspect: project.aspectRatio,
    outputs: project.outputsPerGeneration,
  });
  if (repair.duration || repair.aspect) {
    throw new Error(generationChipMismatchMessage(label, project.aspectRatio, wantSec));
  }
}

/**
 * Prompt cubugundaki GERCEK cikti turu etiketini okur.
 * Ayarlar ozeti ("Videocrop_16_9x1") YANILTICI — o her zaman "Video" diyebilir;
 * once "Metinden/Malzemelerden …" dugmesi aranir.
 */
async function readOutputModeLabel(page: Page): Promise<string> {
  const typeBtn = page
    .getByRole("button", {
      name: /(metinden (videoya|g[oö]r[uü]nt[uü]ye)|text to (video|image)|malzemelerden|ingredients to|frames to video|g[oö]r[uü]nt[uü]den video|nano\s*banana)/i,
    })
    .first();
  if (await typeBtn.isVisible({ timeout: 700 }).catch(() => false)) {
    return ((await typeBtn.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  }

  const byText = page
    .locator("button")
    .filter({
      hasText:
        /metinden (videoya|g[oö]r[uü]nt[uü]ye)|text to (video|image)|malzemelerden (video|g[oö]r[uü]nt[uü])|ingredients to (video|image)|frames to video|nano\s*banana|\bveo\b.*crop_/i,
    })
    .first();
  if (await byText.isVisible({ timeout: 500 }).catch(() => false)) {
    return ((await byText.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  }

  // Son care: ayarlar ozeti — yalnizca "Görüntü/Image" ise gorsel sinyali verir
  const settingsChip = page.locator("button[aria-haspopup='menu']").filter({ hasText: /crop_(16_9|9_16)/ }).first();
  if (await settingsChip.isVisible({ timeout: 400 }).catch(() => false)) {
    return ((await settingsChip.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  }
  // flow.google.com: ozet cipi "<model> crop_16_9 x2" (aria-haspopup yok)
  const newChip = page.locator("button").filter({ hasText: /crop_\w+\s*x[1-4]\s*$/ }).first();
  if (await newChip.isVisible({ timeout: 400 }).catch(() => false)) {
    return ((await newChip.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  }
  return "";
}

function isImageOutputModeLabel(label: string): boolean {
  if (!label) return false;
  // Ayarlar ozeti "Videocrop…" — video; "Görüntühcrop…" — gorsel
  if (/^video\s*crop_/i.test(label) || /^videocrop_/i.test(label)) return false;
  if (/video/i.test(label) && !/g[oö]r[uü]nt[uü]|image|nano|banana/i.test(label)) return false;
  return /g[oö]r[uü]nt[uü]|image|nano\s*banana|text to image|metinden g[oö]r[uü]nt[uü]/i.test(label);
}

function isVideoOutputModeLabel(label: string): boolean {
  if (!label) return false;
  if (isImageOutputModeLabel(label)) return false;
  // Ayarlar ozeti "Videocrop_16_9x1" video sayilir ama zayif sinyal —
  // ensureVideoOutputMode yine de menuden dogrulamayi dener
  return /video|veo|malzemelerden|ingredients|frames to/i.test(label);
}

/**
 * Ciktinin VIDEO olacagini garanti eder.
 *
 * Referans gorsel eklendikten sonra Flow bazen GORUNTU / Nano Banana moduna
 * kayiyor; Generate o zaman jpeg uretir (mp4 yok). Prompt yazmadan VE Generate
 * basmadan hemen once cagrilmali.
 */
export async function ensureVideoOutputMode(
  page: Page,
  project: Project,
  opts?: { repairSettings?: boolean }
): Promise<void> {
  let label = await readOutputModeLabel(page);
  // Ayarlar ozeti "Videocrop…" / "Video · 10scrop_9_16x1" tek basina YETERLI
  // DEGIL — referans sonrasi asil mod "Metinden görüntüye" olabilir.
  // Prompt YAZILDIKTAN sonra paneli acmak istemi silebilir; o yuzden
  // repairSettings yoksa cubuk ozetine guvenilir.
  const chip = parseFlowSettingsChip(label);
  const weakOnlySettingsChip = chip.looksLikeSettingsChip;
  if (isVideoOutputModeLabel(label) && (!weakOnlySettingsChip || !opts?.repairSettings)) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Cikti turu video (${label.slice(0, 48) || "ok"})`,
    });
    if (opts?.repairSettings) await repairGenerationChipIfNeeded(page, project);
    return;
  }

  // 1) Cikti turu menusunden video / malzemelerden video sec
  const labelBefore = label;
  const switched = await switchOutputType(page, project, "video");
  if (switched) {
    label = await readOutputModeLabel(page);
    if (isVideoOutputModeLabel(label) && !isImageOutputModeLabel(label)) {
      // switchOutputType "zaten video" icin de true doner; o durumda yaniltici uyari yazilmaz.
      if (!isVideoOutputModeLabel(labelBefore)) {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "warning",
          message: `Cikti turu menuden VIDEO yapildi → ${label.slice(0, 48) || "ok"}`,
        });
      }
      if (opts?.repairSettings) await repairGenerationChipIfNeeded(page, project);
      return;
    }
  }

  // 2) Ayarlar panelindeki Video sekmesi
  if (!(await openGenerationSettingsPanel(page, project))) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Cikti turu dogrulanamadi (etiket: "${label.slice(0, 40)}"); video yerine gorsel uretilebilir`,
    });
    return;
  }

  const videoTab = settingsChoice(page, /^\s*(videocam\s*)?video\s*$/i);
  if (!(await videoTab.isVisible({ timeout: 1_500 }).catch(() => false))) {
    await dismissOverlaysBlockingPrompt(page, project, "video modu (sekme yok)");
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Cikti turu dogrulanamadi (mevcut: "${label.slice(0, 40)}"); video yerine gorsel uretilebilir`,
    });
    return;
  }

  if ((await videoTab.getAttribute("aria-checked").catch(() => null)) !== "true") {
    await videoTab.click().catch(() => {});
    await page.waitForTimeout(600);
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Cikti turu GORUNTU modundaydi; VIDEO sekmesine alindi",
    });
  }
  await selectVideoChoicesInPanel(page, project);
  // Goruntu modundan gecildiyse model listesi yeni acildi: projenin video modelini sec.
  await selectModelInPanel(page, project);
  if (opts?.repairSettings) {
    await applyAspectOutputsAndDuration(page, project);
  }
  await dismissOverlaysBlockingPrompt(page, project, "video modu sonrasi");

  label = await readOutputModeLabel(page);
  if (isImageOutputModeLabel(label)) {
    throw new Error(
      `Flow hâlâ GÖRÜNTÜ modunda ("${label.slice(0, 60)}"). Generate video yerine jpeg üretir. Prompt çubuğundaki çıktı türünü elle "Malzemelerden video" / "Metinden videoya" yapıp Devam Ettir'e basın.`
    );
  }
}

/**
 * flow.google.com ayar paneli: model listesi secili ciktiya gore degisir, o yuzden
 * model secmeden ONCE Video secilmeli. Zaman Yolcusu her klipte referans kullanir:
 * "Icerik ogeleri" sart ("Kareler" referansi ilk/son kare yapar).
 */
async function selectVideoChoicesInPanel(page: Page, project: Project): Promise<void> {
  const choices: Array<[RegExp, string]> = [[/^\s*(videocam\s*)?video\s*$/i, "Video"]];
  if (project.templateType === "time_travel") {
    choices.push([/chrome_extension|[İi]çerik öğeleri|ingredients/i, "İçerik öğeleri"]);
  }
  for (const [name, label] of choices) {
    const choice = settingsChoice(page, name);
    if (!(await choice.isVisible({ timeout: 800 }).catch(() => false))) continue;
    const state =
      (await choice.getAttribute("aria-checked").catch(() => null)) ??
      (await choice.getAttribute("aria-selected").catch(() => null));
    if (state === "true") continue;
    await choice.click().catch(() => {});
    await page.waitForTimeout(500);
    await recordEvent({ projectId: project.id, step: "flow", message: `Ayar paneli: ${label} secildi` });
  }
}

/** Model / sure / oran / cikti sayisi / ses yapilandirmasi. */
export async function configureGeneration(page: Page, project: Project): Promise<void> {
  const panelOpen = await openGenerationSettingsPanel(page, project);
  if (panelOpen) {
    await selectVideoChoicesInPanel(page, project);
    await selectModelInPanel(page, project);
    // Sure, orandan SONRA: 9:16'ya gecince Flow sikca 10s'ye doner.
    await applyAspectOutputsAndDuration(page, project);
  } else {
    const seconds = wantedClipSeconds(project);
    await configureMenuOption(page, project, "durationMenu", `${seconds}s`, "Sure");
  }

  const audioToggle = await locatorFor(page, "audioToggle");
  const wantAudio = project.audioEnabled;
  if (audioToggle && (await audioToggle.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const checked = await audioToggle.getAttribute("aria-checked").catch(() => null);
    const isOn = checked === "true";
    if (checked !== null && isOn !== wantAudio) {
      await audioToggle.click();
      await recordEvent({ projectId: project.id, step: "flow", message: `Ses ${wantAudio ? "acildi" : "kapatildi"}` });
    }
  }

  // Panel acik kalirsa prompt kutusuna tiklanamaz / yanlis contenteditable secilir
  await dismissOverlaysBlockingPrompt(page, project, "uretim ayarlari sonrasi");
  await repairGenerationChipIfNeeded(page, project);
}

/**
 * Prompt cubuguna eklenmis referans sayisini (kucuk onizleme sayisi) verir.
 * Gorsel gercekten "isteme eklendiginde" prompt kutusunun ustunde bir
 * onizleme belirir; basarinin tek kesin kaniti budur.
 */
export async function promptAttachmentCount(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      // Once gonderme dugmesinden kompozisyon cubugunu bul (ilk contenteditable
      // gizli z-index:-1 kutu olabiliyor — ona guvenme)
      const send = Array.from(document.querySelectorAll("button")).find((b) =>
        /arrow_forward/i.test(b.textContent || "")
      );
      let node: HTMLElement | null = (send as HTMLElement | undefined)?.parentElement ?? null;
      for (let up = 0; up < 10 && node; up++) {
        const hasEditor = !!node.querySelector("[contenteditable='true'], textarea");
        if (hasEditor) {
          // Ikon / ok gorsellerini sayma; referans cip onizlemeleri daha buyuk
          const imgs = Array.from(node.querySelectorAll("img")).filter((img) => {
            const w = Math.max(img.naturalWidth || 0, img.width || 0, img.clientWidth || 0);
            const h = Math.max(img.naturalHeight || 0, img.height || 0, img.clientHeight || 0);
            return w >= 28 && h >= 28;
          });
          return imgs.length;
        }
        node = node.parentElement;
      }
      return 0;
    })
    .catch(() => 0);
}

/**
 * Prompt cubugundaki mevcut referans eklerini kaldirir.
 * Her klip kendi referansiyla uretilmelidir; onceki klipten kalan ek
 * temizlenmezse sonraki kliplere yanlis yuz/gorsel tasinir veya AYNI
 * karakter cift gorunur (ozellikle 15-20. klipten sonra).
 */
export async function clearPromptAttachments(page: Page, project: Project): Promise<number> {
  let removed = 0;
  for (let round = 0; round < 16; round++) {
    const before = await promptAttachmentCount(page);
    if (before === 0) break;

    const clicked = await page
      .evaluate(() => {
        const send = Array.from(document.querySelectorAll("button")).find((b) =>
          /arrow_forward/i.test(b.textContent || "")
        );
        let composer: HTMLElement | null = (send as HTMLElement | undefined)?.parentElement ?? null;
        for (let up = 0; up < 10 && composer; up++) {
          const hasEditor = !!composer.querySelector("[contenteditable='true'], textarea");
          if (hasEditor) break;
          composer = composer.parentElement;
        }
        if (!composer) {
          const editor = document.querySelector("[contenteditable='true'], textarea");
          composer = (editor as HTMLElement | null)?.parentElement ?? null;
          for (let up = 0; up < 8 && composer; up++) {
            const hasSend = Array.from(composer.querySelectorAll("button")).some((b) =>
              /arrow_forward/i.test(b.textContent || "")
            );
            if (hasSend) break;
            composer = composer.parentElement;
          }
        }
        if (!composer) return 0;

        const removers = Array.from(composer.querySelectorAll("button")).filter((b) => {
          const text = (b.textContent || "").trim();
          const label = b.getAttribute("aria-label") || "";
          if (/arrow_forward|add_2|add\b/i.test(`${text} ${label}`)) return false;
          return /close|cancel|clear|remove|kald[iı]r|\bsil\b|^\s*×\s*$|^\s*x\s*$/i.test(`${text} ${label}`);
        });
        // Her turda en fazla 2 kaldir — DOM yenilensin
        let n = 0;
        for (const btn of removers.slice(0, 2)) {
          try {
            btn.click();
            n++;
          } catch {
            /* ignore */
          }
        }
        return n;
      })
      .catch(() => 0);

    if (!clicked) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
      const still = await promptAttachmentCount(page);
      if (still === before) break;
      continue;
    }
    await page.waitForTimeout(500);
    const after = await promptAttachmentCount(page);
    if (after < before) removed += before - after;
    else if (after === before) break;
  }

  const leftover = await promptAttachmentCount(page).catch(() => 0);
  if (leftover > 0) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Prompt cubugunda ${leftover} eski referans temizlenemedi — cift karakter riski`,
    });
  } else if (removed > 0) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Prompt cubugundaki ${removed} eski referans eki temizlendi`,
    });
  }
  return removed;
}

/**
 * Kompozisyon cubugundaki "+" dugmesine basip MEDYA PENCERESINI acar.
 *
 * DIKKAT: Ust seritteki "Medya ekle" MENUSU ile karistirilmamalidir. O menu
 * dosyayi yalnizca proje kitapligina yukler; isteme (prompta) EKLEMEZ. Dogru
 * dugme, pencere acan olandir (aria-haspopup="dialog").
 */
async function openMediaDialog(page: Page, project: Project): Promise<boolean> {
  const dialog = mediaPicker(page);
  if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) return true;

  /*
   * Adaylar SONUCA gore denenir: bir dugmenin "gorunur olmasi" dogru dugme
   * oldugunu kanitlamaz. Ust seritteki "Medya ekle" bir MENU acar; dogru dugme
   * PENCERE acandir. Bu yuzden her aday tiklanir ve pencere gercekten acildi mi
   * diye bakilir; acilmadiysa (menu acilmis olabilir) Escape ile kapatilip
   * sonraki aday denenir.
   */
  const structural: SelectorCandidate = { strategy: "css", value: "button[aria-haspopup='dialog']", roleName: "" };
  // flow.google.com: istem kutusundaki "+" aria-haspopup="true" tasir (ust seritteki "Medya ekle" = "menu").
  const composerPlus: SelectorCandidate = { strategy: "css", value: "button[aria-haspopup='true']:has-text('add')", roleName: "" };
  const chain = [structural, composerPlus, ...(await getCandidatesFor("uploadReferenceButton"))];

  for (const candidate of chain) {
    const locator = buildLocator(page, candidate);
    if (!(await locator.isVisible({ timeout: 600 }).catch(() => false))) continue;

    await locator.click().catch(() => {});
    await page.waitForTimeout(900);
    if (await dialog.isVisible({ timeout: 2_500 }).catch(() => false)) {
      // Calisan adayi kalici hale getir: bir sonraki klipte bosuna denenmesin
      await saveCandidates("uploadReferenceButton", [candidate, ...chain.filter((c) => c !== candidate)].slice(0, 8)).catch(() => {});
      return true;
    }
    // Yanlis dugme (or. kitaplik menusu) acilmis olabilir: kapat, sonrakini dene
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }

  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message:
      "Medya penceresi acilamadi. Kalibrasyon ekranindan 'Medya ekleme (+) dugmesi' olarak PROMPT KUTUSUNUN YANINDAKI + dugmesini tanitin (ust seritteki 'Medya ekle' DEGIL).",
  });
  return false;
}

/**
 * Yukleme sonrasi Flow bir medya secim penceresi acar ve gorselin prompta
 * eklenmesi icin onay bekler (Turkce arayuzde "Isleme ekle").
 * Bu adim atlanirsa pencere acik kalir, prompt kutusunu ve Generate'i engeller.
 */
async function confirmReferenceDialog(page: Page, project: Project): Promise<boolean> {
  // Onay dugmesi Turkce arayuzde "Isteme ekle"; aday zinciri (kalibrasyon +
  // yerlesik yazim varyantlari) selectors.ts icinde tanimli.
  const dialog = mediaPicker(page);

  // 1) Yukleme bitene ve onay dugmesi gorunene kadar sabirla bekle.
  //    Dugme gorunmuyorsa yeni yuklenen ogeyi secmek gerekebilir (ilk kucuk resim).
  let confirm: Locator | null = null;
  const deadline = Date.now() + 15_000;
  let triedSelectingItem = false;
  let dialogEverSeen = false;
  while (Date.now() < deadline) {
    confirm = await locatorFor(page, "referenceConfirmButton", { timeoutMs: 900 });
    if (confirm) break;

    const dialogVisible = await dialog.isVisible({ timeout: 400 }).catch(() => false);
    dialogEverSeen = dialogEverSeen || dialogVisible;
    if (!triedSelectingItem && dialogVisible) {
      const firstThumb = dialog.locator("img").first();
      if (await firstThumb.isVisible({ timeout: 400 }).catch(() => false)) {
        triedSelectingItem = true;
        await firstThumb.click().catch(() => {});
        await recordEvent({ projectId: project.id, step: "flow", message: "Medya penceresinde yuklenen gorsel secildi" });
      }
    }
    await page.waitForTimeout(1_000);
  }

  if (!confirm && !dialogEverSeen) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message:
        "Medya secim penceresi hic acilmadi: gorsel kitapliga yuklenmis ama ISTEME EKLENMEMIS olabilir. Referans onemliyse '+' dugmesini ve 'Isteme ekle' ogesini kalibre edin.",
    });
    return false;
  }

  // 2) Onayla ve pencerenin gercekten kapandigini dogrula (en fazla 2 deneme)
  if (confirm) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await confirm.click().catch(() => {});
      await page.waitForTimeout(1_500);
      const stillOpen = await dialog.isVisible({ timeout: 700 }).catch(() => false);
      if (!stillOpen) {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: "Referans gorsel isteme eklendi ('Isteme ekle' onaylandi, pencere kapandi)",
        });
        return true;
      }
      confirm = await locatorFor(page, "referenceConfirmButton", { timeoutMs: 900 });
      if (!confirm) break;
    }
  }

  // 3) Onaylanamadi: prompt kutusunu engellememesi icin pencereyi kapat
  if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message:
        "Medya penceresi onaylanamadi ve kapatildi — referans gorsel ISTEME EKLENMEDI. Kalibrasyon ekranindan 'Medya penceresi onay dugmesi (Isteme ekle)' ogesini pencere acikken tanitin.",
    });
  }
  return false;
}

/**
 * Birden fazla referans gorseli yukler (sirayla).
 * Her ekleme sonrasi cubuk sayisi dogrulanir; eksik kalanlar bir kez daha denenir.
 *
 * Tekil ekleme akisi: + dugmesi → medya penceresi → dosya yukle → liste ogesi
 * tikla → (gerekirse Isteme ekle) → cubuk onizleme sayisi artmali.
 */
export async function uploadReferenceImages(page: Page, project: Project, imagePaths: string[]): Promise<number> {
  const unique = uniqueExistingImagePaths(imagePaths);
  if (unique.length === 0) return 0;

  await clearPromptAttachments(page, project);
  // Temizlik sonrasi cubukta cip kaldiysa yeniden dene — cift karakterin ana kaynagi
  if ((await promptAttachmentCount(page).catch(() => 0)) > 0) {
    await page.waitForTimeout(400);
    await clearPromptAttachments(page, project);
  }

  const failed: string[] = [];
  let uploaded = 0;
  for (const imagePath of unique) {
    // Coklu referansli klipler bu dongude 30+ sn gecirebilir; her adimda
    // heartbeat tazelenmezse reconcileOrphanJobs bu CANLI isi yetim sanabilir
    // (bkz. HEARTBEAT_STALE_MS aciklamasi). Ayrica "durdur" istegi de burada
    // daha hizli fark edilir.
    assertAutomationContinuing();
    const before = await promptAttachmentCount(page).catch(() => uploaded);
    const ok = await uploadReferenceImage(page, project, imagePath, { clearFirst: false });
    const after = await promptAttachmentCount(page).catch(() => before);
    if (after > before) {
      uploaded = after;
      markLibraryKnown(project.id, imagePath);
    } else if (ok) {
      // Sayac artmadi ama ok — yine de bilinen say; tekrar upload etme
      markLibraryKnown(project.id, imagePath);
    } else {
      failed.push(imagePath);
    }
  }

  if (failed.length > 0) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `${failed.length} referans eksik (${uploaded}/${unique.length}); yeniden deneniyor`,
    });
    for (const imagePath of failed) {
      assertAutomationContinuing();
      await page.waitForTimeout(800);
      const before = await promptAttachmentCount(page).catch(() => uploaded);
      const ok = await uploadReferenceImage(page, project, imagePath, { clearFirst: false });
      const after = await promptAttachmentCount(page).catch(() => before);
      if (ok || after > before) {
        uploaded = Math.max(uploaded, after);
        markLibraryKnown(project.id, imagePath);
      }
    }
  }

  const onBar = await promptAttachmentCount(page).catch(() => uploaded);
  await recordEvent({
    projectId: project.id,
    step: "flow",
    message:
      onBar >= unique.length
        ? `${onBar}/${unique.length} referans gorsel isteme eklendi`
        : `${onBar}/${unique.length} referans isteme eklendi (hedef ${unique.length}; bazilari Flow tarafinda tutunamadi)`,
    level: onBar >= unique.length ? "info" : "warning",
  });

  await returnToVideoComposer(page, project);
  return onBar;
}

export async function uploadReferenceImage(
  page: Page,
  project: Project,
  imagePath: string,
  options?: { clearFirst?: boolean }
): Promise<boolean> {
  if (!fs.existsSync(imagePath)) {
    await recordEvent({ projectId: project.id, step: "flow", level: "warning", message: `Referans gorsel bulunamadi: ${imagePath}` });
    return false;
  }

  const fileName = path.basename(imagePath);
  const shortName = fileName.replace(/\.[^.]+$/, "").slice(0, 24);
  if (options?.clearFirst !== false) {
    await clearPromptAttachments(page, project);
  }
  const attachmentsBefore = await promptAttachmentCount(page);

  const finishAttach = async (dialog: ReturnType<Page["locator"]>, how: string): Promise<boolean> => {
    if (await dialog.isVisible({ timeout: 700 }).catch(() => false)) {
      await confirmReferenceDialog(page, project);
    }
    for (let round = 0; round < 4; round++) {
      await escapeAssetDetailView(page, project, { mode: "soft" });
      await page.waitForTimeout(500);
    }
    if (!(await findPromptInput(page, project.id))) {
      await returnToVideoComposer(page, project);
    }
    const attachmentsAfter = await promptAttachmentCount(page);
    if (attachmentsAfter > attachmentsBefore) {
      markLibraryKnown(project.id, imagePath);
      await recordEvent({
        projectId: project.id,
        step: "flow",
        message: `Referans isteme eklendi (${fileName}) · ${how} · cubukta ${attachmentsAfter} ek`,
      });
      return true;
    }
    return false;
  };

  // Onceki kliplerde yuklendiyse TEKRAR upload etme — kutuphaneden adiyla sec
  const preferLibrary = isLibraryKnown(project.id, imagePath);
  if (preferLibrary && (await openMediaDialog(page, project))) {
    const dialog = mediaPicker(page);
    const item = dialog.getByText(new RegExp(escapeRegExp(shortName), "i")).first();
    if (await item.isVisible({ timeout: 3_500 }).catch(() => false)) {
      await item.click().catch(() => {});
      await page.waitForTimeout(1_000);
      if (await finishAttach(dialog, "kutuphaneden")) return true;
    } else {
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  // 1) Medya penceresini ac + dosya yukle (yalnizca ilk sefer / kutuphanede yoksa)
  if (!(await openMediaDialog(page, project))) return false;
  const dialog = mediaPicker(page);

  const dialogInput = dialog.locator("input[type='file']").first();
  const fileInput = (await dialogInput.count().catch(() => 0)) > 0 ? dialogInput : page.locator("input[type='file']").first();
  if ((await fileInput.count().catch(() => 0)) > 0) {
    await fileInput.setInputFiles(imagePath).catch(async (err: Error) => {
      await recordEvent({ projectId: project.id, step: "flow", level: "warning", message: `Dosya yuklenemedi: ${err.message}` });
    });
  } else {
    // Yeni arayuz: sayfada dosya alani yok; "Medya yukle" dugmesi dosya secicisini acar.
    const uploadButton = dialog.getByRole("button", { name: /upload|medya y[uü]kle|upload media/i }).first();
    const chooser = (await uploadButton.isVisible({ timeout: 1_500 }).catch(() => false))
      ? await Promise.all([page.waitForEvent("filechooser", { timeout: 8_000 }), uploadButton.click()])
          .then(([fc]) => fc)
          .catch(() => null)
      : null;
    if (!chooser) {
      await recordEvent({ projectId: project.id, step: "flow", level: "warning", message: "Medya penceresinde dosya alani bulunamadi" });
      await page.keyboard.press("Escape").catch(() => {});
      return false;
    }
    await chooser.setFiles(imagePath).catch(async (err: Error) => {
      await recordEvent({ projectId: project.id, step: "flow", level: "warning", message: `Dosya yuklenemedi: ${err.message}` });
    });
  }
  await page.waitForTimeout(2_800);
  markLibraryKnown(project.id, imagePath);
  await recordEvent({ projectId: project.id, step: "flow", message: `Referans gorsel yuklendi: ${fileName}` });

  // ADIYLA sec — kalabalik kutuphanede "ilk thumbnail" YASAK (yanlis/cift karakter)
  const item = dialog.getByText(new RegExp(escapeRegExp(shortName), "i")).first();
  if (await item.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await item.click().catch(() => {});
    await page.waitForTimeout(1_200);
  } else {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Kutuphanede ad eslesmedi (${shortName}); rastgele thumbnail tiklanmayacak`,
    });
  }

  if (await finishAttach(dialog, "yukle+ad")) return true;

  // Ikinci sans: sadece ad ile tekrar (yeniden upload yok)
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Referans cubuga yapismadi (${fileName}); kutuphaneden ikinci deneme`,
  });
  if (await openMediaDialog(page, project)) {
    const dialog2 = mediaPicker(page);
    const item2 = dialog2.getByText(new RegExp(escapeRegExp(shortName), "i")).first();
    if (await item2.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await item2.click().catch(() => {});
      await page.waitForTimeout(1_200);
      if (await finishAttach(dialog2, "2. deneme")) return true;
    }
    if (await dialog2.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Referans gorsel isteme EKLENEMEDI (${fileName}); klip eksik referansla uretilebilir.`,
  });
  return false;
}

/**
 * Tam ekran gorsel duzenlemeden video prompt cubuguna doner.
 * Kutuphaneden SILMEZ; Bitti / geri / Escape dener. Son care: proje URL.
 */
export async function returnToVideoComposer(page: Page, project: Project): Promise<void> {
  if (/\/edit\//i.test(page.url())) {
    const leftEdit = flowEditAssetId(page.url()).slice(0, 10);
    await escapeAssetDetailView(page, project, { mode: "soft" });
    if (/\/edit\//i.test(page.url())) {
      const match = page.url().match(/^(https?:\/\/[^?#]+\/project\/[0-9a-f][0-9a-f-]{7,})/i);
      if (match) {
        await page.goto(match[1], { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForTimeout(1_500);
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: `Proje editorune donuldu (alt sayfadan cikildi: /edit/${leftEdit})`,
        });
      }
    }
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (await findPromptInput(page, project.id)) {
      if (attempt > 1) {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: `Video editorune donuldu (deneme ${attempt})`,
        });
      }
      return;
    }

    await escapeAssetDetailView(page, project, { mode: "soft" });

    // Bitti / Done (ikon + metin)
    const done = page.getByRole("button", { name: /bitti|done|check/i }).first();
    if (await done.isVisible({ timeout: 500 }).catch(() => false)) {
      await done.click().catch(() => {});
      await page.waitForTimeout(800);
    }

    const back = page.getByRole("button", { name: /arrow_back|geri|back/i }).first();
    if (await back.isVisible({ timeout: 400 }).catch(() => false)) {
      await back.click().catch(() => {});
      await page.waitForTimeout(700);
    }

    // Escape overlay'i kapatir; kutuphane silmez (cop dugmesi siler)
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);

    if (await findPromptInput(page, project.id)) {
      await recordEvent({
        projectId: project.id,
        step: "flow",
        message: `Video editorune donuldu (Escape/Bitti, deneme ${attempt})`,
      });
      return;
    }
  }

  // Son care: proje kokune git (referans cip'leri kaybolabilir; yeniden yuklenir)
  const url = page.url();
  const match = url.match(/^(.*\/project\/[0-9a-f][0-9a-f-]{7,})/i);
  if (match) {
    await page.goto(match[1], { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1_800);
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Gorsel ekraninda takili kalindi; proje adresine donuldu (referanslar yeniden eklenebilir)",
    });
  }

  if (!(await findPromptInput(page, project.id))) {
    throw new Error(
      "Flow gorsel duzenleme ekraninda takili kaldi; video prompt kutusu yok. Chrome'da 'Bitti' ile video editorune donup Devam Ettir'e basin."
    );
  }
}

/**
 * Yuklenen gorsel bazen tam ekran GORUNTU DUZENLEME gorunumunde acilir
 * ("Neyi degistirmek istiyorsunuz?" kutusu + "Bitti" dugmesi). Bu gorunum
 * video prompt kutusunu ele gecirir: prompt goruntu duzenleyiciye yazilir,
 * video uretimi hic baslamaz ve klip zaman asimina ugrar. Tespit edilirse
 * "Bitti"/geri ile kapatilip editore donulur.
 *
 * @param options.mode
 *  - soft: sadece Bitti/geri — kutuphaneden SILMEZ, sayfa yenilemez (referans
 *    yukleme sirasinda zorunlu; aksi halde eklenen karakter silinir)
 *  - aggressive (varsayilan): takili kalmissa kutuphaneden sil / Escape / goto
 *    — prompt cubugunda zaten ek varsa otomatik soft'a duser (generate oncesi
 *    referanslari silmemek icin)
 */
export async function escapeAssetDetailView(
  page: Page,
  project: Project,
  options?: { mode?: "soft" | "aggressive" }
): Promise<void> {
  const requested = options?.mode ?? "aggressive";
  // Isteme cubugunda referans varken kutuphaneden silmek cip'i de kaldirir.
  const attachmentCount = await promptAttachmentCount(page).catch(() => 0);
  const mode = requested === "soft" || attachmentCount > 0 ? "soft" : "aggressive";
  // YALNIZCA gercek goruntu duzenleme: "Neyi degistirmek..." metni VEYA
  // referans baslik input'u + Bitti. "Gecmisi gizle" TEK BASINA yetmez —
  // video editorunde de gorunur ve surekli soft-escape uretimi boguyor.
  const isEditViewOpen = async (): Promise<boolean> => {
    if (/\/edit\//i.test(page.url())) return true;
    const editHint = page
      .getByText(/neyi de[gğ]i[sş]tirmek istiyorsun|what (do you want|would you like) to change/i)
      .first();
    if (await editHint.isVisible({ timeout: 400 }).catch(() => false)) return true;
    const uploadedRefTitle = page.locator("input[value*='reference-flow'], input[value*='-last.']").first();
    const doneButton = page.getByRole("button", { name: /bitti|done/i }).first();
    if (
      (await uploadedRefTitle.isVisible({ timeout: 300 }).catch(() => false)) &&
      (await doneButton.isVisible({ timeout: 300 }).catch(() => false))
    ) {
      return true;
    }
    return false;
  };

  if (!(await isEditViewOpen())) return;

  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message:
      mode === "soft"
        ? `Goruntu duzenleme gorunumu acik; yumusak kapatma (referanslar korunacak${attachmentCount > 0 ? `, cubukta ${attachmentCount} ek` : ""})`
        : "Goruntu duzenleme gorunumu acik (yuklenen gorsel tam ekran acilmis); kapatilip video editorune donuluyor",
  });

  // soft: kutuphaneden ASLA silme — referans-flow / cast gorselleri isteme ekliyken
  // silinirse prompt cubugundaki cip de kaybolur (kullanicinin gordugu "ekle sonra sil").
  if (mode === "aggressive") {
    let deletedCount = 0;
    for (let round = 0; round < 15; round++) {
      if (!(await isEditViewOpen())) break;
      const uploadedRefTitle = page.locator("input[value*='reference-flow'], input[value*='-last.']").first();
      if (!(await uploadedRefTitle.isVisible({ timeout: 700 }).catch(() => false))) break;
      const trashButton = page.getByRole("button", { name: /delete|[cç][oö]p|\bsil\b/i }).first();
      if (!(await trashButton.isVisible({ timeout: 700 }).catch(() => false))) break;
      await trashButton.click().catch(() => {});
      await page.waitForTimeout(800);
      const confirm = page
        .locator("[role='dialog'], [aria-modal='true']")
        .first()
        .getByRole("button", { name: /sil|delete|evet|onayla|confirm/i })
        .first();
      if (await confirm.isVisible({ timeout: 1_200 }).catch(() => false)) {
        await confirm.click().catch(() => {});
      }
      deletedCount++;
      await page.waitForTimeout(1_400);
    }
    if (deletedCount > 0) {
      await recordEvent({
        projectId: project.id,
        step: "flow",
        message: `Takili kalan ${deletedCount} yuklenmis referans varligi Flow kitapligindan silindi (gorunum geri gelemesin diye)`,
      });
    }
  }

  // "Bitti / Done" dugmesi (ikon + metin)
  if (await isEditViewOpen()) {
    const doneButton = page.getByRole("button", { name: /bitti|done/i }).first();
    if (await doneButton.isVisible({ timeout: 700 }).catch(() => false)) {
      await doneButton.click().catch(() => {});
      await page.waitForTimeout(1_000);
    }
  }
  // Hala aciksa: geri + Escape (Escape kutuphaneden silmez; cop dugmesi siler)
  if (await isEditViewOpen()) {
    const back = page.getByRole("button", { name: /arrow_back|geri|back/i }).first();
    if (await back.isVisible({ timeout: 500 }).catch(() => false)) await back.click().catch(() => {});
    else await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(700);
  }
  if (await isEditViewOpen()) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
  }
  // Aggressive son care: Flow proje adresine geri don (soft'ta YAPMA — ekler silinir)
  if (mode === "aggressive" && (await isEditViewOpen())) {
    const url = page.url();
    const match = url.match(/^(.*\/project\/[0-9a-f][0-9a-f-]{7,})/i);
    if (match) {
      await page.goto(match[1], { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(1_500);
    }
  }
  await recordEvent({
    projectId: project.id,
    step: "flow",
    message: (await isEditViewOpen())
      ? "UYARI: goruntu duzenleme gorunumu kapatilamadi"
      : "Video editorune geri donuldu",
    level: (await isEditViewOpen()) ? "warning" : "info",
  });
}

/** Flow prompt kisaltmasi `src/lib/flow-prompt-compact.ts` icinde — yazi yasagi dusmez. */

/** Flow kutuyu sessizce kestiyse ikinci yazimda kullanilacak daha kisa butce. */
const FLOW_PROMPT_FALLBACK_MAX = 6_000;

export async function enterPrompt(page: Page, project: Project, prompt: string): Promise<void> {
  // Flow hard limiti 8000 karakter; asilirsa "hata olustu". DB'deki tam prompt korunur.
  const compacted = compactPromptForFlow(prompt, project.speechLanguage || "Turkish", FLOW_PROMPT_MAX);
  let promptToWrite = clampPromptForFlowBox(ensureNoOnscreenTextLock(compacted.text, FLOW_PROMPT_MAX));
  if (compacted.truncated || prompt.trim().length > promptToWrite.length) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Prompt Flow icin kisaltildi (${prompt.trim().length} → ${promptToWrite.length}/${FLOW_HARD_CHAR_LIMIT} karakter); dil+diyalog+yazi yasagi korundu`,
    });
  }
  if (promptToWrite.length >= FLOW_HARD_CHAR_LIMIT) {
    throw new Error(`Prompt Flow hard limitini (${FLOW_HARD_CHAR_LIMIT}) asiyor; uretim iptal`);
  }

  // Yuklenen gorselin actigi tam ekran duzenleme gorunumu varsa once kapat
  await returnToVideoComposer(page, project);
  await dismissOverlaysBlockingPrompt(page, project, "prompt oncesi");

  let input = (await findPromptInput(page, project.id)) ?? (await ensureEditorReady(page, project));

  const focusPrompt = async (target: Locator): Promise<boolean> => {
    // Flow gercek promptuna HTML zindex="-1" koyuyor; Playwright'in normal
    // click actionability kontrolu bazen 15sn asima ugruyor. Once koordinat /
    // force, sonra DOM focus — normal click en son (ve kisa timeout).
    try {
      const box = await target.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + Math.max(4, box.height / 2));
        return true;
      }
    } catch {
      /* devam */
    }
    try {
      await target.click({ force: true, timeout: 2_500 });
      return true;
    } catch {
      /* devam */
    }
    try {
      await target.evaluate((el) => {
        (el as HTMLElement).focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });
      return true;
    } catch {
      /* devam */
    }
    try {
      await target.click({ timeout: 2_000 });
      return true;
    } catch {
      return false;
    }
  };

  const writePrompt = async (target: Locator): Promise<void> => {
    // Once kutuyu tamamen temizle — eski prompt + yeni prompt birlesip 8000'i asmasin
    try {
      await target.fill("");
    } catch {
      await page.keyboard.press("Control+a").catch(() => {});
      await page.keyboard.press("Delete").catch(() => {});
    }
      try {
        await target.fill(promptToWrite);
        return;
      } catch {
        /* klavye yolu */
    }
    await page.keyboard.press("Control+a").catch(() => {});
    await page.keyboard.press("Delete").catch(() => {});
    await page.keyboard.insertText(promptToWrite);
  };

  const promptLooksWritten = async (): Promise<boolean> => {
    const text = await readPromptText(page, project.id);
    if (!text) return false;
    if (/ne olu[sş]turmak istiyorsun|what do you want to create/i.test(text) && text.length < 80) {
      return false;
    }
    // En azindan promptun basindan bir parca kutuda olmali
    const sample = promptToWrite.trim().slice(0, 40);
    return text.includes(sample) || text.length >= Math.min(40, promptToWrite.trim().length);
  };

  let written = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await dismissOverlaysBlockingPrompt(page, project, `prompt deneme ${attempt}`);
    input = (await findPromptInput(page, project.id)) ?? input;
    const focused = await focusPrompt(input);
    if (!focused) {
      await page.waitForTimeout(500);
      continue;
    }
    await writePrompt(input);
    await page.waitForTimeout(400);
    if (await promptLooksWritten()) {
      written = true;
      break;
    }
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Prompt kutuya yazilamadi (deneme ${attempt}/3); yeniden deneniyor`,
    });
    await page.waitForTimeout(700);
  }

  // Tamlik kontrolu: Flow metni sessizce keserse sondaki yazi-yasagi kilidi ve
  // kuyruk kaybolur. Kutudaki metin yazilanin neredeyse tamami + son parcasi olmali.
  if (written) {
    const isComplete = async (): Promise<boolean> => {
      const box = ((await readPromptText(page, project.id)) || "").replace(/\s+/g, "");
      const sent = promptToWrite.replace(/\s+/g, "");
      return box.length >= sent.length * 0.97 && box.includes(sent.slice(-40));
    };
    if (!(await isComplete())) {
      const boxLength = ((await readPromptText(page, project.id)) || "").length;
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "warning",
        message: `Flow prompt kutusu metni kesti (${promptToWrite.length} yazildi, kutuda ${boxLength}); ${FLOW_PROMPT_FALLBACK_MAX} karakterlik kisaltmayla yeniden yaziliyor`,
      });
      const shorter = compactPromptForFlow(prompt, project.speechLanguage || "Turkish", FLOW_PROMPT_FALLBACK_MAX);
      promptToWrite = clampPromptForFlowBox(ensureNoOnscreenTextLock(shorter.text, FLOW_PROMPT_FALLBACK_MAX), FLOW_PROMPT_FALLBACK_MAX);
      await writePrompt(input);
      await page.waitForTimeout(400);
      if (!(await isComplete())) {
        throw new Error(
          `Flow prompt kutusu metni kesiyor (${promptToWrite.length} karakter bile tam yazilamadi). Eksik prompt gonderilmedi; Flow'da kutuyu kontrol edip Devam Ettir'e basin.`
        );
      }
    }
  }

  if (!written) {
    const snapshot = await captureDebugSnapshot(page, project.slug, "prompt-write-failed");
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "error",
      message: "Prompt chat kutusuna yazilamadi (gizli/yanlis contenteditable veya panel engeli)",
      screenshotPath: snapshot.screenshotPath,
      pageUrl: page.url(),
    });
    throw new Error(
      "Prompt chat kutusuna yazilamadi. Chrome'da Flow proje editorunun acik oldugundan ve prompt cubugunun gorundugunden emin olun, sonra Devam Ettir'e basin."
    );
  }

  await recordEvent({
    projectId: project.id,
    step: "flow",
    message: `Prompt yazildi (${promptToWrite.trim().length} karakter)`,
  });
}

/** Prompt kutusuna odaklanip Enter gonderir (Flow'da uretimi baslatir). */
async function submitPromptWithEnter(page: Page, project: Project): Promise<boolean> {
  const input = await findPromptInput(page, project.id);
  if (!input) return false;
  await input.click().catch(() => {});
  // Imleci metnin sonuna al (ortada Enter satir bolebilir)
  await page.keyboard.press("Control+End").catch(() => {});
  await page.keyboard.press("Enter");
  return true;
}

/** Prompt kutusundaki guncel metni okur (bulunamazsa null). */
async function readPromptText(page: Page, projectId: string): Promise<string | null> {
  const input = await findPromptInput(page, projectId);
  if (!input) return null;
  const text = (await input.innerText().catch(() => "")) || (await input.inputValue().catch(() => ""));
  return text.trim();
}

/** Generate'e basar (auto modda) ve uretimin basladigini dogrular. */
/**
 * Video akisinda hicbir kalici pencere acik olmamalidir; acik kalan medya
 * secim penceresi vb. hem kartlari orter hem tiklamalari yutar. Kapatir.
 */
async function closeStrayDialog(page: Page, project: Project, context: string): Promise<void> {
  const dialog = mediaPicker(page);
  if (!(await dialog.isVisible({ timeout: 300 }).catch(() => false))) return;
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
  if (await dialog.isVisible({ timeout: 300 }).catch(() => false)) {
    // Escape yetmediyse pencere disina tikla
    await page.mouse.click(4, 300).catch(() => {});
    await page.waitForTimeout(500);
  }
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Acik kalan pencere kapatildi (${context})`,
  });
}

/** Generate referansi /edit/ olarak acar. Nano Banana bitsin; Bitti'ye BASMA — sonuc bu ekranda. */
async function dismissSheetEditOpenedByGenerate(page: Page, project: Project): Promise<void> {
  if (!/\/edit\//i.test(page.url())) return;
  const deadline = Date.now() + 95_000;
  let sawBusy = false;
  while (Date.now() < deadline && /\/edit\//i.test(page.url())) {
    assertAutomationContinuing();
    const button = await resolveGenerateButton(page);
    const busy = button ? await button.isDisabled({ timeout: 400 }).catch(() => false) : false;
    if (busy) sawBusy = true;
    if (sawBusy && button && !busy) break;
    await page.waitForTimeout(1_000);
  }
  await recordEvent({
    projectId: project.id,
    step: "flow",
    message: sawBusy
      ? "Nano Banana bitti — sonuc duzenleme ekraninda, Bitti'ye basilmadi"
      : "Generate duzenleme ekranini acmis; uretim bitisi beklenemedi, duzenlemede kalindi",
  });
}

const STILL_SCENE_REWRITE =
  "Keep this exact face, hair, age and skin. Restage as one 16:9 story freeze in a real lived-in kitchen or apartment: table, papers, keys, hands in action, even practical indoor light. Forbidden: gray or white cyclorama, catalog pose, ID photo, empty negative space, looking straight at camera like a character sheet, blown-out white window, wall lamp, high-key studio light.";

async function findEditPromptBox(page: Page): Promise<Locator | null> {
  const all = page.locator("[contenteditable='true'], textarea");
  const count = await all.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 20); i += 1) {
    const candidate = all.nth(i);
    if (!(await candidate.isVisible({ timeout: 250 }).catch(() => false))) continue;
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || box.width < 120 || box.height < 14) continue;
    const meta = await candidate
      .evaluate((el) => ({
        text: (el.textContent || "").replace(/\uFEFF/g, "").trim().slice(0, 180),
        placeholder: el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || "",
      }))
      .catch(() => null);
    if (!meta) continue;
    if (EDIT_BOX_HINT.test(meta.text) || EDIT_BOX_HINT.test(meta.placeholder)) return candidate;
  }
  if (/\/edit\//i.test(page.url())) {
    const near = composerRoot(page).locator("[contenteditable='true'], textarea").first();
    if (await near.isVisible({ timeout: 400 }).catch(() => false)) return near;
  }
  return null;
}

/** Katalog MCU /edit/ icindeyken sahneye restage — ikinci Generate. */
async function restageCatalogAsScene(page: Page, project: Project): Promise<boolean> {
  const box = await findEditPromptBox(page);
  if (!box) return false;
  await box.click({ force: true, timeout: 2_000 }).catch(() => {});
  await page.keyboard.press("Control+a").catch(() => {});
  await page.keyboard.press("Delete").catch(() => {});
  await page.keyboard.insertText(STILL_SCENE_REWRITE).catch(() => {});
  await page.waitForTimeout(400);
  const written = ((await box.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  if (written.length < 40) {
    await page.keyboard.insertText(STILL_SCENE_REWRITE).catch(() => {});
    await page.waitForTimeout(300);
  }
  const again = ((await box.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  if (again.length < 40) return false;
  const button = await resolveGenerateButton(page);
  if (!button) return false;
  await button.click({ timeout: 5_000 }).catch(async () => {
    await button.click({ force: true }).catch(() => {});
  });
  await recordEvent({
    projectId: project.id,
    step: "flow",
    message: `Katalog MCU — duzenleme kutusundan sahne restage Generate (${again.length} karakter)`,
  });
  const until = Date.now() + 18_000;
  while (Date.now() < until) {
    const busy = await button.isDisabled({ timeout: 300 }).catch(() => false);
    if (busy) return true;
    await page.waitForTimeout(400);
  }
  return true;
}

export async function startGeneration(
  page: Page,
  project: Project,
  mode: "auto" | "manual",
  opts?: { output?: "video" | "image" }
): Promise<void> {
  const output = opts?.output ?? "video";
  // Generate'e basmadan: tam ekran onizlemeden cik (mod degistirmez)
  await returnToVideoComposer(page, project);
  await closeStrayDialog(page, project, "uretim oncesi");

  if (output === "image") {
    await forceImageOutputMode(page, project);
    let imageLabel = await readOutputModeLabel(page);
    if (!isImageOutputModeLabel(imageLabel)) {
      throw new Error(
        `Generate iptal: Flow gorsel modunda degil ("${imageLabel.slice(0, 50)}"). Cikti turunu Metinden goruntuye / Nano Banana yapin.`
      );
    }
  } else {
    await ensureVideoOutputMode(page, project);
    const videoLabel = await readOutputModeLabel(page);
    if (isImageOutputModeLabel(videoLabel)) {
      throw new Error(
        `Generate iptal: Flow GÖRÜNTÜ modunda ("${videoLabel.slice(0, 50)}"). Çıktı türünü video yapıp tekrar deneyin.`
      );
    }
  }

  const modeLabel = await readOutputModeLabel(page);

  if (!(await findPromptInput(page, project.id))) {
    await returnToVideoComposer(page, project);
    if (!(await findPromptInput(page, project.id))) {
      throw new Error(
        output === "image"
          ? "Gorsel prompt kutusu bulunamadi; Generate'e basilmadi"
          : "Video prompt kutusu bulunamadi (yuklenen gorselin tam ekran duzenleme gorunumu acik olabilir); video yerine gorsel uretmemek icin Generate'e basilmadi"
      );
    }
  }

  const promptTextBefore = await readPromptText(page, project.id);
  if (!promptTextBefore || promptTextBefore.length < 8) {
    throw new Error("Generate iptal: prompt kutusu bos veya yazilamamis");
  }

  // 10s + 9:16 + Veo Fast sessizce video uretmez; gorsel modunda bu kontrol yok.
  if (output === "video") {
    await assertGenerationChipReady(page, project);
  }

  let enterAlreadyTried = mode !== "auto";
  let generateWasEnabled = true;

  const clickGenerate = async (): Promise<void> => {
    const button = await resolveGenerateButton(page);
    if (button) {
      generateWasEnabled = !(await button.isDisabled({ timeout: 800 }).catch(() => false));
      // Once normal tikla (force disabled dugmeye "basilmis gibi" gorunur ama Flow yutmaz)
      if (generateWasEnabled) {
        await button.click({ timeout: 5_000 }).catch(async () => {
          await button.click({ force: true }).catch(() => {});
        });
      } else {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "warning",
          message: "Generate dugmesi pasif; once Enter denenecek",
        });
        await submitPromptWithEnter(page, project);
        enterAlreadyTried = true;
        return;
      }
      await recordEvent({
        projectId: project.id,
        step: "flow",
        message: `Generate dugmesine basildi (modu: ${modeLabel.slice(0, 40) || "bilinmiyor"})`,
      });
    } else {
      if (!(await submitPromptWithEnter(page, project))) throw new SelectorMissingError("generateButton");
      enterAlreadyTried = true;
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "warning",
        message: "Generate dugmesi bulunamadi; prompt kutusunda Enter ile gonderildi. Dugmeyi kalibre etmeniz onerilir.",
      });
    }
  };

  if (output === "image") {
    const promptBox = await findPromptInput(page, project.id);
    if (promptBox) {
      const box = await promptBox.boundingBox().catch(() => null);
      if (box) {
        await promptBox
          .click({ position: { x: Math.min(24, Math.max(8, box.width / 4)), y: Math.min(10, box.height / 2) } })
          .catch(() => {});
      }
    }
  }

  if (mode === "auto") {
    await clickGenerate();
  } else {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "YARI OTOMATIK MOD: Generate dugmesine Flow penceresinde ELLE basin. Uretim algilandiginda otomasyon devam edecek.",
    });
  }

  const settings = await getSettings();
  const startTimeout = mode === "auto" ? 45_000 : 180_000;
  const deadline = Date.now() + startTimeout;
  const enterFallbackAt = Date.now() + 6_000;
  const secondClickAt = Date.now() + 12_000;
  let secondClickDone = false;

  while (Date.now() < deadline) {
    const current = await readPromptText(page, project.id);
    if (current !== null && (current.length === 0 || !current.includes(promptTextBefore.slice(0, 25)))) {
      await recordEvent({ projectId: project.id, step: "flow", message: "Uretim basladi (prompt gonderildi, kutu temizlendi)" });
      if (output === "image") await dismissSheetEditOpenedByGenerate(page, project);
      return;
    }

    const progress = await locatorFor(page, "generationProgress", { selfHeal: false, timeoutMs: 700 });
    if (progress) {
      await recordEvent({ projectId: project.id, step: "flow", message: "Uretim basladi (ilerleme gostergesi gorundu)" });
      if (output === "image") await dismissSheetEditOpenedByGenerate(page, project);
      return;
    }

    if (output === "image") {
      const button = await resolveGenerateButton(page);
      if (button && (await button.isDisabled({ timeout: 400 }).catch(() => false))) {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: "Uretim basladi (Generate dugmesi pasif — Nano Banana calisiyor)",
        });
        await dismissSheetEditOpenedByGenerate(page, project);
        return;
      }
    }

    if (!enterAlreadyTried && Date.now() >= enterFallbackAt) {
      enterAlreadyTried = true;
      if (output === "image") {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: "Gorsel uretimde Enter yedegi atlandi — Generate tiklamasi yeterli, yeni kare bekleniyor",
        });
      } else {
      await returnToVideoComposer(page, project).catch(() => {});
      if (await submitPromptWithEnter(page, project)) {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "warning",
          message: "Generate tiklamasi uretimi baslatmadi; prompt kutusunda Enter ile gonderildi",
        });
        }
      }
    }

    if (mode === "auto" && !secondClickDone && Date.now() >= secondClickAt) {
      secondClickDone = true;
      if (output === "image") {
        const button = await resolveGenerateButton(page);
        const stillEnabled = button
          ? !(await button.isDisabled({ timeout: 800 }).catch(() => true))
          : false;
        const progressNow = await locatorFor(page, "generationProgress", { selfHeal: false, timeoutMs: 500 });
        if (button && stillEnabled && !progressNow) {
          // Composer'da kal — returnToVideoComposer duzenleme gorunumune dusuruyordu.
          await button.click({ timeout: 5_000 }).catch(async () => {
            await button.click({ force: true }).catch(() => {});
          });
          await recordEvent({
            projectId: project.id,
            step: "flow",
            level: "warning",
            message: "Gorsel Generate hâlâ aktif — ilk tiklama uretimi baslatmamis, composer'da kalarak tekrar tiklandi",
          });
        } else {
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: "Gorsel uretimde ikinci Generate atlandi (dugme pasif veya ilerleme var); yeni kare bekleniyor",
          });
        }
      } else {
      await returnToVideoComposer(page, project).catch(() => {});
      await closeStrayDialog(page, project, "generate yeniden");
      await clickGenerate();
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "warning",
        message: "Generate ikinci kez denendi (ilk tiklama promptu gondermedi)",
      });
      }
    }

    await interruptibleSleep(settings.pollIntervalMs);
  }

  // Gorsel modunda prompt kutusu bazen temizlenmiyor ve ilerleme cubugu hic
  // gorunmuyor; gercek dogrulama yeni karenin belirmesidir (waitForNewComposerImage).
  // Bu yuzden burada firlatmak yerine uyari birakilir.
  if (output === "image" && mode === "auto") {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Gorsel uretiminin basladigi dogrulanamadi; yeni kare beklenerek devam ediliyor",
    });
    await dismissSheetEditOpenedByGenerate(page, project);
    return;
  }

  throw new Error(
    mode === "auto"
      ? "Uretimin basladigi dogrulanamadi (prompt kutusu temizlenmedi / ilerleme gorunmedi). Flow'da cikti turunun VIDEO oldugundan ve gorsel duzenleme ekraninda olmadiginizdan emin olun."
      : "Elle Generate beklenirken zaman asimi (180 sn). Otomasyonu duraklattiktan sonra tekrar deneyin."
  );
}

export interface CompletionSignals {
  completeIndicator: boolean;
  progressGone: boolean;
  generateEnabled: boolean;
  errorVisible: boolean;
  errorText: string;
}

/**
 * Bir secici anahtarinin sayfadaki eslesme SAYISINI olcer (adaylar arasi en
 * yuksek deger). Medya listesindeki kartlar (eski hatalar, eski videolar)
 * kalici oldugu icin "var/yok" yerine sayim kullanilir: uretim oncesine gore
 * sayi ARTARSA yeni bir kart olusmus demektir.
 */
export async function countSelectorMatches(page: Page, key: string): Promise<number> {
  const { getCandidatesFor } = await import("@/server/automation/selectors");
  const candidates = await getCandidatesFor(key);
  let max = 0;
  for (const candidate of candidates) {
    try {
      let count = 0;
      if (candidate.strategy === "text") count = await page.getByText(new RegExp(candidate.value, "i")).count();
      else if (candidate.strategy === "role" && candidate.roleName)
        count = await page
          .getByRole(candidate.value as Parameters<Page["getByRole"]>[0], { name: new RegExp(candidate.roleName, "i") })
          .count();
      else if (candidate.strategy === "css") count = await page.locator(candidate.value).count();
      max = Math.max(max, count);
    } catch {
      // gecersiz aday sayimi etkilemesin
    }
  }
  return max;
}

const FLOW_FAILURE_TEXT =
  /hay aksi|ba[sş]ar[iı]s[iı]z|hata olu[sş]tu|[uü]cret al[iı]nmaz|generation failed|something went wrong|won'?t be charged|politikalar[iı]m[iı]z[iı] ihlal|ihlal ediyor olabilir|may violate|violates? (our|the) polic|content polic|hatay[ıi].{0,48}ç[oö]z|ç[oö]z[uü]l[uü]yor|yeniden den[ie]n|tekrar den[ie]n/i;

/** Icerik politikasi reddi: once ayni istemle retry, sonra yumusatma. */
export const POLICY_BLOCK_TEXT = FLOW_POLICY_BLOCK_TEXT;

const FLOW_RETRY_BUTTON_NAME = /^\s*(yeniden dene|tekrar dene|try again|retry)\s*$/i;

/**
 * Flow hata kartindaki "Yeniden dene" — ayni istemle tekrar (filtre bazen yalanci reddeder).
 * "yeniden deneniyor" durum yazisini tiklamaz.
 */
export async function clickFlowRetryIfVisible(page: Page, projectId?: string): Promise<boolean> {
  const candidates = [
    page.getByRole("button", { name: FLOW_RETRY_BUTTON_NAME }).first(),
    page.getByRole("link", { name: FLOW_RETRY_BUTTON_NAME }).first(),
    page.getByText(FLOW_RETRY_BUTTON_NAME).first(),
  ];
  for (const loc of candidates) {
    if (!(await loc.isVisible({ timeout: 500 }).catch(() => false))) continue;
    await loc.click({ timeout: 3_000 }).catch(() => {});
    await recordEvent({
      projectId,
      step: "flow",
      message: "Flow hata kartinda Yeniden dene tiklandi (ayni istem)",
    });
    return true;
  }
  return false;
}

/**
 * Politika reddi — once karttaki Yeniden dene, sonra ayni/yumusak/sifir kademeleri.
 * Hepsinden sonra klip atlanir; is durmaz.
 */
export class PolicyBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyBlockedError";
  }
}

/** Hata metnine gore dogru hata turunu uretir. */
function generationFailureError(errorText: string): Error {
  const compact = errorText.replace(/\s+/g, " ").trim();
  const bareFail =
    /^(ba[sş]ar[iı]s[iı]z|failed|hay aksi)(\s*\|\s*(ba[sş]ar[iı]s[iı]z|failed|hay aksi))*$/i.test(compact);
  if (POLICY_BLOCK_TEXT.test(errorText) || bareFail) {
    return new PolicyBlockedError(
      `Flow icerik politikasi bu istemi reddetti: "${errorText.slice(0, 160)}"`
    );
  }
  return new Error(`Flow uretim hatasi: ${errorText.slice(0, 200)}`);
}

/** Ekrandaki Flow hata karti metnini toplar (sayim artmasa bile). */
async function collectVisibleErrorText(page: Page): Promise<string> {
  try {
    const locators = page.getByText(FLOW_FAILURE_TEXT);
    const n = await locators.count();
    const chunks: string[] = [];
    for (let i = 0; i < Math.min(n, 4); i++) {
      const text = ((await locators.nth(i).textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
      if (text) chunks.push(text.slice(0, 180));
    }
    // Yeni Flow karti metni parcali gelebiliyor; govdeden de tara.
    const bodyHit = await page
      .evaluate(() => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ");
        const at = text.search(/ba[sş]ar[ıi]s[ıi]z|tan[ıi]nm[ıi][sş]\s+ki[sş]iler|politikalar[ıi]m[ıi]z[ıi]\s+ihlal/i);
        return at < 0 ? "" : text.slice(Math.max(0, at - 40), at + 220);
      })
      .catch(() => "");
    if (bodyHit && !chunks.some((c) => c.includes(bodyHit.slice(0, 40)))) chunks.push(bodyHit);
    return chunks.join(" | ");
  } catch {
    return "";
  }
}

/**
 * Sayfadaki video varliklarinin kimliklerini toplar.
 * Flow her medyaya sabit bir kimlik verir: .../media.getMediaUrlRedirect?name=<kimlik>
 * Uretim oncesi/sonrasi bu kumeleri kiyaslamak, "yeni video gercekten olustu mu"
 * sorusunun TEK kesin cevabidir (kart sayimi sanal listede yaniltir).
 */
export async function snapshotVideoAssetIds(page: Page): Promise<Set<string>> {
  const sources = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll("video"))
        .map((v) => (v as HTMLVideoElement).getAttribute("src") || v.querySelector("source")?.getAttribute("src") || "")
        .filter(Boolean)
    )
    .catch(() => [] as string[]);

  const ids = new Set<string>();
  for (const src of sources) {
    const match = src.match(/name=([0-9a-fA-F-]{8,})/);
    if (match) ids.add(match[1]);
  }
  for (const key of await videoTileKeys(page)) ids.add(key);
  return ids;
}

/**
 * flow.google.com: sayfada <video> yok; her klip bir flow-video-tile kucuk resmi.
 * Anahtar kucuk resim adresinden gelir (…/image/<uuid> ya da …/asb/<jeton>).
 * DOM sirasi = en yeni ustte.
 */
/**
 * flow.google.com listesi sanal (yalnizca gorunen kartlar DOM'da) ve en yeni klip EN USTTE.
 * Sayfa asagi kaymissa yeni kart hic gorunmez → zaman asimi → ayni klip ikinci kez uretilir.
 * Yalnizca en uste doner (asagi kaydirma eski kartlari "yeni" gosterirdi; o yapilmaz).
 */
async function scrollFlowGridToTop(page: Page): Promise<void> {
  const scrolled = await page
    .evaluate(() => {
      let moved = false;
      for (const el of Array.from(document.querySelectorAll(".cdk-virtual-scrollable, cdk-virtual-scroll-viewport.tiles-container"))) {
        if ((el as HTMLElement).scrollTop > 0) {
          (el as HTMLElement).scrollTo({ top: 0 });
          moved = true;
        }
      }
      return moved;
    })
    .catch(() => false);
  // Sanal liste yeni satirlari bir sonraki karede cizer.
  if (scrolled) await page.waitForTimeout(400);
}

export async function videoTileKeys(page: Page): Promise<string[]> {
  await scrollFlowGridToTop(page);
  // Kart once kucuk resim (img.thumbnail), fare ustunden gecince <video> olur.
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll("flow-video-tile"))
        .map((tile) => {
          const media = tile.querySelector("video[src], img.thumbnail[src]");
          const src = (media?.getAttribute("src") || "").split("?")[0];
          const uuid = src.match(/\/(?:image|video)\/([0-9a-f]{8}-[0-9a-f-]{27,})/i)?.[1];
          if (uuid) return uuid;
          return /\/asb\//.test(src) ? src.slice(-60) : "";
        })
        .filter(Boolean)
    )
    .catch(() => [] as string[]);
}

function videoTileFor(page: Page, key: string): Locator {
  return page.locator(`flow-grid-tile-container:has(flow-video-tile [src*="${key}"])`).first();
}

/**
 * Yeni arayuzde kartin "Diger secenekler" → "Indir" alt menusunu acar (kalite
 * secimi sonra downloadVideoItem ile yapilir). key yoksa en ustteki (en yeni) kart.
 */
async function openVideoTileDownloadMenu(page: Page, key: string | null): Promise<boolean> {
  const tile = key ? videoTileFor(page, key) : page.locator("flow-grid-tile-container:has(flow-video-tile [src])").first();
  if ((await tile.count().catch(() => 0)) === 0) return false;
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await tile.hover().catch(() => {});
  await page.waitForTimeout(400);
  const more = tile.locator("button.mat-mdc-menu-trigger").first();
  if ((await more.count().catch(() => 0)) === 0) return false;
  await more.click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const downloadItem = page
    .locator("[role='menuitem']")
    .filter({ hasText: /^\s*download/i })
    .first();
  // isVisible beklemez; alt menuler animasyonla acildigi icin waitFor kullanilir.
  if (!(await downloadItem.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false))) {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  await downloadItem.click().catch(() => {});
  await page.waitForTimeout(600);
  // Kalite MENU ICINDEN secilir: sayfa geneli "720" metin aramasi istem
  // cubugundaki "Video · 720p · 8 sn." cipine tiklayip indirmeyi baslatmiyordu.
  // Alt menu ayri bir katmanda acilir; menuitem aramasi sayfa geneli (cip bir menuitem degil).
  const original = page
    .locator("[role='menuitem']")
    .filter({ hasText: /720p|orijinal boyut|original size/i })
    .first();
  if (!(await original.waitFor({ state: "visible", timeout: 4_000 }).then(() => true).catch(() => false))) {
    // Alt menu tiklamayla acilmadiysa uzerine gel (bazi surumlerde hover ile acilir)
    await downloadItem.hover().catch(() => {});
    if (!(await original.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false))) {
      await page.keyboard.press("Escape").catch(() => {});
      return false;
    }
  }
  await original.click().catch(() => {});
  return true;
}

/**
 * Uretim oncesinde olmayan bir video varligi arar.
 *
 * KAYDIRMA YAPILMAZ: sanal listede asagi/yukari kaydirmak, daha once hic
 * gorunmemis ESKI kartlari DOM'a sokar ve bunlar "yeni" sanilir. Bu yuzden
 * yalnizca o an gorunen kartlara bakilir ve aday, KENDI indirme dugmesi
 * bulunabiliyorsa kabul edilir — indirilecek kartla ayni sey oldugu boylece
 * garanti altina alinir.
 */
async function findNewVideoAssetId(page: Page, known: Set<string>): Promise<string | null> {
  const current = await snapshotVideoAssetIds(page);
  for (const id of current) {
    if (known.has(id)) continue;
    if (await cardDownloadButtonFor(page, id)) return id;
  }
  // Yeni arayuz: yalnizca EN USTTEKI kart yeni sayilir (eski kartin kucuk resmi
  // yeniden cizilip adresi degisirse "yeni" sanilmasin).
  const top = (await videoTileKeys(page))[0];
  if (top && !known.has(top)) return top;
  return null;
}

/**
 * Uretim tamamlanmasini coklu sinyalle bekler:
 * - YENI video varligi (kesin kanit; donus degeri bu varligin kimligidir)
 * - generationComplete gostergesi / kart sayisi artisi
 * - ilerleme gostergesinin kaybolmasi + Generate'in aktiflesmesi
 * - YENI hata karti (uretim oncesi sayima gore artis) -> hata
 * - zaman asimi -> ekran goruntusu + HTML snapshot ile hata
 */
export async function waitForCompletion(page: Page, project: Project, knownAssetIds?: Set<string>): Promise<string | null> {
  const settings = await getSettings();
  const startedAt = Date.now();
  const deadline = startedAt + settings.generationTimeoutMs;
  // Bir video uretimi saniyeler icinde bitemez; erken "tamamlandi" kararlari
  // eski kartlardan kaynaklanir. Ilk 20 saniyede tamamlanma kabul edilmez.
  const minWaitUntil = startedAt + 20_000;
  let progressSeen = false;

  // Eski kartlar (basarisiz VE tamamlanmis) listede kalicidir; yalnizca
  // SAYIM ARTISI yeni kart demektir.
  let staleErrorCount = await countSelectorMatches(page, "errorBanner");
  const staleCompleteCount = await countSelectorMatches(page, "generationComplete");
  // Politika reddi gibi ANINDA basarisizliklarda Flow ilerleme gostergesi hic
  // gostermez ve kart sayimi da (eski kart yenisiyle degistiginde) artmayabilir.
  // Bu yuzden gorunur hata METNI de baslangictakiyle kiyaslanir.
  let staleFailureText = await collectVisibleErrorText(page);
  const inPagePolicyRetry = { used: false };
  let retryClickedAt = 0;
  if (staleErrorCount > 0 || staleCompleteCount > 0) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Not: onceki denemelerden kalan kartlar var (hata: ${staleErrorCount}, video: ${staleCompleteCount}); yalnizca YENI kartlar dikkate alinacak`,
    });
  }

  while (Date.now() < deadline) {
    assertAutomationContinuing();

    // SPA bazen "son acik varlik" gorunumunu gecikmeli geri getirir; bu tam
    // ekran gorunum video kartlarini DOM'dan gizler ve tamamlanma hic
    // algilanamaz. Her turda kontrol edip kapat (temizken ~1 sn surer).
    // Uretim sirasinda soft: referans/son kare cip'lerini kutuphaneden silme.
    await escapeAssetDetailView(page, project, { mode: "soft" });
    // Ayni sekilde acik kalan medya secim penceresi de kartlari orter.
    await closeStrayDialog(page, project, "video bekleme");

    const elapsed = Date.now() - startedAt;
    const liveFailureText = await collectVisibleErrorText(page);
    // Taninmis kisi karti ayni istemle gecmez; 12 sn'de (yeni kartsa) yumusatmaya birak.
    if (elapsed >= 12_000 && isCelebrityPolicyText(liveFailureText) && liveFailureText !== staleFailureText) {
      throw generationFailureError(liveFailureText);
    }
    if (elapsed >= 12_000 && liveFailureText && isStuckFlowResolvingText(liveFailureText) && liveFailureText !== staleFailureText) {
      const snapshot = await captureDebugSnapshot(page, project.slug, "flow-stuck-resolving");
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "error",
        message: `Flow hata-cozme / yeniden-deneme ekraninda takildi: ${liveFailureText.slice(0, 160)}`,
        screenshotPath: snapshot.screenshotPath,
        pageUrl: page.url(),
      });
      throw generationFailureError(liveFailureText);
    }

    const signals = await readCompletionSignals(page);

    const currentErrorCount = await countSelectorMatches(page, "errorBanner");
    if (currentErrorCount > staleErrorCount) {
      const banner = await locatorFor(page, "errorBanner", { selfHeal: false, timeoutMs: 700 });
      const errorText = banner ? ((await banner.textContent().catch(() => "")) ?? "") : "";
      if (!inPagePolicyRetry.used && POLICY_BLOCK_TEXT.test(errorText) && !isCelebrityPolicyText(errorText) && (await clickFlowRetryIfVisible(page, project.id))) {
        inPagePolicyRetry.used = true;
        retryClickedAt = Date.now();
        progressSeen = false;
        staleErrorCount = await countSelectorMatches(page, "errorBanner");
        staleFailureText = await collectVisibleErrorText(page);
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "warning",
          message: `Politika reddi — Flow Yeniden dene tiklandi, ayni istemle bekleniyor. ${errorText.slice(0, 80)}`,
        });
        continue;
      }
      const snapshot = await captureDebugSnapshot(page, project.slug, "flow-error");
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "error",
        message: `Yeni Flow hata karti belirdi (${staleErrorCount} -> ${currentErrorCount}): ${errorText.slice(0, 160)}`,
        screenshotPath: snapshot.screenshotPath,
        pageUrl: page.url(),
      });
      throw generationFailureError(errorText || "yeni hata karti belirdi");
    }

    if (!progressSeen && !signals.progressGone) progressSeen = true;

    if (Date.now() >= minWaitUntil) {
      // Tamamlanma gostergesi: SAYIM ARTISI (yeni video karti belirdi).
      // Ilerleme bitti + Generate aktif TEK BASINA yetmez: Flow basarisiz
      // oldugunda da Generate geri gelir ve yanlis "tamamlandi" sanilir.
      const currentCompleteCount = await countSelectorMatches(page, "generationComplete");
      const newCardAppeared = currentCompleteCount > staleCompleteCount;

      // EN GUCLU KANIT once: yeni video varsa eski politika karti yutulur.
      if (knownAssetIds) {
        const newAssetId = await findNewVideoAssetId(page, knownAssetIds);
        if (newAssetId) {
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: `Uretim tamamlandi (yeni video varligi: ${newAssetId.slice(0, 8)})`,
          });
          return newAssetId;
        }
      } else if (newCardAppeared) {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: `Uretim tamamlandi (sinyaller: yeni video karti${progressSeen && signals.progressGone ? ", ilerleme bitti" : ""}${signals.generateEnabled ? ", Generate aktif" : ""})`,
        });
        return null;
      }

      const errorText = await collectVisibleErrorText(page);
      if (
        shouldTreatVisibleFailureAsNew({
          errorText,
          staleFailureText,
          inPageRetryUsed: inPagePolicyRetry.used,
          msSinceRetry: retryClickedAt ? Date.now() - retryClickedAt : 0,
          elapsedMs: elapsed,
          progressSeen,
          progressGone: signals.progressGone,
          generateEnabled: signals.generateEnabled,
        })
      ) {
        if (!inPagePolicyRetry.used && POLICY_BLOCK_TEXT.test(errorText) && !isCelebrityPolicyText(errorText) && (await clickFlowRetryIfVisible(page, project.id))) {
          inPagePolicyRetry.used = true;
          retryClickedAt = Date.now();
          progressSeen = false;
          staleErrorCount = await countSelectorMatches(page, "errorBanner");
          staleFailureText = errorText;
          await recordEvent({
            projectId: project.id,
            step: "flow",
            level: "warning",
            message: `Politika reddi — Flow Yeniden dene tiklandi, ayni istemle bekleniyor. ${errorText.slice(0, 80)}`,
          });
          continue;
        }
        const snapshot = await captureDebugSnapshot(page, project.slug, "flow-error");
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "error",
          message: `Flow uretimi basarisiz (yeni video yok, hata metni var): ${errorText.slice(0, 160)}`,
          screenshotPath: snapshot.screenshotPath,
          pageUrl: page.url(),
        });
        throw generationFailureError(errorText);
      }

      // Medya listesi SANALLASTIRILMIS: gorunur pencere doluyken yeni kart
      // eskisini DOM disina iter ve sayim hic artmaz. Bu durumda guvenilir
      // sinyal ILERLEME DONGUSUDUR: gonderimden sonra ilerleme gorunduyse,
      // bittiyse ve YENI hata metni yoksa uretim tamamlanmis demektir.
      // knownAssetIds varken bile ilerleme dongusu kabul edilir AMA indirme
      // kimliksiz kalir (yedek menu); yine de 420sn beklemekten iyidir.
      if (progressSeen && signals.progressGone && signals.generateEnabled) {
        if (!errorText || !POLICY_BLOCK_TEXT.test(errorText)) {
          // Gorsel modda kisa "ilerleme" + jpeg uretimini video sanma:
          // knownAssetIds varsa ve yeni <video> yoksa daha uzun bekle.
          if (knownAssetIds && Date.now() - startedAt < 90_000) {
            /* video kimligi gelene kadar sabret */
          } else {
            await recordEvent({
              projectId: project.id,
              step: "flow",
              message: knownAssetIds
                ? "Uretim tamamlandi varsayiliyor (ilerleme bitti; yeni video kimligi henuz DOM'da yok)"
                : "Uretim tamamlandi (ilerleme dongusu bitti; kart sayimi sanal liste nedeniyle artmadi)",
            });
            return null;
          }
        }
      }

      // Ilerleme cubugu da sanal listede hic gorunmemis olabilir. Bu durumda
      // 150 sn sonra tamamlandigi VARSAYILABILIR — ama YALNIZCA varlik
      // kimligi kiyaslamasi yapilamiyorsa. Kimlik kiyasi mumkunse ve yeni
      // varlik yoksa "tamamlandi" demek, eski videoyu yeni klip sanmaya yol
      // acar (kimlik yoksa dogru kart da secilemez), bu yuzden beklenmeye
      // devam edilir ve sonunda zaman asimi hatasi verilir.
      if (!knownAssetIds && Date.now() - startedAt >= 150_000 && signals.progressGone && signals.generateEnabled) {
        if (!errorText || !POLICY_BLOCK_TEXT.test(errorText)) {
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: "Uretim tamamlandi varsayiliyor (150 sn gecti, hata izi yok, varlik kimligi kiyasi yapilamiyor)",
          });
          return null;
        }
      }
    }

    // 9:16 + 10s / sessiz red: ilerleme hic gelmez, 420 sn "Uretim Bekleniyor"da kalinmaz.
    // Politika karti gorunuyorsa ayni istemle beklenmez; yumusatilmis istemle devam edilir.
    if (elapsed >= 55_000 && !progressSeen && knownAssetIds) {
      if (POLICY_BLOCK_TEXT.test(liveFailureText)) throw generationFailureError(liveFailureText);
      const snapshot = await captureDebugSnapshot(page, project.slug, "flow-no-progress");
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "error",
        message: `Uretim 55 sn'de ilerlemedi (yeni video yok). 9:16 short 10s veya yanlis modelde Flow sessizce duser.`,
        screenshotPath: snapshot.screenshotPath,
        pageUrl: page.url(),
      });
      throw new Error(
        "Uretim 55 saniyede baslamadi (ilerleme yok, yeni video yok). 9:16 short'ta sure 8s ve model Veo 3.1 Fast olmali; 10s'de Flow video uretmez."
      );
    }

    await interruptibleSleep(settings.pollIntervalMs);
  }

  const seconds = Math.round(settings.generationTimeoutMs / 1000);
  const detail = knownAssetIds
    ? " Sure boyunca YENI bir video varligi olusmadi: uretim ya hic baslamadi ya da video yerine baska bir cikti (or. gorsel) uretildi. Referans gorsel yuklendikten sonra cikti turunun 'Video' kaldigini kontrol edin."
    : "";
  const timeoutFailure = await collectVisibleErrorText(page);
  if (POLICY_BLOCK_TEXT.test(timeoutFailure)) throw generationFailureError(timeoutFailure);
  const snapshot = await captureDebugSnapshot(page, project.slug, "generation-timeout");
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "error",
    message: `Uretim zaman asimi (${seconds} sn).${detail}`,
    screenshotPath: snapshot.screenshotPath,
    pageUrl: page.url(),
  });
  throw new Error(`Uretim zaman asimina ugradi (${seconds} saniye).${detail}`);
}

async function readCompletionSignals(page: Page): Promise<CompletionSignals> {
  const signals: CompletionSignals = {
    completeIndicator: false,
    progressGone: true,
    generateEnabled: false,
    errorVisible: false,
    errorText: "",
  };

  // Sinyal okumalarinda kendini onarma kapali: bir ogenin YOKLUGU da anlamli
  // bir bilgidir, bu yuzden yedek aday promosyonu yapilmamalidir.
  const signalOptions = { selfHeal: false, timeoutMs: 700 };

  const complete = await locatorFor(page, "generationComplete", signalOptions);
  signals.completeIndicator = complete !== null;

  const progress = await locatorFor(page, "generationProgress", signalOptions);
  signals.progressGone = progress === null;

  const generateButton = await locatorFor(page, "generateButton", signalOptions);
  if (generateButton) {
    signals.generateEnabled = await generateButton.isEnabled({ timeout: 700 }).catch(() => false);
  }

  // Hata tespiti burada YAPILMAZ: bayat kartlara takilmamak icin
  // waitForCompletion icindeki sayim bazli kontrol kullanilir.

  return signals;
}

/**
 * Belirli bir video varliginin KENDI kartindaki indirme dugmesini bulur.
 * Flow'un guncel arayuzunde her tamamlanmis klip kartinda dogrudan bir "Indir"
 * dugmesi vardir; uc nokta menusune gerek yoktur.
 *
 * Video, kart icinde derin bir zincirin (oynat dugmesi > baglanti > sarmalayici
 * div'ler) sonunda durur; kartin eylem cubugu bu zincirin ~15 kademe ustundedir.
 * Bu yuzden yukari dogru cikilir, ancak ata BIRDEN FAZLA video icermeye
 * baslarsa durulur: aksi halde komsu klibin dugmesine basilir ve yanlis
 * (eski) video inerdi.
 */
export async function cardDownloadButtonFor(page: Page, assetId: string): Promise<Locator | null> {
  const video = page.locator(`video[src*="${assetId}"]`).first();
  if ((await video.count().catch(() => 0)) === 0) return null;

  for (let up = 1; up <= 18; up++) {
    const ancestor = video.locator(`xpath=${Array(up).fill("..").join("/")}`);
    if ((await ancestor.count().catch(() => 0)) === 0) return null;
    // Kart sinirini astik mi? (ata artik birden fazla klip iceriyor)
    if ((await ancestor.locator("video").count().catch(() => 0)) > 1) return null;

    const button = ancestor.locator("button").filter({ hasText: /download|[iİ]ndir/i }).first();
    if (await button.isVisible({ timeout: 300 }).catch(() => false)) return button;
  }
  return null;
}

/**
 * flow.google.com: kartin uzerine gelinince kucuk resim, imzali dogrudan video
 * adresine (<video src="…/video/<uuid>?Signature…">) donusur; Flow'un "720p Orijinal
 * boyut" indirmesi de ayni adresi ceker. Dosya bu adresten tarayici oturumuyla
 * alinir — menu + blob indirmesi (saveAs sirasinda tarayici kapaniyordu) gerekmez.
 */
async function fetchVideoTileFile(page: Page, project: Project, key: string, finalPath: string): Promise<boolean> {
  const tile = videoTileFor(page, key);
  if ((await tile.count().catch(() => 0)) === 0) return false;
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await tile.hover().catch(() => {});
  const video = tile.locator("flow-video-tile video[src]").first();
  await video.waitFor({ state: "attached", timeout: 5_000 }).catch(() => {});
  const src = (await video.getAttribute("src").catch(() => null)) || "";
  await page.mouse.move(5, 400).catch(() => {});
  if (!/^https?:\/\//i.test(src)) return false;
  const response = await page.context().request.get(src, { timeout: 120_000 }).catch(() => null);
  if (!response || !response.ok()) {
    await recordEvent({
      projectId: project.id,
      step: "download",
      level: "warning",
      message: `Dogrudan video adresi indirilemedi (${response ? response.status() : "baglanti yok"}); menu yoluna dusuluyor`,
    });
    return false;
  }
  const body = await response.body();
  if (body.length < 50_000) return false;
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.writeFileSync(finalPath, body);
  return true;
}

/** Ureyen videoyu indirir ve hedef yola kaydeder. */
export async function downloadClipVideo(
  page: Page,
  project: Project,
  targetPath: string,
  newAssetId?: string | null
): Promise<string> {
  // Kartin ve dugmelerin yerlesmesi icin kisa sure bekle
  await page.waitForTimeout(1_500);

  if (newAssetId) {
    const directPath = nextAvailablePath(targetPath);
    if (await fetchVideoTileFile(page, project, newAssetId, directPath)) {
      await recordEvent({
        projectId: project.id,
        step: "download",
        message: `Video indirildi: ${path.basename(directPath)} (dogrudan adres, varlik: ${newAssetId.slice(0, 8)})`,
      });
      return directPath;
    }
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  let clickedCardButton = false;
  // Yeni arayuz yolunda kalite zaten menuden secildi; asagidaki genel kalite araması atlanir.
  let qualityChosen = false;

  // 1) TERCIH EDILEN YOL: yeni uretilen varligin KENDI kartindaki "Indir".
  //    Sayfa/proje seviyesindeki menuler ("Diger secenekler" -> "Projeyi
  //    indir") her seferinde AYNI eski arsivi verdigi icin once bu denenir.
  // flow.google.com karti: uc nokta → Indir → kalite. Kartin atasindaki "download"
  // dugmesi GRUBUN "Toplu indir"idir (indirme olayi gelmiyor) — ona basilmaz.
  const isNewUiTile = Boolean(newAssetId) && (await videoTileFor(page, newAssetId as string).count().catch(() => 0)) > 0;
  if (isNewUiTile) {
    if (await openVideoTileDownloadMenu(page, newAssetId as string)) {
      clickedCardButton = true;
      qualityChosen = true;
      await recordEvent({
        projectId: project.id,
        step: "download",
        message: `Yeni klibin kart menusunden Indir acildi (varlik: ${(newAssetId as string).slice(0, 8)})`,
      });
    }
  } else if (newAssetId) {
    const cardButton = await cardDownloadButtonFor(page, newAssetId);
    if (cardButton) {
      await cardButton.click({ timeout: 5_000 }).catch(() => {});
      clickedCardButton = true;
      await recordEvent({
        projectId: project.id,
        step: "download",
        message: `Yeni uretilen klibin kendi indirme dugmesine basildi (varlik: ${newAssetId.slice(0, 8)})`,
      });
    } else if (await openVideoTileDownloadMenu(page, newAssetId)) {
      clickedCardButton = true;
      qualityChosen = true;
      await recordEvent({
        projectId: project.id,
        step: "download",
        message: `Yeni klibin kart menusunden Indir acildi (varlik: ${newAssetId.slice(0, 8)})`,
      });
    } else {
      await recordEvent({
        projectId: project.id,
        step: "download",
        level: "warning",
        message: `Yeni varligin karti bulunamadi (${newAssetId.slice(0, 8)}); menu yoluna dusuluyor`,
      });
    }
  } else if (await openVideoTileDownloadMenu(page, null)) {
    clickedCardButton = true;
    qualityChosen = true;
    await recordEvent({ projectId: project.id, step: "download", message: "En yeni klibin kart menusunden Indir acildi" });
  }

  // 2) YEDEK YOL: kart dugmesi yoksa eski menu akisi (uc nokta -> Indir).
  if (!clickedCardButton) {
    const assetMenu = await resolveAssetMenuButton(page);
    if (!assetMenu) throw new SelectorMissingError("assetMenuButton");
    await assetMenu.click();
    await page.waitForTimeout(700);

    const downloadItem = await resolveDownloadMenuItem(page);
    if (!downloadItem) throw new SelectorMissingError("downloadMenuItem");
    await downloadItem.click();
  }

  // Kalite alt menusu: birkac saniye boyunca yokla; gorunuyorsa tikla.
  // Gorunmuyorsa indirme dogrudan baslamis demektir.
  const qualityDeadline = qualityChosen ? 0 : Date.now() + 6_000;
  while (Date.now() < qualityDeadline) {
    const videoItem = await locatorFor(page, "downloadVideoItem", { selfHeal: false, timeoutMs: 800 });
    if (videoItem) {
      await videoItem.click().catch(() => {});
      await recordEvent({ projectId: project.id, step: "download", message: "Indirme kalitesi secildi" });
      break;
    }
    await page.waitForTimeout(800);
  }

  const download = await downloadPromise;
  const suggested = download.suggestedFilename();

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const finalPath = nextAvailablePath(targetPath);
  await download.saveAs(finalPath);

  const failure = await download.failure();
  if (failure) throw new Error(`Indirme basarisiz: ${failure}`);

  // Flow videolari ZIP arsivi icinde teslim eder; icindeki MP4 cikarilir
  await extractVideoIfArchive(finalPath, project.id);

  await recordEvent({ projectId: project.id, step: "download", message: `Video indirildi: ${path.basename(finalPath)} (kaynak: ${suggested})` });
  return finalPath;
}

/* -------------------------------------------------------------------------
 * GORSEL MODU (Nano Banana)
 *
 * Flow, prompt cubugundaki cikti turu menusunden gorsel uretimine gecebilir.
 * Karakter, slayt ve tarz fotograflari bu modeli kullanir. Nano Banana Pro
 * kota/limit dolunca buradan Nano Banana 2'ye gecilir (tek nokta).
 * ------------------------------------------------------------------------- */

/** Flow'da tum fotograf uretimlerinde varsayilan model. Proje.flowImageModel onu ezer. */
export { FLOW_IMAGE_MODEL, resolveFlowImageModel };

function isPreferredImageModel(label: string, wanted: string = FLOW_IMAGE_MODEL): boolean {
  return imageModelNamesMatch(label, wanted);
}

async function clickWantedImageModelOption(page: Page, wanted: string): Promise<boolean> {
  const items = page.getByRole("menuitem");
  const count = await items.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const text = (await item.textContent().catch(() => "")) ?? "";
    if (imageModelNamesMatch(text, wanted)) {
      await item.click().catch(() => {});
      return true;
    }
  }
  const options = page.getByRole("option");
  const optionCount = await options.count().catch(() => 0);
  for (let i = 0; i < optionCount; i++) {
    const option = options.nth(i);
    const text = (await option.textContent().catch(() => "")) ?? "";
    if (!imageModelNamesMatch(text, wanted)) continue;
    if (await option.isVisible({ timeout: 400 }).catch(() => false)) {
    await option.click().catch(() => {});
    return true;
  }
  }
  const byText = page.getByText(new RegExp(escapeRegExp(wanted), "i"));
  const textCount = await byText.count().catch(() => 0);
  for (let i = textCount - 1; i >= 0; i--) {
    const node = byText.nth(i);
    if (!(await node.isVisible({ timeout: 300 }).catch(() => false))) continue;
    const text = ((await node.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    if (!imageModelNamesMatch(text, wanted)) continue;
    await node.click().catch(() => {});
    return true;
  }
  return false;
}

/**
 * Prompt cubugundaki cikti turunu degistirir (video <-> gorsel).
 * Kalibre secici yoksa veya yanlis kalibre ise metin eslesmesiyle zorla secer;
 * tikladiktan sonra etiketi dogrular — yanlis moda dusmez.
 */
export async function switchOutputType(page: Page, project: Project, target: "image" | "video"): Promise<boolean> {
  const before = await readOutputModeLabel(page);
  if (target === "image" && isImageOutputModeLabel(before)) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Cikti turu zaten gorsel (${before.slice(0, 48) || "ok"})`,
    });
    return true;
  }
  if (target === "video" && isVideoOutputModeLabel(before) && !isImageOutputModeLabel(before)) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Cikti turu zaten video (${before.slice(0, 48) || "ok"})`,
    });
    return true;
  }

  const menuOpened = await openOutputTypeMenu(page, project);
  if (!menuOpened) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Cikti turu menusu acilamadi (kalibrasyon: 'Cikti turu menusu').",
    });
    return false;
  }

  const clicked =
    (await clickCalibratedOutputOption(page, target)) || (await clickOutputTypeOptionByText(page, target));
  if (!clicked) {
    await page.keyboard.press("Escape").catch(() => {});
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Cikti turu menusunde ${target === "image" ? "gorsel (Metinden goruntuye / Nano Banana)" : "video"} secenegi bulunamadi`,
    });
    return false;
  }

  await page.waitForTimeout(800);
  const after = await readOutputModeLabel(page);
  const ok =
    target === "image"
      ? isImageOutputModeLabel(after)
      : isVideoOutputModeLabel(after) && !isImageOutputModeLabel(after);

  if (!ok) {
  await recordEvent({
    projectId: project.id,
    step: "flow",
      level: "warning",
      message: `Cikti turu ${target} secilemedi (once: "${before.slice(0, 36)}", sonra: "${after.slice(0, 36)}")`,
    });
    return false;
  }

  await recordEvent({
    projectId: project.id,
    step: "flow",
    message: `Cikti turu degistirildi: ${target === "image" ? "gorsel (Nano Banana)" : "video (Veo)"} → ${after.slice(0, 48)}`,
  });
  return true;
}

async function openOutputTypeMenu(page: Page, project: Project): Promise<boolean> {
  const menu = await locatorFor(page, "outputTypeMenu");
  if (menu && (await menu.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await menu.click().catch(() => {});
    await page.waitForTimeout(450);
    return true;
  }

  // Kalibre yoksa: prompt cubugundaki bilinen mod dugmesi
  const typeBtn = page
    .getByRole("button", {
      name: /(metinden (videoya|g[oö]r[uü]nt[uü]ye)|text to (video|image)|malzemelerden|ingredients to|frames to video|g[oö]r[uü]nt[uü]den video|nano\s*banana)/i,
    })
    .first();
  if (await typeBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await typeBtn.click().catch(() => {});
    await page.waitForTimeout(450);
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: "Cikti turu menusu metin dugmesinden acildi",
    });
    return true;
  }
  return false;
}

async function clickCalibratedOutputOption(page: Page, target: "image" | "video"): Promise<boolean> {
  const optionKey = target === "image" ? "imageModeOption" : "videoModeOption";
  const option = await locatorFor(page, optionKey, { timeoutMs: 1_200 });
  if (!option || !(await option.isVisible({ timeout: 800 }).catch(() => false))) return false;
  const text = ((await option.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  // Yanlis kalibrasyon: gorsel isterken "video" satiri / tersi
  if (target === "image" && /video|veo/i.test(text) && !/g[oö]r[uü]nt[uü]|image|banana/i.test(text)) {
    return false;
  }
  if (target === "video" && /g[oö]r[uü]nt[uü]|image|banana/i.test(text) && !/video|veo/i.test(text)) {
    return false;
  }
  await option.click().catch(() => {});
  return true;
}

/** Menudeki satiri metinle tikla; gorselde video satirini ASLA secme. */
async function clickOutputTypeOptionByText(page: Page, target: "image" | "video"): Promise<boolean> {
  const imageRes = [
    /metinden\s+g[oö]r[uü]nt[uü]ye/i,
    /text\s*to\s*image/i,
    /nano\s*banana/i,
    /ingredients\s*to\s*image/i,
    /malzemelerden\s+g[oö]r[uü]nt[uü]/i,
  ];
  const videoRes = [
    /metinden\s+videoya/i,
    /text\s*to\s*video/i,
    /ingredients\s*to\s*video/i,
    /malzemelerden\s+video/i,
    /frames\s*to\s*video/i,
    /g[oö]r[uü]nt[uü]den\s+videoya/i,
  ];
  const patterns = target === "image" ? imageRes : videoRes;

  const collect = async (role: "menuitem" | "option") => {
    const items = page.getByRole(role);
    const count = await items.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      if (!(await item.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const text = ((await item.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (target === "image" && /video|veo/i.test(text) && !/g[oö]r[uü]nt[uü]|image|banana/i.test(text)) continue;
      if (target === "video" && /g[oö]r[uü]nt[uü]|image|banana/i.test(text) && !/video/i.test(text)) continue;
      if (patterns.some((re) => re.test(text))) return item;
    }
    return null;
  };

  for (const role of ["menuitem", "option"] as const) {
    const hit = await collect(role);
    if (hit) {
      await hit.click().catch(() => {});
      return true;
    }
  }

  for (const re of patterns) {
    const byText = page.getByText(re).last();
    if (!(await byText.isVisible({ timeout: 600 }).catch(() => false))) continue;
    const text = ((await byText.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    if (target === "image" && /video|veo/i.test(text) && !/banana|g[oö]r[uü]nt[uü]|image/i.test(text)) continue;
    await byText.click().catch(() => {});
    return true;
  }
  return false;
}

/**
 * Gorsel modu ZORUNLU — basarisizsa false. Karakter / slayt uretiminde video'ya dusulmez.
 */
export async function ensureImageOutputMode(page: Page, project: Project): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (isImageOutputModeLabel(await readOutputModeLabel(page))) {
      if (attempt > 1) {
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: `Gorsel mod dogrulandi (deneme ${attempt})`,
        });
      }
      return true;
    }
    if (await switchOutputType(page, project, "image")) {
      if (isImageOutputModeLabel(await readOutputModeLabel(page))) return true;
    }
    if (await clickImageTabInSettingsPanel(page, project)) {
      await dismissOverlaysBlockingPrompt(page, project, "gorsel sekmesi sonrasi");
      if (isImageOutputModeLabel(await readOutputModeLabel(page))) return true;
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }
  return false;
}

/** Karakter/slayt: gorsel degilse hata firlat (video uretimine ASLA dusme). */
export async function forceImageOutputMode(page: Page, project: Project): Promise<void> {
  if (await ensureImageOutputMode(page, project)) return;
  const label = await readOutputModeLabel(page);
  throw new Error(
    `Flow GORSEL moda alinamadi (su an: "${label.slice(0, 60) || "bilinmiyor"}"). ` +
      `Cikti turu menusunden "Metinden goruntuye" / Nano Banana secin. Video (Veo) karakter icin kullanilmaz.`
  );
}

/**
 * Gorsel modunda model menusunden Nano Banana Pro secer.
 * Menu yoksa Flow'un o anki gorsel modeli kullanilir.
 */
export async function selectImageModel(page: Page, project: Project, wantedModel?: string): Promise<void> {
  // Prisma client alani bos kalsa bile SQL'deki proje ayari gecerli.
  // Isteyen kod "Nano Banana 2" gonderse de kayitli Pro'yu 2'ye cevirme.
  const wanted = await readProjectFlowImageModel(project.id);
  if (wantedModel && resolveFlowImageModel(wantedModel) !== wanted) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Gorsel modeli proje ayarindan okundu: ${wanted} (istek ${resolveFlowImageModel(wantedModel)} yok sayildi)`,
    });
  }
  const menu = await locatorFor(page, "modelMenu");
  if (!menu || !(await menu.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Model menusu bulunamadi; Flow'daki mevcut gorsel modeli kullanilacak (hedef ${wanted})`,
    });
    return;
  }
  const currentText = ((await menu.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  if (isPreferredImageModel(currentText, wanted)) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Gorsel modeli zaten ${wanted}`,
    });
    return;
  }
  await menu.click();
  await page.waitForTimeout(400);
  const clicked = await clickWantedImageModelOption(page, wanted);
  await page.waitForTimeout(350);
  const afterMenu = await locatorFor(page, "modelMenu");
  const afterText = ((await afterMenu?.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  if (clicked && isPreferredImageModel(afterText, wanted)) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Gorsel modeli secildi: ${currentText.slice(0, 40) || "?"} → ${wanted}`,
    });
    return;
  }
  if (clicked && !isPreferredImageModel(afterText, wanted)) {
    await menu.click().catch(() => {});
    await page.waitForTimeout(350);
    await clickWantedImageModelOption(page, wanted);
    await page.waitForTimeout(300);
    const retryText = ((await (await locatorFor(page, "modelMenu"))?.textContent().catch(() => "")) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (isPreferredImageModel(retryText, wanted)) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
        message: `Gorsel modeli secildi (2. deneme): ${wanted}`,
    });
    return;
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Model menusunde "${wanted}" secilemedi (su an: "${afterText.slice(0, 48) || currentText.slice(0, 48) || "?"}"); mevcut secim korundu`,
  });
}

/**
 * Prompt cubugunun bulundugu proje editorune doner.
 *
 * Karakterler sayfasi (.../project/<id>/characters) proje adresiyle AYNI
 * onekle basladigi icin openFlowProject orada hicbir sey yapmaz; o sayfada
 * prompt cubugu ve cikti turu menusu yoktur. Alt sayfa adresi kirpilip
 * editorun yuklenmesi beklenir.
 */
export async function ensureProjectComposer(
  page: Page,
  project: Project,
  opts?: { reload?: boolean }
): Promise<void> {
  const url = page.url();
  const projectRoot = flowProjectComposerRoot(page, project);
  const onSubpage = Boolean(projectRoot) && isFlowProjectSubpage(url, projectRoot);
  if (projectRoot && (opts?.reload || onSubpage)) {
    await page.goto(projectRoot, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(opts?.reload ? 2_000 : 1_800);
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: opts?.reload
        ? "Proje editoru yenilendi — onceki varlik secimi temizlendi"
        : `Proje editorune donuldu (alt sayfadan cikildi: ${url.slice(projectRoot.length).slice(0, 32)})`,
    });
  }
  await ensureEditorReady(page, project);
}

/** Ayarlar panelindeki gorsel sekmesi (cikti turu menusu bulunamazsa yedek). */
async function clickImageTabInSettingsPanel(page: Page, project: Project): Promise<boolean> {
  if (!(await openGenerationSettingsPanel(page, project))) return false;
  const tabs = page.locator("[role='tab'], [role='radio']");
  const count = await tabs.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    const text = ((await tab.textContent().catch(() => "")) ?? "").trim();
    if (!text || /video|videocam/i.test(text)) continue;
    if (!/image|photo|resim|g[oö]r[uü]nt[uü]/i.test(text)) continue;
    if ((await tab.getAttribute("aria-checked").catch(() => null)) !== "true") {
      await tab.click().catch(() => {});
      await page.waitForTimeout(600);
    }
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Cikti turu ayarlar panelinden gorsel yapildi (${text.slice(0, 32)})`,
    });
    return true;
  }
  return false;
}

/**
 * Iki kare arasinda kompozisyon cubugunu TEMIZ "metinden goruntuye" durumuna
 * dondurur.
 *
 * Flow, uretilen kareyi otomatik secip prompt cubugunu Nano Banana DUZENLEME
 * kutusuna ("Neyi degistirmek istiyorsun?") cevirebiliyor. O kutu yeni kare
 * uretmez; seri uretim ikinci karede takilir. Cikti turu menusunden gorsel
 * modunu yeniden secmek bu durumu sifirlar; olmazsa proje adresine donulur.
 */
export async function resetImageComposer(page: Page, project: Project, imageModel?: string): Promise<void> {
  await escapeAssetDetailView(page, project, { mode: "soft" });
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  // Kok sayfada da son kare secili kalabiliyor; Generate ayni /edit/<id> acar.
  await ensureProjectComposer(page, project, { reload: true });
  await forceImageOutputMode(page, project);
  await page.keyboard.press("Escape").catch(() => {});
  const vp = page.viewportSize();
  await page.mouse.click(vp ? Math.round(vp.width * 0.42) : 640, 56).catch(() => {});
  await page.waitForTimeout(250);

  if (await findPromptInput(page, project.id)) {
    if (isImageOutputModeLabel(await readOutputModeLabel(page)) && !/\/edit\//i.test(page.url())) return;
  }

  // Cikti turunu yeniden sec: duzenleme kutusundan uretim kutusuna dondurur.
  await switchOutputType(page, project, "image").catch(() => {});
  await page.waitForTimeout(400);
  if ((await findPromptInput(page, project.id)) && isImageOutputModeLabel(await readOutputModeLabel(page))) return;

  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: "Gorsel istem kutusu temiz degil (duzenleme moduna kaymis olabilir); proje editoru yeniden yukleniyor",
  });
  await ensureProjectComposer(page, project);
  await forceImageOutputMode(page, project);
  if (await openGenerationSettingsPanel(page, project)) {
    await selectImageModel(page, project, imageModel);
  }
}

/**
 * Gorsel slayt / Nano Banana Pro: cikti turu + model + 16:9.
 */
export async function configureImageGeneration(page: Page, project: Project, imageModel?: string): Promise<void> {
  // Karakterler gibi alt sayfalarda prompt cubugu yok; once editore don.
  await ensureProjectComposer(page, project);
  await forceImageOutputMode(page, project);

  // ONEMLI: model dugmesi SADECE ayarlar paneli acikken DOM'da gorunur
  // (bkz. selector-guide.ts modelMenu). Panel acilmadan selectImageModel
  // cagirmak menuyu hep "bulunamadi" olarak isaretleyip Flow'da o an
  // secili olan (ornegin kotasi biten Nano Banana Pro) modelde takili
  // birakiyordu — panel HER ZAMAN once acilir.
  const wanted = await readProjectFlowImageModel(project.id);
  const panelOpen = await openGenerationSettingsPanel(page, project);
  if (panelOpen) {
    await selectImageModel(page, project, wanted);
    await selectSettingsTab(page, project, project.aspectRatio || "16:9", "En-boy orani");
    await selectSettingsTab(page, project, "x1", "Cikti sayisi");
  }
  await dismissOverlaysBlockingPrompt(page, project, "gorsel ayarlari sonrasi");
  // Panel tiklamalari modu bozabiliyor — Generate oncesi tekrar kilitle
  await forceImageOutputMode(page, project);
}

/**
 * Gorsel uretiminin tamamlanmasini bekler.
 * Video beklemesinden farki: "generationComplete" secicisi video kartina
 * kalibre edilmis olabilir. Gorselde en guvenilir sinyal, varlik menusu
 * dugmesi (assetMenuButton) sayisinin ARTMASIDIR; video karti sayimi da
 * yedek sinyal olarak kabul edilir.
 */
export async function waitForImageCompletion(page: Page, project: Project): Promise<void> {
  const settings = await getSettings();
  const startedAt = Date.now();
  const deadline = startedAt + settings.generationTimeoutMs;
  // Gorsel uretimi videodan cok daha hizlidir; kisa bir asgari bekleme yeterli
  const minWaitUntil = startedAt + 5_000;

  let staleErrorCount = await countSelectorMatches(page, "errorBanner");
  const staleAssetCount = await countSelectorMatches(page, "assetMenuButton");
  const staleCompleteCount = await countSelectorMatches(page, "generationComplete");
  let progressSeen = false;
  const inPagePolicyRetry = { used: false };

  while (Date.now() < deadline) {
    assertAutomationContinuing();
    const currentErrorCount = await countSelectorMatches(page, "errorBanner");
    if (currentErrorCount > staleErrorCount) {
      const banner = await locatorFor(page, "errorBanner", { selfHeal: false, timeoutMs: 700 });
      const errorText = banner ? ((await banner.textContent().catch(() => "")) ?? "") : "";
      if (!inPagePolicyRetry.used && POLICY_BLOCK_TEXT.test(errorText) && !isCelebrityPolicyText(errorText) && (await clickFlowRetryIfVisible(page, project.id))) {
        inPagePolicyRetry.used = true;
        staleErrorCount = await countSelectorMatches(page, "errorBanner");
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "warning",
          message: `Politika reddi — Flow Yeniden dene tiklandi, ayni istemle bekleniyor. ${errorText.slice(0, 80)}`,
        });
        continue;
      }
      const snapshot = await captureDebugSnapshot(page, project.slug, "flow-image-error");
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "error",
        message: `Gorsel uretiminde hata karti belirdi: ${errorText.slice(0, 160)}`,
        screenshotPath: snapshot.screenshotPath,
        pageUrl: page.url(),
      });
      throw generationFailureError(errorText || "hata karti belirdi");
    }

    const progress = await locatorFor(page, "generationProgress", { selfHeal: false, timeoutMs: 600 });
    if (progress) progressSeen = true;

    if (Date.now() >= minWaitUntil) {
      const assetCount = await countSelectorMatches(page, "assetMenuButton");
      const completeCount = await countSelectorMatches(page, "generationComplete");
      if (assetCount > staleAssetCount || completeCount > staleCompleteCount) {
        await recordEvent({ projectId: project.id, step: "flow", message: "Gorsel uretimi tamamlandi (yeni varlik karti belirdi)" });
        return;
      }
      // Ilerleme gorunup bittiyse ve yeni kart yoksa hata metni ariyoruz
      if (progressSeen && !progress) {
        const errorText = await collectVisibleErrorText(page);
        if (errorText) {
          if (!inPagePolicyRetry.used && POLICY_BLOCK_TEXT.test(errorText) && !isCelebrityPolicyText(errorText) && (await clickFlowRetryIfVisible(page, project.id))) {
            inPagePolicyRetry.used = true;
            staleErrorCount = await countSelectorMatches(page, "errorBanner");
            await recordEvent({
              projectId: project.id,
              step: "flow",
              level: "warning",
              message: `Politika reddi — Flow Yeniden dene tiklandi, ayni istemle bekleniyor. ${errorText.slice(0, 80)}`,
            });
            continue;
          }
          const snapshot = await captureDebugSnapshot(page, project.slug, "flow-image-error");
          await recordEvent({
            projectId: project.id,
            step: "flow",
            level: "error",
            message: `Gorsel uretimi basarisiz gorunuyor: ${errorText.slice(0, 160)}`,
            screenshotPath: snapshot.screenshotPath,
            pageUrl: page.url(),
          });
          throw generationFailureError(errorText);
        }
      }
    }
    await interruptibleSleep(settings.pollIntervalMs);
  }

  const snapshot = await captureDebugSnapshot(page, project.slug, "image-generation-timeout");
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "error",
    message: `Gorsel uretimi zaman asimi (${Math.round(settings.generationTimeoutMs / 1000)} sn)`,
    screenshotPath: snapshot.screenshotPath,
    pageUrl: page.url(),
  });
  throw new Error(`Gorsel uretimi zaman asimina ugradi (${Math.round(settings.generationTimeoutMs / 1000)} saniye)`);
}

/** Ureyen gorseli indirir ve hedef yola kaydeder. */
export async function downloadImageAsset(page: Page, project: Project, targetPath: string): Promise<string> {
  await page.waitForTimeout(1_200);

  const assetMenu = await resolveAssetMenuButton(page);
  if (!assetMenu) throw new SelectorMissingError("assetMenuButton");
  await assetMenu.click();
  await page.waitForTimeout(700);

  const downloadItem = await resolveDownloadMenuItem(page);
  if (!downloadItem) throw new SelectorMissingError("downloadMenuItem");

  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await downloadItem.click();

  // Boyut/kalite alt menusu acilirsa kisa sure yokla ve ilk uygun ogeyi tikla
  const subMenuDeadline = Date.now() + 4_000;
  while (Date.now() < subMenuDeadline) {
    const sizeItem = await locatorFor(page, "downloadVideoItem", { selfHeal: false, timeoutMs: 700 });
    if (sizeItem) {
      await sizeItem.click().catch(() => {});
      break;
    }
    await page.waitForTimeout(700);
  }

  const download = await downloadPromise;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const finalPath = nextAvailablePath(targetPath);
  await download.saveAs(finalPath);

  const failure = await download.failure();
  if (failure) throw new Error(`Gorsel indirme basarisiz: ${failure}`);

  await extractImageIfArchive(finalPath, project.id);
  await recordEvent({ projectId: project.id, step: "download", message: `Gorsel indirildi: ${path.basename(finalPath)}` });
  return finalPath;
}

/** Indirilen gorsel ZIP arsivindeyse icindeki en buyuk gorseli cikarir. */
async function extractImageIfArchive(filePath: string, projectId: string): Promise<void> {
  const header = Buffer.alloc(4);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  const isZip = header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;
  if (!isZip) return;

  const zip = new AdmZip(filePath);
  const imageEntries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && /\.(png|jpe?g|webp)$/i.test(entry.entryName))
    .sort((a, b) => b.header.size - a.header.size);

  if (imageEntries.length === 0) {
    const names = zip
      .getEntries()
      .map((entry) => entry.entryName)
      .slice(0, 10)
      .join(", ");
    throw new Error(`Indirilen ZIP icinde gorsel dosyasi yok (icerik: ${names})`);
  }

  const chosen = imageEntries[0];
  const data = chosen.getData();
  const tempPath = `${filePath}.extract`;
  fs.writeFileSync(tempPath, data);
  fs.rmSync(filePath);
  fs.renameSync(tempPath, filePath);
  await recordEvent({
    projectId,
    step: "download",
    message: `ZIP arsivi acildi; gorsel cikarildi: ${chosen.entryName} (${(data.length / 1024).toFixed(0)} KB)`,
  });
}

/* -------------------------------------------------------------------------
 * KARAKTERLER SAYFASI (.../project/<id>/characters)
 *
 * Flow, proje icinde karakterlere ozel bir sayfa sunar: karakter burada
 * TARIFTEN olusturulur (Nano Banana), adiyla kaydedilir ve kliplerde
 * @adiyla cagirilabilir. Karakter referansi icin dogru yer burasidir;
 * genel medya prompt cubugu video uretir.
 * ------------------------------------------------------------------------- */

/** Acik projenin Karakterler sayfasina gider. */
export async function openCharactersPage(page: Page, project: Project, options?: { forceReload?: boolean }): Promise<boolean> {
  const url = page.url();
  const match = url.match(/^(.*\/project\/[0-9a-f][0-9a-f-]{7,})/i);
  if (match) {
    const target = `${match[1]}/characters`;
    if (options?.forceReload || !url.startsWith(target)) {
      await page.goto(target, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(1_800);
    }
    if (page.url().includes("/characters")) {
      const snapshot = await captureDebugSnapshot(page, project.slug, "characters-page");
      await recordEvent({
        projectId: project.id,
        step: "flow",
        message: "Karakterler sayfasi acildi",
        screenshotPath: snapshot.screenshotPath,
        pageUrl: page.url(),
      });
      return true;
    }
  }

  // Yedek: sol menude "Karakterler" sekmesi/baglantisi
  const navCandidates = [
    page.getByRole("link", { name: /karakterler|characters/i }).first(),
    page.getByRole("tab", { name: /karakterler|characters/i }).first(),
    page.getByRole("button", { name: /karakterler|characters/i }).first(),
  ];
  for (const nav of navCandidates) {
    if (await nav.isVisible({ timeout: 1_200 }).catch(() => false)) {
      await nav.click().catch(() => {});
      await page.waitForTimeout(1_800);
      if (page.url().includes("/characters")) {
        await recordEvent({ projectId: project.id, step: "flow", message: "Karakterler sayfasi acildi (menu uzerinden)" });
        return true;
      }
    }
  }

  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message:
      "Karakterler sayfasina gecilemedi: proje adresi cozumlenemedi ve menude 'Karakterler' baglantisi bulunamadi. Once Flow'da projeyi acin.",
  });
  return false;
}

/** Karakterler sayfasindan proje editorune geri doner. */
export async function returnToProjectEditor(page: Page, project: Project): Promise<void> {
  const url = page.url();
  if (!url.includes("/characters")) return;
  const target = url.replace(/\/characters.*$/, "");
  await page.goto(target, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1_200);
  await recordEvent({ projectId: project.id, step: "flow", message: "Proje editorune geri donuldu" });
}

type PageImageEntry = { src: string; area: number; nw: number; nh: number };

function collectPageImageEntriesScript(): PageImageEntry[] {
  const out: PageImageEntry[] = [];
  const seenSrc = new Set<string>();
  const push = (src: string, area: number, nw: number, nh: number) => {
    if (!src || /^data:image\/svg/i.test(src) || seenSrc.has(src)) return;
    seenSrc.add(src);
    out.push({ src, area, nw, nh });
  };
  const visit = (root: Document | ShadowRoot) => {
    for (const img of Array.from(root.querySelectorAll("img"))) {
      const el = img as HTMLImageElement;
      const rect = el.getBoundingClientRect();
      push(el.currentSrc || el.src, rect.width * rect.height, el.naturalWidth || 0, el.naturalHeight || 0);
    }
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const bg = getComputedStyle(el).backgroundImage;
      const match = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (match?.[1]) {
        const rect = el.getBoundingClientRect();
        push(match[1], rect.width * rect.height, 0, 0);
      }
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  return out;
}

function cheapBufferHash(buf: Buffer): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(buf.length / 512));
  for (let i = 0; i < buf.length; i += step) h = Math.imul(h ^ buf[i], 16777619);
  return `${buf.length}:${h >>> 0}`;
}

/** Flow sonuc sayfasi: /edit/<uuid> — yuklenen referans da ayni yolu acabilir. */
function flowEditAssetId(url: string): string {
  const m = url.match(/\/edit\/([0-9a-f][0-9a-f-]{7,})/i);
  return m ? m[1].toLowerCase() : "";
}

async function collectAllFrameImages(page: Page): Promise<PageImageEntry[]> {
  const chunks = await Promise.all(
    page.frames().map((frame) => frame.evaluate(collectPageImageEntriesScript).catch(() => [] as PageImageEntry[]))
  );
  return chunks.flat();
}

type MediaSignature = { sig: string; area: number; src: string; w: number; h: number; mark: string };

function sampleAllMediaSignaturesScript(): MediaSignature[] {
  const out: MediaSignature[] = [];
  document.querySelectorAll("[data-flow-media]").forEach((el) => el.removeAttribute("data-flow-media"));
  const consider = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 48 || r.height < 48) return;
    const area = r.width * r.height;
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 12;
    const ctx = canvas.getContext("2d");
    const src =
      el instanceof HTMLImageElement || el instanceof HTMLVideoElement
        ? el.currentSrc || el.src || ""
        : "canvas";
    if (!ctx) return;
    try {
      ctx.drawImage(el as CanvasImageSource, 0, 0, 12, 12);
    } catch {
      return;
    }
    const data = ctx.getImageData(0, 0, 12, 12).data;
    let sig = "";
    for (let i = 0; i < data.length; i += 4) sig += `${data[i] >> 5}${data[i + 1] >> 5}${data[i + 2] >> 5}`;
    const mark = String(out.length);
    el.setAttribute("data-flow-media", mark);
    out.push({ sig, area, src, w: r.width, h: r.height, mark });
  };
  const visit = (root: Document | ShadowRoot) => {
    for (const sel of ["img", "canvas", "video"]) {
      for (const el of Array.from(root.querySelectorAll(sel))) consider(el);
    }
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  return out.sort((a, b) => b.area - a.area);
}

function isLandscapeStillCandidate(m: MediaSignature, opts?: { loose?: boolean }): boolean {
  const minArea = opts?.loose ? 18_000 : 80_000;
  const minH = opts?.loose ? 70 : 200;
  if (m.area < minArea || m.h < minH) return false;
  const ratio = m.w / m.h;
  return ratio >= 1.2 && ratio <= 2.4;
}

/**
 * On+arka turnaround / gri stüdyo katalog karesi.
 * Flow sayfasi CSP data: URL'lerini kestigi icin piksel ornegi Node'da (PNG) yapilir.
 */
export async function imageLooksLikeCharacterSheet(_page: Page, shot: Buffer): Promise<boolean> {
  return bufferLooksLikeCharacterSheet(shot);
}

function signatureDistance(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a || !b) return 100;
  const n = Math.min(a.length, b.length);
  if (n < 20) return 100;
  let d = 0;
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) d += 1;
  return (d / n) * 100;
}

async function sampleAllMediaSignatures(page: Page): Promise<MediaSignature[]> {
  const chunks = await Promise.all(
    page.frames().map((frame) => frame.evaluate(sampleAllMediaSignaturesScript).catch(() => [] as MediaSignature[]))
  );
  return chunks.flat().filter((m) => m.sig).sort((a, b) => b.area - a.area);
}

async function sampleLargestMediaSignature(page: Page): Promise<MediaSignature | null> {
  const all = await sampleAllMediaSignatures(page);
  return all[0] || null;
}

async function largestVisibleImage(page: Page): Promise<{ locator: Locator; src: string; area: number } | null> {
  let best: { locator: Locator; src: string; area: number } | null = null;
  for (const frame of page.frames()) {
    for (const sel of ["img", "canvas", "video"] as const) {
      const loc = frame.locator(sel);
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n; i += 1) {
        const node = loc.nth(i);
        const box = await node.boundingBox().catch(() => null);
        if (!box || box.width < 48 || box.height < 48) continue;
        const area = box.width * box.height;
        if (best && area <= best.area) continue;
        const src =
          (await node
            .evaluate((el, kind) => {
              if (kind === "img" || kind === "video") {
                const media = el as HTMLImageElement | HTMLVideoElement;
                return media.currentSrc || media.src || kind;
              }
              return "canvas";
            }, sel)
            .catch(() => sel)) || sel;
        best = { locator: node, src, area };
      }
    }
  }
  return best;
}

/** Sayfadaki tum gorsel adreslerinin anlik fotografini alir (oncesi/sonrasi kiyasi icin). */
export async function snapshotImageSources(page: Page): Promise<Set<string>> {
  const entries = await collectAllFrameImages(page);
  return new Set(entries.map((e) => e.src).filter(Boolean));
}

async function markImageForCapture(page: Page, src: string): Promise<Locator> {
  await page.evaluate((target) => {
    document.querySelectorAll("[data-flow-capture]").forEach((el) => el.removeAttribute("data-flow-capture"));
    const mark = (root: Document | ShadowRoot): boolean => {
      for (const img of Array.from(root.querySelectorAll("img"))) {
        const el = img as HTMLImageElement;
        if ((el.currentSrc || el.src) === target) {
          el.setAttribute("data-flow-capture", "1");
          return true;
        }
      }
      for (const el of Array.from(root.querySelectorAll("*"))) {
        if (el.shadowRoot && mark(el.shadowRoot)) return true;
      }
      return false;
    };
    mark(document);
  }, src);
  return page.locator("img[data-flow-capture='1']").first();
}

/**
 * Karakterler sayfasinda yeni karakter olusturmayi baslatir:
 * yeni karakter dugmesi -> tarif kutusu -> (varsa ad alani) -> olustur.
 */
export async function createFlowCharacter(page: Page, project: Project, name: string, description: string): Promise<boolean> {
  const safeDescription = clampPromptForFlowBox(description);
  if (description.trim().length > safeDescription.length) {
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: `Karakter tarifi Flow limiti icin kisaltildi (${description.trim().length} → ${safeDescription.length} karakter)`,
    });
  }

  const newButton =
    (await locatorFor(page, "characterNewButton", { timeoutMs: 2_000 })) ??
    (await (async () => {
      const extras = [
        page.getByRole("button", { name: /person_add|add_2|yeni karakter|new character|create character|karakter olu[sş]tur|karakter ekle|add character/i }).first(),
        page.locator("button").filter({ hasText: /person_add|add_2/ }).first(),
        page.getByRole("link", { name: /yeni karakter|new character|create character/i }).first(),
        page.getByRole("button", { name: /^\s*\+\s*$/ }).first(),
      ];
      for (const loc of extras) {
        if (await loc.isVisible({ timeout: 700 }).catch(() => false)) return loc;
      }
      return null;
    })());
  if (!newButton) {
    const snapshot = await captureDebugSnapshot(page, project.slug, "characters-no-new-button");
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Karakterler sayfasinda 'Yeni karakter' dugmesi bulunamadi. Kalibrasyon ekranindan 'Yeni karakter dugmesi'ni tanitin.",
      screenshotPath: snapshot.screenshotPath,
      pageUrl: page.url(),
    });
    return false;
  }
  await newButton.click();
  await page.waitForTimeout(1_200);
  {
    // Olusturma arayuzunun gercek halini kayda al (secici ayari icin gorsel kanit)
    const snapshot = await captureDebugSnapshot(page, project.slug, "characters-create-ui");
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: "Yeni karakter arayuzu acildi",
      screenshotPath: snapshot.screenshotPath,
      pageUrl: page.url(),
    });
  }

  // Olusturma penceresi acildiysa aramayi pencere iciyle sinirla
  const dialog = page.locator("[role='dialog'], [aria-modal='true']").first();
  const dialogOpen = await dialog.isVisible({ timeout: 1_500 }).catch(() => false);
  const scope = dialogOpen ? dialog : page;

  // Tarif kutusu: once kapsam ici textarea/contenteditable, sonra kalibrasyon zinciri
  let input: Locator | null = scope.locator("textarea, [contenteditable='true']").first();
  if (!(await input.isVisible({ timeout: 1_500 }).catch(() => false))) {
    input = await locatorFor(page, "characterDescriptionInput", { timeoutMs: 1_500 });
  }
  if (!input) {
    const snapshot = await captureDebugSnapshot(page, project.slug, "characters-no-input");
    await page.keyboard.press("Escape").catch(() => {});
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Karakter tarif kutusu bulunamadi. Kalibrasyon ekranindan 'Karakter tarif kutusu'nu tanitin.",
      screenshotPath: snapshot.screenshotPath,
      pageUrl: page.url(),
    });
    return false;
  }

  // Ad alani (varsa): karakteri @adiyla cagirabilmek icin doldur
  const nameInput = scope.locator("input[type='text']").first();
  if (name && (await nameInput.isVisible({ timeout: 800 }).catch(() => false))) {
    await nameInput.click().catch(() => {});
    await nameInput.fill(name).catch(() => {});
  }

  // Model secici: proje ayarindaki gorsel modeli (SQL — Prisma alani bos olabilir).
  const wantedImageModel = await readProjectFlowImageModel(project.id);
  const modelTrigger = scope.getByText(/nano ?banana/i).first();
  if (await modelTrigger.isVisible({ timeout: 1_000 }).catch(() => false)) {
    const currentLabel = ((await modelTrigger.textContent().catch(() => "")) ?? "").trim();
    if (!isPreferredImageModel(currentLabel, wantedImageModel)) {
      await modelTrigger.click().catch(() => {});
      await page.waitForTimeout(500);
      if (await clickWantedImageModelOption(page, wantedImageModel)) {
        await page.waitForTimeout(400);
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: `Karakter modeli ${wantedImageModel} olarak secildi`,
        });
      } else {
        await page.keyboard.press("Escape").catch(() => {});
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "warning",
          message: `Karakter model listesinde ${wantedImageModel} bulunamadi`,
        });
      }
    }
  }

  await input.click();
  const filled = await input
    .fill(safeDescription)
    .then(() => true)
    .catch(() => false);
  if (!filled) {
    // contenteditable alanlarda fill calismayabilir; klavyeyle yaz
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await page.keyboard.press("Delete").catch(() => {});
    await page.keyboard.insertText(safeDescription).catch(async () => {
      await page.keyboard.type(safeDescription, { delay: 1 }).catch(() => {});
    });
  }
  await page.waitForTimeout(400);

  // Olustur dugmesi: once kapsam icinde, sonra kalibrasyon zinciri
  let submit: Locator | null = scope
    .getByRole("button", { name: /olu[sş]tur|generate|create|[uü]ret/i })
    .last();
  if (!(await submit.isVisible({ timeout: 1_200 }).catch(() => false))) {
    submit = await locatorFor(page, "characterGenerateButton", { timeoutMs: 1_500 });
  }
  if (!submit) {
    // Son care: Enter gonderimi
    await page.keyboard.press("Enter").catch(() => {});
    await recordEvent({
      projectId: project.id,
      step: "flow",
      level: "warning",
      message: "Karakter olustur dugmesi bulunamadi; Enter ile gonderim denendi. Gerekirse 'Karakter olustur dugmesi'ni kalibre edin.",
    });
    return true;
  }
  await submit.click();
  await recordEvent({ projectId: project.id, step: "flow", message: `Karakter olusturma baslatildi: ${name || "adsiz"}` });
  return true;
}

/**
 * Karakterler sayfasinda YENI bir karakter gorselinin belirmesini bekler.
 * Baslangictaki gorsel adresleriyle kiyaslar; yeni ve yeterince buyuk
 * (ikon olmayan) ilk gorseli dondurur.
 */
export async function waitForNewCharacterImage(
  page: Page,
  project: Project,
  before: Set<string>
): Promise<{ locator: Locator; src: string } | null> {
  const settings = await getSettings();
  const deadline = Date.now() + settings.generationTimeoutMs;
  const staleErrorCount = await countSelectorMatches(page, "errorBanner");

  while (Date.now() < deadline) {
    const currentErrorCount = await countSelectorMatches(page, "errorBanner");
    if (currentErrorCount > staleErrorCount) {
      const banner = await locatorFor(page, "errorBanner", { selfHeal: false, timeoutMs: 700 });
      const errorText = banner ? ((await banner.textContent().catch(() => "")) ?? "") : "";
      const snapshot = await captureDebugSnapshot(page, project.slug, "character-generation-failed");
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "error",
        message: `Karakter uretimi Flow tarafinda basarisiz: ${errorText.slice(0, 160) || "hata karti belirdi"}`,
        screenshotPath: snapshot.screenshotPath,
        pageUrl: page.url(),
      });
      throw new Error(`Flow karakter uretim hatasi: ${errorText.slice(0, 200) || "hata karti belirdi"}`);
    }

    const entries = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("img")).map((img, index) => {
          const el = img as HTMLImageElement;
          const rect = el.getBoundingClientRect();
          return { index, src: el.currentSrc || el.src, area: rect.width * rect.height };
        })
      )
      .catch(() => [] as Array<{ index: number; src: string; area: number }>);

    const fresh = entries
      .filter((e) => e.src && !before.has(e.src) && e.area > 8_000)
      .sort((a, b) => b.area - a.area);

    if (fresh.length > 0) {
      const chosen = fresh[0];
      await recordEvent({ projectId: project.id, step: "flow", message: "Yeni karakter gorseli algilandi" });
      return { locator: page.locator("img").nth(chosen.index), src: chosen.src };
    }
    await page.waitForTimeout(settings.pollIntervalMs);
  }

  const snapshot = await captureDebugSnapshot(page, project.slug, "character-page-timeout");
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Karakterler sayfasinda yeni gorsel algilanamadi (${Math.round(settings.generationTimeoutMs / 1000)} sn)`,
    screenshotPath: snapshot.screenshotPath,
    pageUrl: page.url(),
  });
  return null;
}

/**
 * Bir gorsel ogesini diske kaydeder: adres http(s) ise oturum cerezleriyle
 * indirir; olmazsa ogenin ekran goruntusunu alir.
 */
/**
 * Prompt cubugunda uretilen YENI gorseli bekler.
 *
 * Varlik menusu / indirme akisi gorsel modunda kirilgan oldugu icin (menu
 * seciciler video kartina kalibre olabiliyor) karakter sayfasindaki kanitlanmis
 * yontem kullanilir: uretim oncesi img adresleri fotograflanir, sonra listede
 * BELIREN yeni ve buyuk gorsel yakalanir.
 *
 * @param opts.onPoll her turda cagrilir; firlatirsa bekleme aninda kesilir
 *                    (uzun form iptali 7 dakika beklemesin diye).
 */
export async function waitForNewComposerImage(
  page: Page,
  project: Project,
  before: Set<string>,
  opts?: {
    timeoutMs?: number;
    onPoll?: () => void;
    skipSrcs?: Iterable<string>;
    rejectBuffer?: (buffer: Buffer) => boolean;
    /** "sheet": karakter on+arka paneli BEKLENIYOR — slayt/katalog reddi kapanir. */
    expect?: "still" | "sheet";
  }
): Promise<{ locator: Locator; src: string }> {
  const settings = await getSettings();
  const timeoutMs = Math.max(20_000, Math.min(opts?.timeoutMs ?? 360_000, settings.generationTimeoutMs));
  // Bu fonksiyon hikaye slaytlari icin yazildi: "karakter sheet" gorunce kareyi
  // reddeder ve sahneye cevirmeye calisir. Karakter uretiminde ISTENEN sey tam
  // olarak o sheet oldugu icin sheet modunda bu iki heuristik kapatilir.
  const wantsSheet = opts?.expect === "sheet";
  const looksLikeExpectedShape = (buf: Buffer): boolean => {
    if (!wantsSheet) return bufferLooksLikeStorySlide(buf);
    const dims = readImageDimensions(buf);
    return Boolean(dims && dims.w >= 900 && dims.h >= 500);
  };
  const isRejectedSheet = async (buf: Buffer): Promise<boolean> =>
    !wantsSheet && (await imageLooksLikeCharacterSheet(page, buf));
  const pollMs = Math.max(700, Math.min(settings.pollIntervalMs, 2_000));
  let deadline = Date.now() + timeoutMs;
  let staleErrorCount = await countSelectorMatches(page, "errorBanner");
  const inPagePolicyRetry = { used: false };
  const staleAssetCount = await countSelectorMatches(page, "assetMenuButton");
  let lastBeat = Date.now();
  const waitStartedAt = Date.now();
  let leaveEditAfter = waitStartedAt + 45_000;
  const startEditId = flowEditAssetId(page.url());
  const baselineView = await page.screenshot({ timeout: 5_000 }).catch(() => null);
  const baselineViewHash = baselineView && baselineView.length > 0 ? cheapBufferHash(baselineView) : "";
  const baselineMedia = await sampleLargestMediaSignature(page);
  let baselineSig = baselineMedia?.sig || "";
  const baselineLargest = await largestVisibleImage(page);
  const baselineLargestShot = baselineLargest
    ? await baselineLargest.locator.screenshot({ timeout: 4_000 }).catch(() => null)
    : null;
  let baselineShotHash =
    baselineLargestShot && baselineLargestShot.length > 8_000 ? cheapBufferHash(baselineLargestShot) : "";
  let baselineShotBytes = baselineLargestShot?.length || 0;
  await recordEvent({
    projectId: project.id,
    step: "flow",
    message: `Gorsel onizleme tabani: ${baselineSig ? `imza ${baselineSig.length} karakter` : "imza yok (CORS/canvas)"}`,
  });
  const SIG_CHANGED = 18;
  const minCaptureAt = waitStartedAt + 28_000;
  let sawGenerateBusy = false;
  let lastPreviewCheck = 0;
  let stableSig = "";
  let stableHits = 0;
  let loggedEdit = false;
  let retargetedBaseline = false;
  let leftSheetEdit = false;
  let leftSheetAt = 0;
  let openedNewAsset = false;
  let sceneRewriteTried = false;
  let loggedEmptyPool = false;
  let copyRejects = 0;
  let editCopyRejects = 0;
  const skipSrcs = new Set<string>(opts?.skipSrcs);
  const skipHashes = new Set<string>();

  const acceptPreview = async (reason: string): Promise<{ locator: Locator; src: string } | null> => {
    const now = await largestVisibleImage(page);
    if (!now || now.area < 80_000) return null;
    await recordEvent({
      projectId: project.id,
      step: "flow",
      message: `Yeni gorsel algilandi (${reason}, ${Math.round(now.area)} px²)`,
    });
    return { locator: now.locator, src: now.src };
  };

  while (Date.now() < deadline) {
    opts?.onPoll?.();

    const currentErrorCount = await countSelectorMatches(page, "errorBanner");
    if (currentErrorCount > staleErrorCount) {
      const banner = await locatorFor(page, "errorBanner", { selfHeal: false, timeoutMs: 700 });
      const errorText = ((banner ? await banner.textContent().catch(() => "") : "") ?? "").trim();
      if (!inPagePolicyRetry.used && POLICY_BLOCK_TEXT.test(errorText) && !isCelebrityPolicyText(errorText) && (await clickFlowRetryIfVisible(page, project.id))) {
        inPagePolicyRetry.used = true;
        staleErrorCount = await countSelectorMatches(page, "errorBanner");
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "warning",
          message: `Politika reddi — Flow Yeniden dene tiklandi, ayni istemle bekleniyor. ${errorText.slice(0, 80)}`,
        });
        continue;
      }
      const snapshot = await captureDebugSnapshot(page, project.slug, "flow-image-error");
      await recordEvent({
        projectId: project.id,
        step: "flow",
        level: "error",
        message: `Gorsel uretiminde hata karti: ${errorText.slice(0, 160) || "hata karti belirdi"}`,
        screenshotPath: snapshot.screenshotPath,
        pageUrl: page.url(),
      });
      if (sceneRewriteTried) {
        staleErrorCount = currentErrorCount;
        leaveEditAfter = Date.now();
        await page.keyboard.press("Escape").catch(() => {});
        await recordEvent({
          projectId: project.id,
          step: "flow",
          level: "warning",
          message: `Sahne restage hata karti yutuldü (${(errorText || "Başarısız").slice(0, 80)}) — kutuphane aranacak`,
        });
        continue;
      }
      throw generationFailureError(errorText || "hata karti belirdi");
    }

    const overlayEdit = await page
      .getByText(/neyi de[gğ]i[sş]tirmek istiyorsun|what (do you want|would you like) to change/i)
      .first()
      .isVisible({ timeout: 250 })
      .catch(() => false);
    const inEdit = Boolean(flowEditAssetId(page.url())) || overlayEdit;
    if (inEdit && !loggedEdit) {
      loggedEdit = true;
      const editId = flowEditAssetId(page.url());
      await recordEvent({
        projectId: project.id,
        step: "flow",
        message: `Duzenleme gorunumu acildi (${editId ? editId.slice(0, 8) : "katman"}) — piksel degisimi bekleniyor`,
      });
      if (!retargetedBaseline && Date.now() - waitStartedAt < 8_000) {
        const again = await sampleLargestMediaSignature(page);
        if (again?.sig) {
          baselineSig = again.sig;
          retargetedBaseline = true;
          stableSig = "";
          stableHits = 0;
          const largest = await largestVisibleImage(page);
          const shot = largest ? await largest.locator.screenshot({ timeout: 4_000 }).catch(() => null) : null;
          baselineShotHash = shot && shot.length > 8_000 ? cheapBufferHash(shot) : "";
          baselineShotBytes = shot?.length || 0;
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: "Erken duzenleme ekrani — onizleme tabani referans karesine yenilendi",
          });
        }
      }
    }

    const entries = await collectAllFrameImages(page);
    const fresh = entries
      .filter((e) => e.src && !before.has(e.src) && (e.area > 800 || e.nw * e.nh > 4_000))
      .sort((a, b) => b.area - a.area || b.nw * b.nh - a.nw * a.nh);
    const assetCount = await countSelectorMatches(page, "assetMenuButton");
    const chosen =
      fresh[0] ||
      (assetCount > staleAssetCount
        ? entries
            .filter((e) => e.area > 8_000 || e.nw * e.nh > 20_000)
            .sort((a, b) => b.area - a.area || b.nw * b.nh - a.nw * a.nh)[0]
        : undefined);

    const genBtn = await resolveGenerateButton(page);
    const busy = genBtn ? await genBtn.isDisabled({ timeout: 400 }).catch(() => false) : false;
    if (busy) sawGenerateBusy = true;

    if (
      !sceneRewriteTried &&
      (inEdit || /\/edit\//i.test(page.url())) &&
      Date.now() - waitStartedAt >= 8_000
    ) {
      const largest = await largestVisibleImage(page);
      const shot = largest
        ? await largest.locator.screenshot({ timeout: 4_000 }).catch(() => null)
        : null;
      if (shot && (await isRejectedSheet(shot))) {
        sceneRewriteTried = true;
        const ok = await restageCatalogAsScene(page, project);
        if (ok) {
          deadline = Math.max(deadline, Date.now() + 150_000);
          leaveEditAfter = Date.now() + 100_000;
          openedNewAsset = false;
          skipSrcs.clear();
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: "Sahne restage basladi — ikinci Nano Banana bekleniyor",
          });
        } else {
          await recordEvent({
            projectId: project.id,
            step: "flow",
            level: "warning",
            message: "Sahne restage Generate tetiklenemedi — duzenleme kutusu/Generate yok",
          });
        }
      }
    }

    // startGeneration Nano Banana bitince /edit/'te birakir; taban sonucun kendisi
    // olur. Sahne onizlemesini (before'da olsa bile) URL'den al — kutuphane
    // parmaklari onceki slaytin kopyasi olabiliyor.
    // Generate duzenleme ekraninda pasif kalabiliyor; uretim startGeneration'da bitti.
    if (inEdit && Date.now() - waitStartedAt >= 3_000) {
      const tryEditProbe = async (
        locator: Locator,
        src: string,
        reason: string
      ): Promise<{ locator: Locator; src: string } | "skip" | null> => {
        if (!src || skipSrcs.has(src)) return "skip";
        const probe = await fetchGeneratedImage(page, locator, src).catch(() => null);
        if (!probe || probe.length < 80_000) return null;
        if (!looksLikeExpectedShape(probe)) {
          skipSrcs.add(src);
          const dims = readImageDimensions(probe);
          await recordEvent({
            projectId: project.id,
            step: "flow",
            level: "warning",
            message: `Duzenleme karesi slayt orani degil (${dims ? `${dims.w}×${dims.h}` : "?"}, ${reason}) — atlandi`,
          });
          return "skip";
        }
        if (opts?.rejectBuffer?.(probe)) {
          skipSrcs.add(src);
          editCopyRejects += 1;
          await recordEvent({
            projectId: project.id,
            step: "flow",
            level: "warning",
            message: `Duzenleme karesi onceki slaytin kopyasi (${probe.length} B, ${reason}) — atlandi`,
          });
          return "skip";
        }
        if (await isRejectedSheet(probe)) {
          skipSrcs.add(src);
          return "skip";
        }
        await recordEvent({
          projectId: project.id,
          step: "flow",
          message: `Yeni gorsel algilandi (${reason}, ${probe.length} B)`,
        });
        return { locator, src };
      };

      const editPool = fresh
        .filter((e) => {
          if (!e.src || skipSrcs.has(e.src)) return false;
          if (e.nw > 0 && e.nh > 0 && e.nw / e.nh < 1.5) return false;
          return true;
        })
        .sort((a, b) => b.nw * b.nh - a.nw * a.nh || b.area - a.area);
      for (const target of editPool.slice(0, 12)) {
        const marked = await markImageForCapture(page, target.src).catch(() => null);
        const markedOk = Boolean(marked && (await marked.isVisible({ timeout: 800 }).catch(() => false)));
        if (!markedOk) continue;
        const got = await tryEditProbe(marked!, target.src, "duzenleme onizleme");
        if (got && got !== "skip") return got;
      }
      const stage = await largestVisibleImage(page);
      if (stage && stage.area >= 500_000) {
        const got = await tryEditProbe(stage.locator, stage.src, "duzenleme sahne");
        if (got && got !== "skip") return got;
      }
    }

    const readyForCapture = Date.now() >= minCaptureAt;

    if (readyForCapture && Date.now() - lastPreviewCheck >= 2_000) {
      lastPreviewCheck = Date.now();
      const allMedia = await sampleAllMediaSignatures(page);
      const landscape = allMedia.filter((m) => isLandscapeStillCandidate(m, { loose: true }));
      let found: { loc: Locator; src: string; hash: string; area: number } | null = null;
      for (const m of landscape) {
        const loc = page.locator(`[data-flow-media="${m.mark}"]`).first();
        if (!(await loc.isVisible({ timeout: 400 }).catch(() => false))) continue;
        const cap = await loc.screenshot({ timeout: 5_000 }).catch(() => null);
        if (!cap || cap.length < 5_000) continue;
        const h = cheapBufferHash(cap);
        if (!h) continue;
        const genIdleInEdit = Boolean(inEdit && !busy);
        if (!genIdleInEdit && baselineShotHash && h === baselineShotHash) continue;
        if (skipHashes.has(h)) continue;
        // 717×400 kutuphane karesi ~286k px²; tam slayt 1376×768 / ~1.8e6.
        if (m.area < 500_000) continue;
        if (!looksLikeExpectedShape(cap)) continue;
        if (!openedNewAsset && fresh.length === 0) continue;
        if (await isRejectedSheet(cap)) continue;
        found = { loc, src: m.src || "marked-media", hash: h, area: m.area };
        break;
      }
      if (found) {
        if (found.hash === stableSig) stableHits += 1;
        else {
          stableSig = found.hash;
          stableHits = 1;
        }
        if (stableHits >= 2) {
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: `Yeni gorsel algilandi (onizleme duragan, ${Math.round(found.area)} px²)`,
          });
          return { locator: found.loc, src: "screenshot-only" };
        }
      } else {
        stableSig = "";
        stableHits = 0;
      }

      if (!leftSheetEdit && Date.now() >= leaveEditAfter && (inEdit || /\/edit\//i.test(page.url()))) {
        if (sceneRewriteTried && busy) {
          // ikinci Generate bitmeden Bitti'ye basma
        } else {
        leftSheetEdit = true;
        leftSheetAt = Date.now();
        const done = page.getByRole("button", { name: /bitti|done/i }).first();
        if (await done.isVisible({ timeout: 400 }).catch(() => false)) {
          await done.click().catch(() => {});
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: "Sheet duzenlemesi kapatildi — uretilen sahne composer'da araniyor",
          });
          await page.waitForTimeout(2_500);
        }
        const stillEdit =
          /\/edit\//i.test(page.url()) ||
          (await page
            .getByText(/neyi de[gğ]i[sş]tirmek istiyorsun|what (do you want|would you like) to change/i)
            .first()
            .isVisible({ timeout: 250 })
            .catch(() => false));
        if (stillEdit || /\/edit\//i.test(page.url())) {
          const match = page.url().match(/^(https?:\/\/[^?#]+\/project\/[0-9a-f][0-9a-f-]{7,})/i);
          const root = (project.flowProjectUrl || "").trim() || match?.[1] || "";
          if (root) {
            await page.goto(root, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
            await page.waitForTimeout(1_500);
            await recordEvent({
              projectId: project.id,
              step: "flow",
              message: "Duzenleme ekranindan proje kokune donuldu — kutuphane karesi aranacak",
            });
          }
        }
        }
      }

      if (!openedNewAsset && (leftSheetEdit || !/\/edit\//i.test(page.url()))) {
        const nowEntries = await collectAllFrameImages(page);
        const pool = nowEntries
          .filter((e) => {
            if (!e.src || skipSrcs.has(e.src) || before.has(e.src)) return false;
            const ratio = e.nh > 0 ? e.nw / e.nh : 0;
            const landscape = ratio >= 1.15 || (e.nw === 0 && e.area > 8_000);
            if (!landscape) return false;
            const cdn = /getMediaUrlRedirect|googleusercontent/i.test(e.src);
            // Kutuphane thumb'u 400×225 (90k px) olabiliyor; tiklayinca tam JPEG gelir.
            if (e.nw > 0 && e.nh > 0 && e.nw * e.nh < 150_000 && !cdn) return false;
            if (cdn) return true;
            if (e.nw * e.nh > 20_000) return true;
            if (e.area > 1_200) return true;
            return false;
          })
          .sort((a, b) => b.nw * b.nh - a.nw * a.nh || b.area - a.area);
        const remainingNew = nowEntries.filter(
          (e) => e.src && !before.has(e.src) && !skipSrcs.has(e.src)
        ).length;
        if (pool.length === 0 && !loggedEmptyPool) {
          loggedEmptyPool = true;
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: `Kutuphane adayi yok (img ${nowEntries.length}, yeni ${remainingNew})`,
          });
        }
        if (
          leftSheetEdit &&
          copyRejects >= 2 &&
          pool.length === 0 &&
          leftSheetAt > 0 &&
          Date.now() - leftSheetAt >= 8_000
        ) {
          throw new Error("Kutuphanede yeni kare yok (onceki slayt kopyalari atlandi)");
        }
        for (const target of pool.slice(0, 5)) {
          const marked = await markImageForCapture(page, target.src).catch(() => null);
          const markedOk = Boolean(marked && (await marked.isVisible({ timeout: 800 }).catch(() => false)));
          if (!markedOk) {
            continue;
          }
          await marked!.click({ timeout: 2_000, force: true }).catch(() => {});
          const isNew = !before.has(target.src);
          if (!isNew) {
            skipSrcs.add(target.src);
            continue;
          }
          await recordEvent({
            projectId: project.id,
            step: "flow",
            message: `Yeni varlik onizlemesi tiklandi (${target.nw}×${target.nh}, ${Math.round(target.area)} px², kutuphanede yeni)`,
          });
          await page.waitForTimeout(1_800);
          const after = await largestVisibleImage(page);
          const afterShot = after
            ? await after.locator.screenshot({ timeout: 5_000 }).catch(() => null)
            : null;
          if (afterShot && (await isRejectedSheet(afterShot))) {
            skipSrcs.add(target.src);
            const rejectedHash = cheapBufferHash(afterShot);
            if (rejectedHash) skipHashes.add(rejectedHash);
            try {
              const dump = path.join(safeProjectPath(project.slug), "longform", "stills", "_last-reject.png");
              fs.mkdirSync(path.dirname(dump), { recursive: true });
              fs.writeFileSync(dump, afterShot);
            } catch {
              /* debug dump optional */
            }
            await recordEvent({
              projectId: project.id,
              step: "flow",
              level: "warning",
              message: "Yeni varlik karakter sheet / turnaround — reddedildi, baska kare araniyor",
            });
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(400);
            continue;
          }
          const probeLoc = after?.locator ?? marked!;
          const probe = await fetchGeneratedImage(page, probeLoc, target.src).catch(() => null);
          if (probe && looksLikeExpectedShape(probe)) {
            if (opts?.rejectBuffer?.(probe)) {
              skipSrcs.add(target.src);
              copyRejects += 1;
              await recordEvent({
                projectId: project.id,
                step: "flow",
                level: "warning",
                message: "Kutuphane karesi onceki slaytin kopyasi — atlandi, baska kare araniyor",
              });
              await page.keyboard.press("Escape").catch(() => {});
              await page.waitForTimeout(400);
              continue;
            }
            if (await isRejectedSheet(probe)) {
              skipSrcs.add(target.src);
              continue;
            }
            await recordEvent({
              projectId: project.id,
              step: "flow",
              message: `Yeni gorsel algilandi (tiklama sonrasi, ${probe.length} B)`,
            });
            return { locator: probeLoc, src: target.src || "screenshot-only" };
          }
          if (probe) {
            skipSrcs.add(target.src);
            copyRejects += 1;
          }
          continue;
        }
      }
    }

    if (Date.now() - lastBeat >= 30_000) {
      lastBeat = Date.now();
      const remain = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      const allMedia = await sampleAllMediaSignatures(page);
      const maxDist = allMedia
        .filter((m) => isLandscapeStillCandidate(m))
        .reduce((m, x) => Math.max(m, signatureDistance(x.sig, baselineSig)), 0);
      const freshLeft = fresh.filter((e) => e.src && !skipSrcs.has(e.src)).length;
      await recordEvent({
        projectId: project.id,
        step: "flow",
        message: `Gorsel karesi bekleniyor · ${entries.length} img · varlik ${assetCount} · yeni ${freshLeft} · fark ${Math.round(maxDist)}% · kalan ${remain}s${inEdit ? " · duzenleme" : ""}`,
      });
    }
    await page.waitForTimeout(pollMs);
  }

  const snapshot = await captureDebugSnapshot(page, project.slug, "flow-image-timeout");
  await recordEvent({
    projectId: project.id,
    step: "flow",
    level: "warning",
    message: `Yeni gorsel algilanamadi (${Math.round(timeoutMs / 1000)} sn) — son care onizleme/ekran`,
    screenshotPath: snapshot.screenshotPath,
    pageUrl: page.url(),
  });

  const last = await largestVisibleImage(page);
  if (last && last.area >= 500_000) {
    const shot = await last.locator.screenshot({ timeout: 8_000 }).catch(() => null);
    const h = shot && shot.length > 8_000 ? cheapBufferHash(shot) : "";
    if (shot && h && h !== baselineShotHash && !(await isRejectedSheet(shot)) && looksLikeExpectedShape(shot)) {
      await recordEvent({
        projectId: project.id,
        step: "flow",
        message: `Zaman asiminde onizleme kaydedildi (${Math.round(last.area)} px²)`,
      });
      return { locator: last.locator, src: "screenshot-only" };
    }
  }

  throw new Error(`Flow gorsel uretimi zaman asimina ugradi (${Math.round(timeoutMs / 1000)} sn)`);
}

/**
 * Uretilen gorselin ham baytlari.
 *
 * Sira: kirpilmis boyut ekini atmis TAM BOY adres → adresin kendisi →
 * son care element ekran goruntusu. Google CDN adreslerinde "=s512" /
 * "=w400-h300" gibi ekler onizleme boyutunu zorlar; atilinca orijinal gelir.
 */
export async function fetchGeneratedImage(page: Page, locator: Locator, src: string): Promise<Buffer> {
  if (/^data:image\//i.test(src)) {
    const body = Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
    if (body.length > 5_000) return body;
  }

  if (/^https?:/i.test(src)) {
    const candidates = [src.replace(/=[swh]\d+(-[a-z0-9]+)*$/i, ""), src].filter(
      (url, index, list) => url && list.indexOf(url) === index
    );
    let best: Buffer | null = null;
    for (const url of candidates) {
      try {
        const response = await page.request.get(url);
        if (!response.ok()) continue;
        const body = await response.body();
        if (body.length > 5_000 && (!best || body.length > best.length)) best = body;
      } catch {
        // sonraki adaya gec
      }
    }
    if (best) return best;
  }

  return locator.screenshot({ timeout: 20_000 });
}

export async function saveImageFromElement(page: Page, locator: Locator, src: string, targetPath: string): Promise<string> {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const finalPath = nextAvailablePath(targetPath);

  if (/^https?:/i.test(src)) {
    try {
      const response = await page.request.get(src);
      if (response.ok()) {
        const body = await response.body();
        if (body.length > 5_000) {
          fs.writeFileSync(finalPath, body);
          return finalPath;
        }
      }
    } catch {
      // indirme olmazsa ekran goruntusune dus
    }
  }
  await locator.screenshot({ path: finalPath });
  return finalPath;
}

/**
 * Indirilen dosya ZIP ise (Flow, videolari arsiv olarak verir) icindeki
 * en buyuk video dosyasini cikarip ayni yola yazar.
 */
async function extractVideoIfArchive(filePath: string, projectId: string): Promise<void> {
  const header = Buffer.alloc(4);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, header, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  const isZip = header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;
  if (!isZip) return;

  const zip = new AdmZip(filePath);
  const videoEntries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && /\.(mp4|mov|webm|m4v)$/i.test(entry.entryName))
    .sort((a, b) => b.header.size - a.header.size);

  if (videoEntries.length === 0) {
    const names = zip
      .getEntries()
      .map((entry) => entry.entryName)
      .slice(0, 10)
      .join(", ");
    throw new Error(`Indirilen ZIP icinde video dosyasi yok (icerik: ${names})`);
  }

  const chosen = videoEntries[0];
  const data = chosen.getData();
  const tempPath = `${filePath}.extract`;
  fs.writeFileSync(tempPath, data);
  fs.rmSync(filePath);
  fs.renameSync(tempPath, filePath);
  await recordEvent({
    projectId,
    step: "download",
    message: `ZIP arsivi acildi; video cikarildi: ${chosen.entryName} (${(data.length / (1024 * 1024)).toFixed(1)} MB)`,
  });
}

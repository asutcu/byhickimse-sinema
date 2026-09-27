import { prisma } from "@/server/db";
import type { Page } from "playwright";
import { openFlowBrowser } from "@/server/automation/browser";
import { recordEvent } from "@/server/lib/logger";
import {
  brokenSelectorReasons,
  buildLocator,
  flowSelectorSchema,
  saveCandidates,
  type FlowSelectorConfig,
  type SelectorCandidate,
  type SelectorStrategy,
} from "@/server/automation/selectors";

/**
 * Gorsel kalibrasyon modu:
 * 1. Panelden "kalibre et" denir (anahtar secilir)
 * 2. Kullanici Flow uzerinde hedef elemana tiklar
 * 3. Element icin aday secici listesi cikartilir, oncelik sirasina gore en iyisi kaydedilir
 * Oncelik: role > label > placeholder > text > testid > css
 *
 * Kirilgan "nth-of-type" zincirleri yerine mumkun oldugunca kalici secici
 * uretilir (id, data-testid, aria-label, placeholder, benzersiz etiket/sinif).
 */

interface CandidateInfo {
  tag: string;
  id: string;
  testId: string;
  ariaLabel: string;
  role: string;
  accessibleName: string;
  placeholder: string;
  text: string;
  /** Kalici, dogrulanmis (sayfada tek eslesen) CSS secici; bulunamazsa kisa yol zinciri */
  cssPath: string;
  /** Metin kutusu / duzenlenebilir alan mi */
  editable: boolean;
}

interface CalibrationState {
  activeKey: string | null;
  resolve: ((info: CandidateInfo) => void) | null;
  bindingInstalled: WeakSet<object>;
}

const globalForCalibration = globalThis as unknown as { calibrationState?: CalibrationState };
const calState: CalibrationState = globalForCalibration.calibrationState ?? {
  activeKey: null,
  resolve: null,
  bindingInstalled: new WeakSet(),
};
if (!globalForCalibration.calibrationState) globalForCalibration.calibrationState = calState;

export interface CalibrationResult extends FlowSelectorConfig {
  /** Kaydedilen secicinin sayfada kac elemanla eslestigi (0 ise kalibrasyon basarisiz sayilmali) */
  matchCount: number;
  /** Tikladiginiz ogeye denk geldigi dogrulanan yedek aday sayisi */
  verifiedCount: number;
}

/** Kalibrasyon sirasinda tiklanan ogeyi isaretlemek icin kullanilan oznitelik. */
const MARKER_ATTRIBUTE = "data-flowcal";

/**
 * Bir adayin GERCEKTEN tiklanan ogeye denk gelip gelmedigini dogrular.
 * Yalnizca "bir seyle eslesti" yetmez; eslesen oge, isaretlenen oge olmali
 * (ya da onu iceren/icinde olan, ayni tiklama etkisini veren bir oge).
 */
async function candidateHitsMarkedElement(page: Page, candidate: SelectorCandidate, token: string): Promise<boolean> {
  try {
    const locator = buildLocator(page, candidate);
    if ((await locator.count()) === 0) return false;

    return await locator.evaluate(
      (element, { attribute, expected }) => {
        const marked = document.querySelector(`[${attribute}="${expected}"]`);
        if (!marked) return false;
        if (element === marked) return true;

        const area = (node: Element) => {
          const rect = node.getBoundingClientRect();
          return rect.width * rect.height;
        };
        const elementArea = area(element);
        const markedArea = area(marked);
        if (markedArea <= 0 || elementArea <= 0) return false;

        // Ust oge: ayni tiklama etkisini vermesi icin belirgin sekilde buyuk olmamali
        if (element.contains(marked)) return elementArea <= markedArea * 3;
        // Alt oge (or. dugmenin icindeki etiket): tiklamak yine dugmeyi tetikler
        if (marked.contains(element)) return elementArea >= markedArea * 0.3;
        return false;
      },
      { attribute: MARKER_ATTRIBUTE, expected: token }
    );
  } catch {
    return false;
  }
}

/**
 * Kalibrasyon baslatir: kullanicinin Flow'da tikladigi elemani yakalar,
 * en iyi seciciyi uretir, kaydeder ve dogrular. 120 sn icinde tiklama olmazsa zaman asimi.
 */
export async function calibrateSelector(key: string): Promise<CalibrationResult> {
  const record = await prisma.flowSelector.findUnique({ where: { key } });
  if (!record) throw new Error(`Bilinmeyen secici anahtari: ${key}`);

  const page = await openFlowBrowser();

  if (!calState.bindingInstalled.has(page)) {
    try {
      await page.exposeBinding("__flowCalibrationReport", async (_source, info: CandidateInfo) => {
        if (calState.resolve) {
          const resolve = calState.resolve;
          calState.resolve = null;
          resolve(info);
        }
      });
    } catch (err) {
      // Sunucu modulu yeniden yuklendiginde binding sayfada zaten kayitli olabilir.
      const message = err instanceof Error ? err.message : String(err);
      if (!/already registered|has been already registered/i.test(message)) throw err;
    }
    calState.bindingInstalled.add(page);
  }

  calState.activeKey = key;
  const markerToken = `cal-${Date.now().toString(36)}`;
  await recordEvent({ step: "calibration", message: `Kalibrasyon basladi: ${key}. Flow uzerinde hedef elemana tiklayin.` });

  // Sayfaya tek seferlik yakalama modu kur (gorsel vurgu + tiklama engelleme)
  await page.evaluate(({ markerAttribute, token }) => {
    const win = window as unknown as {
      __flowCalCleanup?: () => void;
      __flowCalibrationReport?: (info: unknown) => void;
    };
    win.__flowCalCleanup?.();

    const highlight = document.createElement("div");
    highlight.style.cssText =
      "position:fixed;pointer-events:none;border:3px solid #4f46e5;border-radius:6px;z-index:2147483647;transition:all 60ms;box-shadow:0 0 0 4000px rgba(15,18,32,0.12)";
    document.documentElement.appendChild(highlight);

    const banner = document.createElement("div");
    banner.textContent = "KALIBRASYON MODU: Hedef ogeye tiklayin (ESC iptal)";
    banner.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#4f46e5;color:#fff;font:600 14px system-ui;padding:10px 18px;border-radius:999px;z-index:2147483647;pointer-events:none;box-shadow:0 6px 20px rgba(79,70,229,0.4)";
    document.documentElement.appendChild(banner);

    const INTERACTIVE =
      "textarea, input:not([type='hidden']), [contenteditable='true'], button, a[href], [role='button'], [role='textbox'], [role='combobox'], [role='menuitem'], [role='switch'], [role='checkbox'], [role='tab'], [role='option'], [role='link']";

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    }

    /**
     * Tiklanan noktadan en anlamli etkilesimli ogeye cik/in.
     * Sayfa govdesi gibi cok genis alanlarda ic arama yapilmaz; boyle bir
     * tiklama gecersiz sayilir (kullanici dogrudan dugmeye tiklamalidir).
     */
    function resolveTarget(el: Element): Element | null {
      const tag = el.tagName.toLowerCase();
      if (tag === "html" || tag === "body") return null;

      const ancestor = el.closest(INTERACTIVE);
      if (ancestor) return ancestor;

      // Genis kapsayicilarda "icindeki ilk dugmeyi" secmek yanlis sonuc verir
      const rect = el.getBoundingClientRect();
      const viewportArea = window.innerWidth * window.innerHeight;
      const tooLarge = viewportArea > 0 && rect.width * rect.height > viewportArea * 0.4;
      if (!tooLarge) {
        const descendant = Array.from(el.querySelectorAll(INTERACTIVE)).find(isVisible);
        if (descendant) return descendant;
      }
      return tooLarge ? null : el;
    }

    function unique(selector: string): boolean {
      try {
        return document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    }

    function attrSelector(el: Element, attr: string): string | null {
      const value = el.getAttribute(attr);
      if (!value || value.length > 60) return null;
      const selector = `${el.tagName.toLowerCase()}[${attr}="${value.replace(/"/g, '\\"')}"]`;
      return unique(selector) ? selector : null;
    }

    function cssPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node.nodeType === 1 && parts.length < 8) {
        let selector = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift(`${selector}#${CSS.escape(node.id)}`);
          break;
        }
        const parent: Element | null = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
          if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(selector);
        node = parent;
      }
      return parts.join(" > ");
    }

    /** Mumkun oldugunca kalici, sayfada tek eslesen CSS secici uret. */
    function stableSelector(el: Element): string {
      const tag = el.tagName.toLowerCase();

      if (el.id && el.id.length < 40 && !/\d{4,}/.test(el.id)) {
        const byId = `#${CSS.escape(el.id)}`;
        if (unique(byId)) return byId;
      }
      for (const attr of ["data-testid", "data-test-id", "aria-label", "placeholder", "name", "title", "aria-labelledby"]) {
        const selector = attrSelector(el, attr);
        if (selector) return selector;
      }
      if (unique(tag)) return tag;
      if (el.getAttribute("contenteditable") === "true") {
        const withTag = `${tag}[contenteditable="true"]`;
        if (unique(withTag)) return withTag;
        if (unique('[contenteditable="true"]')) return '[contenteditable="true"]';
      }
      if (tag === "textarea" || tag === "input") {
        const type = el.getAttribute("type");
        if (type) {
          const withType = `${tag}[type="${type}"]`;
          if (unique(withType)) return withType;
        }
      }
      // Hashlenmemis gorunen siniflari dene (or. "prompt-input" evet, "css-1x2y3z" hayir)
      const classes = Array.from(el.classList).filter(
        (name) => name.length > 2 && name.length < 32 && !/\d{2,}/.test(name) && !/^(css|sc|jsx|emotion)-/.test(name)
      );
      for (const className of classes) {
        const selector = `${tag}.${CSS.escape(className)}`;
        if (unique(selector)) return selector;
      }
      const role = el.getAttribute("role");
      if (role) {
        const withRole = `${tag}[role="${role}"]`;
        if (unique(withRole)) return withRole;
      }
      return cssPath(el);
    }

    function implicitRole(el: Element): string {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && el.hasAttribute("href")) return "link";
      if (tag === "input") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (["button", "submit"].includes(type)) return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        return "textbox";
      }
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (el.getAttribute("contenteditable") === "true") return "textbox";
      return "";
    }

    /**
     * Gorunur etiketi toplar: aria-hidden ogeleri, ikon fontlari (Material
     * Symbols gibi) ve SVG'ler atlanir. Aksi halde "arrow_forwardOlustur"
     * gibi birlesik metinler olusur ve hicbir secici eslesmez.
     */
    function visibleLabel(el: Element): string {
      const parts: string[] = [];
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(node.nodeValue ?? "");
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const element = node as Element;
        if (element.getAttribute("aria-hidden") === "true") return;
        const tag = element.tagName.toLowerCase();
        if (tag === "svg" || tag === "img") return;
        const className = typeof element.className === "string" ? element.className.toLowerCase() : "";
        if (/material-symbols|material-icons|(^|[\s_-])icon([\s_-]|$)/.test(className)) return;
        for (const child of Array.from(element.childNodes)) walk(child);
      };
      walk(el);
      const raw = parts.join(" ").replace(/\s+/g, " ").trim();
      // Ikon ligature adlarini (snake_case) at: arrow_forward, crop_9_16, more_vert...
      return raw
        .split(" ")
        .filter((token) => !/^[a-z0-9]+(_[a-z0-9]+)+$/.test(token))
        .join(" ")
        .trim();
    }

    function accessibleName(el: Element): string {
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel.trim().slice(0, 80);
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const target = document.getElementById(labelledBy);
        if (target) return visibleLabel(target).slice(0, 80);
      }
      return visibleLabel(el).slice(0, 80);
    }

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      const target = resolveTarget(el);
      if (!target) {
        // Secilemez alan: cerceveyi gizle
        highlight.style.width = "0px";
        highlight.style.height = "0px";
        banner.textContent = "Bu alan secilemez — dogrudan dugmenin uzerine gelin";
        return;
      }
      banner.textContent = "KALIBRASYON MODU: Hedef ogeye tiklayin (ESC iptal)";
      const rect = target.getBoundingClientRect();
      highlight.style.left = rect.left - 3 + "px";
      highlight.style.top = rect.top - 3 + "px";
      highlight.style.width = rect.width + "px";
      highlight.style.height = rect.height + "px";
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      highlight.remove();
      banner.remove();
      delete win.__flowCalCleanup;
    };
    win.__flowCalCleanup = cleanup;

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      const target = resolveTarget(el);
      if (!target) return; // gecersiz alan: tiklamayi yut, kullanici tekrar denesin

      // Adaylarin dogrulanabilmesi icin secilen ogeyi isaretle
      document.querySelectorAll(`[${markerAttribute}]`).forEach((node) => node.removeAttribute(markerAttribute));
      target.setAttribute(markerAttribute, token);

      const info = {
        tag: target.tagName.toLowerCase(),
        id: target.id || "",
        testId: target.getAttribute("data-testid") || target.getAttribute("data-test-id") || "",
        ariaLabel: target.getAttribute("aria-label") || "",
        role: implicitRole(target),
        accessibleName: accessibleName(target),
        placeholder: target.getAttribute("placeholder") || target.getAttribute("data-placeholder") || "",
        text: (target.textContent || "").trim().slice(0, 80),
        cssPath: stableSelector(target),
        editable:
          target.tagName.toLowerCase() === "textarea" ||
          target.tagName.toLowerCase() === "input" ||
          target.getAttribute("contenteditable") === "true",
      };
      cleanup();
      win.__flowCalibrationReport?.(info);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanup();
        win.__flowCalibrationReport?.({
          tag: "__cancelled__",
          id: "",
          testId: "",
          ariaLabel: "",
          role: "",
          accessibleName: "",
          placeholder: "",
          text: "",
          cssPath: "",
          editable: false,
        });
      }
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }, { markerAttribute: MARKER_ATTRIBUTE, token: markerToken });

  const info = await new Promise<CandidateInfo>((resolve, reject) => {
    calState.resolve = resolve;
    setTimeout(() => {
      if (calState.resolve) {
        calState.resolve = null;
        reject(new Error("Kalibrasyon zaman asimi: 120 saniye icinde tiklama algilanmadi"));
      }
    }, 120_000);
  });

  calState.activeKey = null;
  if (info.tag === "__cancelled__") throw new Error("Kalibrasyon kullanici tarafindan iptal edildi (ESC)");

  /*
   * Oncelik sirasina gore aday listesi uretip HER BIRINI canli sayfada
   * dogruluyoruz. Dogrulama olcutu "bir seyle eslesti" degil, "tam olarak
   * tikladiginiz ogeye denk geldi" seklindedir. Dogrulanan TUM adaylar
   * yedek zinciri olarak kaydedilir; biri kirilirsa digeri devreye girer.
   */
  const candidates = buildSelectorCandidates(key, info, record.required);
  const verified: SelectorCandidate[] = [];
  const attempts: string[] = [];

  for (const candidate of candidates) {
    if (brokenSelectorReasons(candidate).length > 0) {
      attempts.push(`${candidate.strategy}=elendi`);
      continue;
    }
    const hits = await candidateHitsMarkedElement(page, candidate, markerToken);
    attempts.push(`${candidate.strategy}=${hits ? "dogrulandi" : "eslesmedi"}`);
    if (hits) verified.push({ strategy: candidate.strategy, value: candidate.value, roleName: candidate.roleName });
  }

  // Isaretlemeyi temizle (sayfada iz birakma)
  await page
    .evaluate((attribute) => {
      document.querySelectorAll(`[${attribute}]`).forEach((node) => node.removeAttribute(attribute));
    }, MARKER_ATTRIBUTE)
    .catch(() => {});

  if (verified.length === 0) {
    await recordEvent({
      step: "calibration",
      level: "warning",
      message: `Kalibrasyon dogrulanamadi: ${key} icin uretilen adaylarin hicbiri tiklanan ogeye denk gelmedi`,
      detail: { denenenAdaylar: attempts },
    });
    const fallback = candidates[0];
    return { ...fallback, matchCount: 0, verifiedCount: 0 };
  }

  await saveCandidates(key, verified);
  const [primary] = verified;
  const matchCount = await buildLocator(page, primary)
    .count()
    .catch(() => 0);

  await recordEvent({
    step: "calibration",
    message: `Secici kaydedildi: ${key} -> ${primary.strategy}${primary.roleName ? `(${primary.roleName})` : ""}: ${primary.value.slice(0, 60)} — ${verified.length} dogrulanmis aday (yedekli)`,
    detail: { denenenAdaylar: attempts },
  });
  return {
    key,
    strategy: primary.strategy,
    value: primary.value,
    roleName: primary.roleName,
    description: record.description,
    required: record.required,
    matchCount,
    verifiedCount: verified.length,
  };
}

/** Regex ozel karakterlerini kacir (metin eslesmeleri regex olarak kullanilir). */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Etiketten eslesme icin guvenli, ayirt edici bir parca secer. */
function labelToken(label: string): string {
  const clean = label.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= 40) return clean;
  // Uzun metinlerde en uzun anlamli kelimeyi kullan (regex kismi eslesme yapar)
  const words = clean.split(" ").filter((word) => word.length >= 3 && /[\p{L}]/u.test(word));
  return words.sort((a, b) => b.length - a.length)[0] ?? clean.slice(0, 40);
}

/**
 * Oncelik sirasina gore aday secici listesi uretir: role > label > placeholder
 * > text > testid > css. Cagiran taraf her adayi canli sayfada dogrulayip
 * gercekten eslesen ilkini kaydeder.
 */
export function buildSelectorCandidates(key: string, info: CandidateInfo, required: boolean): FlowSelectorConfig[] {
  const candidates: FlowSelectorConfig[] = [];
  const seen = new Set<string>();

  const push = (strategy: SelectorStrategy, value: string, roleName = "") => {
    if (!value) return;
    const signature = `${strategy}|${value}|${roleName}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    candidates.push(flowSelectorSchema.parse({ key, strategy, value, roleName, description: "", required }));
  };

  const isInputLike = info.editable || info.tag === "textarea" || info.tag === "input";
  const nameToken = labelToken(info.accessibleName);
  const textToken = labelToken(info.text);

  if (info.role && info.ariaLabel) push("role", info.role, escapeRegex(labelToken(info.ariaLabel)));
  if (info.ariaLabel) push("label", escapeRegex(labelToken(info.ariaLabel)));
  if (info.placeholder) push("placeholder", escapeRegex(labelToken(info.placeholder)));
  // Metin kutularinda icerikten turetilen ad kirilgandir; yalnizca dugme/link gibi ogelerde kullan
  if (info.role && !isInputLike && nameToken) push("role", info.role, escapeRegex(nameToken));
  if (!isInputLike && nameToken) push("text", escapeRegex(nameToken));
  if (!isInputLike && textToken) push("text", escapeRegex(textToken));
  if (info.testId) push("testid", info.testId);
  if (info.cssPath) push("css", info.cssPath);
  if (info.id) push("css", `#${info.id}`);
  if (candidates.length === 0) push("css", info.tag);

  return candidates;
}

/** Dogrulama yapmadan tercih edilen (ilk) adayi dondurur. */
export function pickBestSelector(key: string, info: CandidateInfo, required: boolean): FlowSelectorConfig {
  return buildSelectorCandidates(key, info, required)[0];
}

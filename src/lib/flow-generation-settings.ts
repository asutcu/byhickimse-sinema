/**
 * Flow uretim cubugu ozeti (or. "Video · 10scrop_9_16x1") ve model/sure
 * uyumu. Playwright yok — adapter ve testler ayni kurallari kullanir.
 */

export type FlowAspectRatio = "16:9" | "9:16";

export interface FlowSettingsChip {
  durationSec: number | null;
  aspect: FlowAspectRatio | null;
  outputs: number | null;
  looksLikeSettingsChip: boolean;
}

const VEO_NO_TEN = /veo\s*3\.1\s*-?\s*(fast|lite)/i;
const QUALITY_OR_OMNI = /omni|quality/i;

/** Modelin bildigimiz sure listesi (matris yoksa). Fast/Lite 10 sn destemez. */
export function defaultDurationsForFlowModel(model: string): number[] {
  if (QUALITY_OR_OMNI.test(model)) return [4, 6, 8, 10];
  if (VEO_NO_TEN.test(model) || /veo/i.test(model)) return [4, 6, 8];
  return [4, 6, 8];
}

/**
 * Flow'a gonderilecek klip suresi. Veo Fast/Lite + 10 sn (short'ta sik
 * kalan varsayilan) 8 sn'ye cekilir; aksi halde modelin listesine oturtulur.
 */
export function flowClipSeconds(flowModel: string, clipSeconds: number, supportedDurations?: number[]): number {
  const wanted = Math.round(Number(clipSeconds) || 8);
  const supported =
    supportedDurations && supportedDurations.length > 0
      ? supportedDurations
      : defaultDurationsForFlowModel(flowModel);
  if (supported.includes(wanted)) return wanted;
  if (supported.includes(8)) return 8;
  return supported[supported.length - 1] ?? 8;
}

/** Quality / Omni 10 sn kabul eder. Fast/Lite 8'e iner. 8 = eski varsayilan, 10'a cekilir. */
export function preferredNarratorClipSeconds(flowModel: string, currentClipSeconds?: number): number {
  const current = Math.round(Number(currentClipSeconds) || 0);
  const wanted = current > 0 && current !== 8 ? current : 10;
  return flowClipSeconds(flowModel, wanted);
}

/** Flow sure sekmesinin erisilebilir adi: "8s" / "8 s". */
export function flowDurationTabPattern(seconds: number): RegExp {
  // Eski arayuz "8s", flow.google.com "8 sn." (TR) / "8 sec." yaziyor.
  return new RegExp(`^${seconds}\\s*(s|sn|sec|secs|seconds?)\\.?$`, "i");
}

export function parseFlowSettingsChip(label: string): FlowSettingsChip {
  const text = (label || "").replace(/\s+/g, " ").trim();
  const duration = text.match(/(\d+)\s*s/i);
  const crop = text.match(/crop_(\d+)_(\d+)/i);
  const colon = text.match(/\b(16:9|9:16)\b/);
  const outputs = text.match(/x\s*([1-4])\b/i);

  let aspect: FlowAspectRatio | null = null;
  if (crop) {
    const ratio = `${crop[1]}:${crop[2]}`;
    if (ratio === "16:9" || ratio === "9:16") aspect = ratio;
  } else if (colon?.[1] === "16:9" || colon?.[1] === "9:16") {
    aspect = colon[1];
  }

  const looksLikeSettingsChip =
    /crop_(16_9|9_16)/i.test(text) ||
    (/\d+\s*s/i.test(text) && /video|g[oö]r[uü]nt[uü]|image|crop_/i.test(text));

  return {
    durationSec: duration ? Number(duration[1]) : null,
    aspect,
    outputs: outputs ? Number(outputs[1]) : null,
    looksLikeSettingsChip,
  };
}

export function chipNeedsRepair(
  chip: FlowSettingsChip,
  want: { durationSec: number; aspect: string; outputs?: number }
): { duration: boolean; aspect: boolean; outputs: boolean } {
  return {
    duration: chip.durationSec != null && chip.durationSec !== want.durationSec,
    aspect: chip.aspect != null && chip.aspect !== want.aspect,
    outputs: want.outputs != null && chip.outputs != null && chip.outputs !== want.outputs,
  };
}

/** Flow fotograf modelleri — karakter, klip karesi, kapak, slayt. */
export const FLOW_IMAGE_MODELS = ["Nano Banana 2", "Nano Banana Pro"] as const;
export const FLOW_IMAGE_MODEL_DEFAULT = FLOW_IMAGE_MODELS[0];
/** Geriye donuk alias: varsayilan gorsel modeli. */
export const FLOW_IMAGE_MODEL = FLOW_IMAGE_MODEL_DEFAULT;

export function resolveFlowImageModel(
  source?: string | { flowImageModel?: string | null; longformSettings?: string | null } | null
): string {
  if (!source) return FLOW_IMAGE_MODEL_DEFAULT;
  if (typeof source === "string") {
    const match = FLOW_IMAGE_MODELS.find((m) => m.toLowerCase() === source.trim().toLowerCase());
    return match ?? FLOW_IMAGE_MODEL_DEFAULT;
  }
  const fromField = (source.flowImageModel || "").trim();
  if (fromField) {
    const match = FLOW_IMAGE_MODELS.find((m) => m.toLowerCase() === fromField.toLowerCase());
    if (match) return match;
  }
  try {
    const parsed = JSON.parse(source.longformSettings || "{}") as { imageModel?: string };
    const fromLf = String(parsed.imageModel || "").trim();
    const match = FLOW_IMAGE_MODELS.find((m) => m.toLowerCase() === fromLf.toLowerCase());
    if (match) return match;
  } catch {
    /* eski kayit / bozuk json */
  }
  return FLOW_IMAGE_MODEL_DEFAULT;
}

export function isImageFlowModel(name: string): boolean {
  return /nano\s*banana|banana/i.test(name);
}

export function normalizeFlowModelName(value: string): string {
  return value
    .replace(/volume_up|arrow_drop_down|arrow_drop_up/gi, " ")
    .toLowerCase()
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pro ile 2 karismasin: "Nano Banana Pro" "Nano Banana 2" ile eslesmez. */
export function imageModelNamesMatch(uiText: string, target: string): boolean {
  const a = normalizeFlowModelName(uiText);
  const b = normalizeFlowModelName(target);
  if (!a || !b) return false;
  const aPro = /\bpro\b/.test(a);
  const bPro = /\bpro\b/.test(b);
  if (aPro !== bPro) return false;
  const aTwo = /\b2\b/.test(a);
  const bTwo = /\b2\b/.test(b);
  if (aTwo !== bTwo) return false;
  if (a.includes("banana") && b.includes("banana")) return true;
  return a === b || a.includes(b) || b.includes(a);
}

/** Flow'un "hatayi cozuyoruz / tekrar deneniyor" takili toast'i. */
export const FLOW_STUCK_RESOLVING_TEXT =
  /hatay[ıi].{0,48}ç[oö]z|ç[oö]z[uü]l[uü]yor|hatay[ıi] b[oö]yle|yeniden den[ie]n|tekrar den[ie]n|error.?resolv|trying (again|to (fix|resolve))|we.?re (fixing|resolving)/i;

export function isStuckFlowResolvingText(text: string): boolean {
  return FLOW_STUCK_RESOLVING_TEXT.test(text || "");
}

/** Icerik politikasi reddi (kart / toast). */
export const FLOW_POLICY_BLOCK_TEXT =
  /politikalar[iı]m[iı]z[iı] ihlal|ihlal ediyor olabilir|may violate|violates? (our|the) polic|content polic|tan[iı]nm[iı][sş] ki[sş]iler/i;

export function isFlowPolicyBlockText(text: string): boolean {
  return FLOW_POLICY_BLOCK_TEXT.test(text || "");
}

/**
 * "Tanınmış kişiler" reddi: ayni istemle Yeniden dene ASLA gecmez (ad durdukca
 * kart geri gelir ve akis kitlenir). Hemen yumusatilmis istemle devam edilir.
 */
export const FLOW_CELEBRITY_POLICY_TEXT =
  /tan[iı]nm[iı][sş]\s+ki[sş]iler|recognizable (?:people|persons|individuals)|well-known (?:people|individuals)|famous (?:people|person|individuals)|celebrity|likeness of a real/i;

export function isCelebrityPolicyText(text: string): boolean {
  return FLOW_CELEBRITY_POLICY_TEXT.test(text || "");
}

function normFailureText(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * Eski hata karti ayni "politika / basarisiz" metnini birakinca 2. deneme
 * yutulmasin. Yeniden dene bir kez; 2. ayni red hemen sonraki kademeye gider.
 */
export function shouldTreatVisibleFailureAsNew(opts: {
  errorText: string;
  staleFailureText: string;
  inPageRetryUsed: boolean;
  msSinceRetry: number;
  elapsedMs: number;
  progressSeen: boolean;
  progressGone: boolean;
  generateEnabled: boolean;
  newVideoAppeared?: boolean;
}): boolean {
  const text = normFailureText(opts.errorText);
  if (!text || opts.newVideoAppeared) return false;
  const policy = FLOW_POLICY_BLOCK_TEXT.test(text);
  const stale = normFailureText(opts.staleFailureText);
  if (text !== stale) return true;

  if (policy && opts.progressSeen && opts.progressGone && opts.generateEnabled) {
    if (!opts.inPageRetryUsed) return true;
    return opts.msSinceRetry >= 8_000;
  }

  const noProgressFor = opts.inPageRetryUsed ? opts.msSinceRetry : opts.elapsedMs;
  if (policy && !opts.progressSeen && opts.progressGone && opts.generateEnabled && noProgressFor >= 25_000) {
    return true;
  }

  return false;
}

export function generationChipMismatchMessage(label: string, aspect: string, seconds: number): string {
  return `Flow ayari uyumsuz (ozet: "${(label || "?").slice(0, 48)}", hedef ${aspect} ${seconds}s). 9:16 short 10s'de kalirsa Veo Fast video uretmez; sure/oran yeniden ayarlanacak.`;
}

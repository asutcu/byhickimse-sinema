import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CharacterProfile, Project } from "@prisma/client";
import { prisma } from "@/server/db";
import { ensureProjectDirs } from "@/server/lib/paths";
import { recordEvent } from "@/server/lib/logger";
import {
  FLOW_FEMALE_COVERAGE_LOCK,
  flowGenderLock,
  flowStoryCastForGender,
  sanitizeCelebrityLikenessForFlow,
  rewritePromptAfterPolicyBlock,
} from "@/lib/flow-prompt-safety";
import { buildCharacterLock, flowHandleFromName, getOrCreateMainCharacter } from "@/server/services/character";
import { ensureCastLooks, slimCastAppearancePrompt } from "@/server/services/cast";
import { engineStatus } from "@/server/automation/engine";
import {
  configureImageGeneration,
  enterPrompt,
  ensureFlowReady,
  forceImageOutputMode,
  openFlowProject,
  bindFlowProjectToOpenPage,
  PolicyBlockedError,
  resetImageComposer,
  saveImageFromElement,
  snapshotImageSources,
  startGeneration,
  switchOutputType,
  waitForNewComposerImage,
} from "@/server/automation/flow-adapter";
import { FLOW_HARD_CHAR_LIMIT, FLOW_PROMPT_MAX, clampPromptForFlowBox } from "@/lib/flow-prompt-compact";
import { resolveFlowImageModel } from "@/lib/flow-generation-settings";
import { hydrateProjectFlowImageModel } from "@/server/lib/flow-image-model-store";
import { isLikelyPersonName } from "@/lib/longform-netshort-stills";
import { resolveCastGender } from "@/lib/turkish-given-name-gender";
import {
  appendFlowLocaleCast,
  flowLocaleCastLock,
  localePackForSpeech,
  offLocaleCastNames,
} from "@/lib/speech-cast-locale";

function lockFlowCharacterPrompt(prompt: string, gender: string | null | undefined): string {
  let cleaned = sanitizeCelebrityLikenessForFlow(prompt.replace(/\s+/g, " ").trim());
  const male = gender === "male";
  if (male) {
    cleaned = cleaned
      .replace(/\[WARDROBE COVER\][^\[]*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  } else if (!/\[WARDROBE COVER\]/i.test(cleaned)) {
    cleaned = `${FLOW_FEMALE_COVERAGE_LOCK} ${cleaned}`;
  }
  if (!/\[GENDER LOCK\]/i.test(cleaned)) {
    cleaned = `${flowGenderLock(gender)} ${cleaned}`;
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * Flow ile karakter referans gorseli — YALNIZCA Nano Banana (resim).
 * Video (Veo) uretimi ve download bekleme yolu kullanilmaz.
 *
 * Tek yol: proje editorunun GORSEL modu (Nano Banana). Karakterler sayfasi
 * (.../characters) bu hesapta Yeni karakter dugmesi olmadigi icin kullanilmaz;
 * o yol her yenilemede editor <-> /characters zipplamasi ve fazla sekme aciyordu.
 *
 * Referans bicimi: TEK kisi, ON + ARKA tam boy sheet (iki panel = ayni kisi).
 * Cocuk animasyonu: ayni on + arka turnaround, ad + kiyafet etiketleriyle.
 */

/**
 * Hikaye kadrosu: ON + ARKA tam boy sheet.
 *
 * Flow "front and back" duyunca IKI AYRI kisi (cift) uretebiliyor; bu yuzden
 * her iki panelin AYNI kisi oldugu tek tek yazilir (ayni yuz, ayni kiyafet,
 * ayni boy) ve cift / ikiz / ucuncu kisi acikca yasaklanir.
 */
export function characterFrontBackSheetLock(gender?: string | null): string {
  const male = gender === "male";
  const who = male ? "adult man (male)" : "adult woman (female)";
  return [
    "ONE character reference sheet of exactly ONE person, shown twice in two panels.",
    `Subject: a single ${who} — the SAME individual in both panels.`,
    "LEFT panel: FRONT view, full body head-to-toe, feet and shoes visible, standing straight, facing the camera, arms relaxed, clear readable face, calm neutral expression.",
    "RIGHT panel: BACK view of the SAME person, full body head-to-toe, feet and shoes visible, standing straight, back to the camera, same height and same pose scale as the left panel.",
    "One person photographed twice: identical face, body, height, skin tone, hair and identical outfit and shoes in both panels.",
    "Forbidden: couple, two different people, twins, group, third person, someone standing behind, someone walking in, extra panels, collage.",
    "If another instruction says \"alone\" or \"one person\", it means ONE identity only — the front and the back panel are that same identity, never a second person.",
    "Exactly two panels side by side, equal size, thin divider or soft gap.",
    "Empty plain mid-gray seamless background in BOTH panels. Even diffused fill, matte mid-gray paper, no hot spots.",
    "This is a calm identity sheet, not a story beat — no shock, no panic, no chase, no action pose, no close-up, no side profile, no three-quarter angle.",
    "Forbidden: windows, lamps, blown-out white, sun flare, high-key overexposure.",
    `Gender is locked to this ${who} in both panels. Do not add the opposite sex.`,
    "No text, no captions, no watermark, no logo.",
  ].join(" ");
}

const EVERYDAY_FEMALE_LOOK =
  "Everyday neighbor woman: ordinary adult face, little makeup, short summer dress or mini with a slightly open neckline. Not a catalog model.";

export function kidsRenderFamily(visualStyle: string | null | undefined): "pixar" | "anime" {
  const style = (visualStyle || "").trim();
  if (style === "anime" || /anime|manga|\b2d\b/i.test(style)) return "anime";
  return "pixar";
}

/** Tek gorselde karakter sayfasi kilidi (tum uretim yollari). */
export function characterTurnaroundSheetLock(
  kids: boolean,
  characterName?: string,
  gender?: string | null,
  family: "pixar" | "anime" = "pixar"
): string {
  if (!kids) return characterFrontBackSheetLock(gender);
  const labelNote = characterName?.trim()
    ? [
        `Above both panels, large clear readable title: "${characterName.trim()}".`,
        "Small Turkish garment callout labels with thin leader lines to each visible clothing item on THIS outfit (e.g. MONT, TIŞÖRT, PANTOLON, AYAKKABI, ŞAPKA, ELDIVEN) — only items that exist; clean sans-serif, do not cover the face.",
      ].join(" ")
    : "Above both panels, large clear readable character NAME title. Small Turkish garment callout labels (MONT, TIŞÖRT, PANTOLON…) with thin leader lines to each visible clothing item.";
  return [
    "ONE reference image = a clean 2-panel CHARACTER TURNAROUND SHEET only.",
    "LEFT panel: FRONT view, full body head-to-toe, feet visible, standing straight, facing the camera, arms relaxed, neutral expression.",
    "RIGHT panel: BACK view, full body head-to-toe, feet visible, standing straight, back to the camera, same pose scale.",
    "Exactly two panels side by side, equal size, thin divider or soft gap.",
    "Lighting: even diffused fill on BOTH panels, matte mid-gray seamless paper, no hot spots.",
    "Forbidden on the sheet: windows, curtains, wall lamps, practical lights, blown-out white, high-key overexposure, gray/white cyclorama glow, sun flare.",
    "NO three-quarter angle, NO side profile, NO action pose, NO close-up, NO extra characters, NO extra panels.",
    family === "anime"
      ? "Same single 2D anime character in BOTH panels — identical face, hair, colors, costume and proportions. Flat cel shading, not 3D, not live-action."
      : "Same single 3D Pixar character in BOTH panels — identical face, species, colors, costume and proportions.",
    labelNote,
  ].join(" ");
}

/** Karakterler sayfasindaki tarif kutusuna yazilacak saf karakter tarifi. */
export function buildFlowCharacterDescription(project: Project, profile: CharacterProfile): string {
  const lock = buildCharacterLock(profile);
  const kids = project.templateType === "kids_animation";
  const kidsFamily = kidsRenderFamily(project.visualStyle);

  const sex = resolveCastGender(profile.name, profile.gender);
  const subject = kids
    ? profile.imagePrompt.trim() || profile.baseAppearancePrompt.trim() || "A friendly animated character"
    : slimCastAppearancePrompt(lock.baseAppearancePrompt, sex);
  const wardrobe = lock.baseWardrobePrompt ? ` Wardrobe: ${lock.baseWardrobePrompt}.` : "";

  const adultWord = sex === "male" ? "adult man" : "adult woman";
  const style = kids
    ? kidsFamily === "anime"
      ? "2D anime character sheet, theatrical anime line art, cel shading, same hair and costume colors in both panels. Not 3D, not live-action."
      : "3D Pixar-style animated character, feature-film render quality, physically based materials, every fur and fabric fiber faithful to the description."
    : `Live-action front+back reference sheet of ONE ordinary ${adultWord}, gender ${sex}. 85mm, even fill, natural color. One identity, one face, one outfit — repeated as front and back. Empty background.`;

  const femaleLook = sex === "female" ? EVERYDAY_FEMALE_LOOK : "";
  const joined = kids
    ? `${characterTurnaroundSheetLock(kids, profile.name, profile.gender, kidsFamily)} ${subject}${wardrobe} ${style}`.replace(/\s+/g, " ").trim()
    : lockFlowCharacterPrompt(
        [
          characterTurnaroundSheetLock(kids, profile.name, sex),
          flowStoryCastForGender(sex),
          flowLocaleCastLock(project.speechLanguage, sex, profile.name),
          subject,
          wardrobe,
          style,
          femaleLook,
        ]
          .filter(Boolean)
          .join(" "),
        sex
      );
  return kids ? joined : clampPromptForFlowBox(joined, Math.min(FLOW_PROMPT_MAX, FLOW_HARD_CHAR_LIMIT - 1));
}

/** Gorsel modu (Nano Banana) icin karakter fotografi promptu. */
export function buildFlowCharacterImagePrompt(project: Project, profile: CharacterProfile): string {
  const lock = buildCharacterLock(profile);
  const kids = project.templateType === "kids_animation";
  const kidsFamily = kidsRenderFamily(project.visualStyle);

  const sex = resolveCastGender(profile.name, profile.gender);
  const subject = kids
    ? profile.imagePrompt.trim() || profile.baseAppearancePrompt.trim() || "A friendly animated character"
    : slimCastAppearancePrompt(lock.baseAppearancePrompt, sex);

  const adultWord = sex === "male" ? "adult man" : "adult woman";
  const style = kids
    ? kidsFamily === "anime"
      ? "2D anime character sheet, theatrical line art, cel shading, painted flat colors. Not 3D, not live-action."
      : "3D Pixar-style animation still, feature-film quality render, soft global illumination, physically based materials."
    : `Live-action front+back reference sheet of ONE ${adultWord}, gender ${sex}, full body in both panels. 85mm, even fill, natural muted color. No cartoon, no beauty-ad gloss, no couple.`;

  const detail = kids
    ? kidsFamily === "anime"
      ? "Keep line weight, hair shape, eye highlights and costume colors identical in both panels."
      : "Render every fiber and material faithfully: individual fur and fabric fibers, stitching on the costume, believable texture and weight on every prop."
    : "Natural skin, slight asymmetry, lived-in hair, real fabric. Original everyday neighbor face. Calm identity sheet, not a story beat.";

  const wardrobe = lock.baseWardrobePrompt ? ` Wardrobe: ${lock.baseWardrobePrompt}.` : "";
  const femaleLook = !kids && sex === "female" ? EVERYDAY_FEMALE_LOOK : "";

  const joined = [
    characterTurnaroundSheetLock(kids, profile.name, sex, kidsFamily),
    kids
      ? `Character: one single original ${kidsFamily === "anime" ? "2D anime" : "3D"} character, the only figure on the sheet. ${subject}${wardrobe}`
      : `Character: one single ${adultWord} (${sex}), the only person on the sheet. ${subject}${wardrobe}`,
    femaleLook,
    kids
      ? "Even diffused fill on both panels, matte mid-gray seamless paper. No windows, no lamps, no blown-out white light."
      : "Even diffused fill on both panels, empty mid-gray paper. Nobody behind the subject. No windows, no lamps, no blown-out white light.",
    style,
    detail,
    kids
      ? "No watermark, no logo. Name title + Turkish garment labels ARE required on this bible sheet."
      : "No text, no captions, no watermark, no logo.",
    kids ? "" : flowStoryCastForGender(sex),
    kids ? "" : flowLocaleCastLock(project.speechLanguage, sex, profile.name),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const locked = kids ? joined : lockFlowCharacterPrompt(joined, sex);
  return kids ? locked : clampPromptForFlowBox(locked, Math.min(FLOW_PROMPT_MAX, FLOW_HARD_CHAR_LIMIT - 1));
}

/**
 * Flow Karakterler sayfasi / kutuphane, yeni uretim bitmeden ONCEKI karakterin
 * karesini "yeni" gosterebiliyor. Bu yakalanmadiginda 10 kisilik kadronun
 * TAMAMI ayni gorseli aliyor (ayni lacivert takimli adam), her kareye ayni
 * referans yukleniyor ve sahne uretimi katalog karesine kilitleniyor.
 */
export class FlowCharacterDuplicateError extends Error {
  constructor(otherName: string) {
    super(`Uretilen kare "${otherName}" karakterinin gorselinin birebir kopyasi — kaydedilmedi`);
    this.name = "FlowCharacterDuplicateError";
  }
}

function sheetHash(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Yeni sheet, kadrodaki baska birinin sheet'iyle BIREBIR ayni mi?
 * Ayniysa dosya silinir ve hata atilir; cagiran taraf yeniden dener.
 */
async function assertSheetIsUnique(projectId: string, profileId: string, imagePath: string): Promise<void> {
  const others = await prisma.characterProfile.findMany({
    where: { projectId, id: { not: profileId }, referenceImagePath: { not: null } },
    select: { name: true, referenceImagePath: true },
  });
  let hash: string;
  try {
    hash = sheetHash(imagePath);
  } catch {
    return;
  }
  for (const other of others) {
    const otherPath = other.referenceImagePath;
    if (!otherPath || !fs.existsSync(otherPath)) continue;
    let otherHash: string;
    try {
      otherHash = sheetHash(otherPath);
    } catch {
      continue;
    }
    if (otherHash !== hash) continue;
    fs.rmSync(imagePath, { force: true });
    await recordEvent({
      projectId,
      step: "character",
      level: "warning",
      message: `Kadro gorseli kopya cikti (${other.name} ile ayni) — silindi, yeniden uretilecek`,
    });
    throw new FlowCharacterDuplicateError(other.name);
  }
}

export class FlowCharacterBusyError extends Error {
  constructor(
    message = "Bu projenin otomasyonu calisiyor (ayni Flow sekmesi kullaniliyor). Karakter gorselini Flow ile uretmek icin once bu projenin otomasyonunu durdurun."
  ) {
    super(message);
    this.name = "FlowCharacterBusyError";
  }
}

/** Ayni projede ikinci "Gorsel yenile" / toplu uretim cakismasin. */
const characterFlowSlots = new Set<string>();

export function acquireCharacterFlowSlot(projectId: string): () => void {
  if (characterFlowSlots.has(projectId)) {
    throw new FlowCharacterBusyError(
      "Bu proje icin Flow karakter gorseli zaten uretiliyor. Bitmesini bekleyin (cift tik veya ikinci sekme yeni pencere acmasin)."
    );
  }
  characterFlowSlots.add(projectId);
  return () => {
    characterFlowSlots.delete(projectId);
  };
}

/** Gercekten canli dongu yoksa karakter yenileme Flow acar (yetim kilit engellemez). */
export function isCharacterFlowBlocked(status: { loopAlive: boolean }): boolean {
  return status.loopAlive;
}

/**
 * Flow'da karakter referans gorseli uretir — yalnizca Nano Banana (resim).
 * Video / download event yolu yok. Onay kullanicida kalir.
 */
export async function generateCharacterImageWithFlow(
  projectId: string,
  customPrompt?: string,
  characterId?: string,
  options?: {
    autoApprove?: boolean;
    /** Iptal kontrolu: uzun beklemeler icinde de cagrilir — "durdur" saniyeler icinde tutar. */
    assertContinuing?: () => void;
  }
): Promise<CharacterProfile> {
  // Yalnizca BU projenin CANLI otomasyonu engel. Durdurulmus/yetim runningJobId
  // Flow'u hic acmadan hata veriyordu.
  if (isCharacterFlowBlocked(engineStatus(projectId))) throw new FlowCharacterBusyError();
  const releaseSlot = acquireCharacterFlowSlot(projectId);

  try {
  const project = await hydrateProjectFlowImageModel(
    await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
  );
  const profile = characterId
    ? await prisma.characterProfile.findUniqueOrThrow({ where: { id: characterId } })
    : await getOrCreateMainCharacter(projectId);
  if (profile.projectId !== projectId) throw new Error("Karakter bu projeye ait degil");

  const root = ensureProjectDirs(project.slug);
  const slug = (profile.name || "karakter").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "karakter";
  const targetImagePath = path.join(root, "character", `reference-flow-${slug}.png`);

  await recordEvent({
    projectId,
    step: "character",
    message: `Flow penceresi aciliyor (karakter gorseli: ${profile.name || slug})`,
  });

  // Konusma dili Almanca ama isim baska dilden ise gorsel yine uretilir;
  // kullanici hikayeden gelen ismi gorsun diye uyari birakilir.
  const timeTravelSheet = project.templateType === "time_travel";
  const offLocale = timeTravelSheet ? [] : offLocaleCastNames([profile.name], project.speechLanguage);
  if (offLocale.length > 0) {
    await recordEvent({
      projectId,
      step: "character",
      level: "warning",
      message: `"${offLocale[0]}" ismi ${localePackForSpeech(project.speechLanguage).label} kadrosuna uymuyor — hikayeyi/kadroyu yenilerken isim o dile gore secilir`,
    });
  }

  const page = await ensureFlowReady(projectId, project.flowProjectUrl, { singleTab: true });
  await openFlowProject(page, project);
  await bindFlowProjectToOpenPage(project, page);

  // Karakterler sayfasi bu hesapta calismiyor (Yeni karakter dugmesi yok) ve
  // her yenilemede editor <-> /characters zıplaması + karisik sekme birakiyordu.
  // Dogrudan proje editorunun gorsel moduna git.

  // ---- Editor gorsel modu (Nano Banana) — indirme menusu YOK ----
  const sex = resolveCastGender(profile.name, profile.gender);
  let imagePromptText: string;
  if (timeTravelSheet) {
    // Sunucu modern kiyafetli, yerli donem kiyafetli, yol arkadasi hayvan:
    // kadin kapsama / cinsiyet / yerel komsu kilitleri burada uygulanmaz.
    const { buildTimeTravelSheetPrompt } = await import("@/server/services/time-travel");
    imagePromptText = customPrompt?.trim()
      ? clampPromptForFlowBox(sanitizeCelebrityLikenessForFlow(customPrompt.trim()))
      : buildTimeTravelSheetPrompt(project, profile);
  } else {
    const rawImagePrompt = customPrompt?.trim()
      ? appendFlowLocaleCast(customPrompt.trim(), project.speechLanguage, sex, profile.name)
      : buildFlowCharacterImagePrompt(project, profile);
    imagePromptText = lockFlowCharacterPrompt(rawImagePrompt, sex);
  }
  const imageModel = resolveFlowImageModel(project);
  const shoot: Project = {
    ...project,
    flowImageModel: imageModel,
    aspectRatio: project.aspectRatio || "9:16",
    audioEnabled: false,
    outputsPerGeneration: 1,
  };

  // Generate sonrasi Flow, ONCEKI karakterin karesini "yeni" gibi gosterebiliyor;
  // her karakter once o kopyayi yakalayip ~2 dk kaybediyordu (Derya/Emre vakasi).
  // Kadronun mevcut sheet hash'leri yakalama aninda reddedilir; boylece bekleme
  // ayni turda GERCEK yeni kareyi bulur.
  const existingSheetHashes = new Set<string>();
  {
    const others = await prisma.characterProfile.findMany({
      where: { projectId, id: { not: profile.id }, referenceImagePath: { not: null } },
      select: { referenceImagePath: true },
    });
    for (const other of others) {
      const otherPath = other.referenceImagePath;
      if (!otherPath || !fs.existsSync(otherPath)) continue;
      try {
        existingSheetHashes.add(sheetHash(otherPath));
      } catch {
        /* okunamayan dosya kopya kontrolune girmez */
      }
    }
  }
  const rejectExistingSheet = (buffer: Buffer): boolean =>
    existingSheetHashes.size > 0 &&
    existingSheetHashes.has(crypto.createHash("sha256").update(buffer).digest("hex"));

  try {
    await configureImageGeneration(page, shoot, imageModel);
    await forceImageOutputMode(page, shoot);
    await recordEvent({
      projectId,
      step: "character",
      message: `Karakter gorseli Flow GORSEL modunda uretiliyor (${imageModel})${profile.name ? `: ${profile.name}` : ""}`,
    });

    // Politika: ayni istem → yumusat → sifirla (klip motoruyla ayni 3 kademe).
    const generateMode = options?.autoApprove ? "auto" : project.generateButtonMode === "manual" ? "manual" : "auto";
    const runComposer = async (promptText: string) => {
      const before = await snapshotImageSources(page);
      await enterPrompt(page, shoot, clampPromptForFlowBox(promptText));
      await forceImageOutputMode(page, shoot);
      await startGeneration(page, shoot, generateMode, { output: "image" });
      return waitForNewComposerImage(page, shoot, before, {
        rejectBuffer: rejectExistingSheet,
        onPoll: options?.assertContinuing,
        // Istenen kare ZATEN on+arka karakter sheet'i: slayt/katalog reddi kapali.
        expect: "sheet",
      });
    };

    let found: Awaited<ReturnType<typeof waitForNewComposerImage>> | undefined;
    let lastErr: unknown;
    for (let policyStage = 0; policyStage <= 3; policyStage += 1) {
      if (policyStage > 0) {
        if (lastErr instanceof PolicyBlockedError) {
          const rewritten = rewritePromptAfterPolicyBlock(imagePromptText, policyStage);
          imagePromptText =
            policyStage >= 3 || timeTravelSheet ? rewritten : lockFlowCharacterPrompt(rewritten, profile.gender);
        } else if (policyStage > 1) {
          throw lastErr;
        }
        await recordEvent({
          projectId,
          step: "character",
          level: "warning",
          message: `Karakter gorseli tekrar deneniyor (kademe ${policyStage}). ${
            lastErr instanceof Error ? lastErr.message.slice(0, 140) : String(lastErr)
          }`,
        });
        await resetImageComposer(page, shoot, imageModel);
        await configureImageGeneration(page, shoot, imageModel);
        await forceImageOutputMode(page, shoot);
      }
      try {
        found = await runComposer(imagePromptText);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof PolicyBlockedError ||
          /generate|uret|dugmesi|bulunamadi|zaman asimi|prompt kutusu/i.test(err instanceof Error ? err.message : String(err));
        if (!retryable || policyStage >= 3) throw err;
      }
    }
    if (!found) throw lastErr instanceof Error ? lastErr : new Error("Karakter gorseli uretilemedi");
    const imagePath = await saveImageFromElement(page, found.locator, found.src, targetImagePath);
    await assertSheetIsUnique(projectId, profile.id, imagePath);
    const bytes = fs.statSync(imagePath).size;
    if (bytes < 5_000) throw new Error("Uretilen karakter gorseli bos/bozuk gorunuyor");

    const character = await prisma.characterProfile.update({
      where: { id: profile.id },
      data: {
        referenceImagePath: imagePath,
        imagePrompt: imagePromptText,
        imageApproved: options?.autoApprove === true,
        flowCharacterReference:
          profile.flowCharacterReference?.trim() || flowHandleFromName(profile.name),
      },
    });
    await prisma.generatedAsset.create({
      data: {
        projectId,
        kind: "character_image",
        path: imagePath,
        bytes,
        meta: JSON.stringify({ source: "flow-image-mode", character: profile.name, model: imageModel }),
      },
    });
    await recordEvent({
      projectId,
      step: "character",
      message: `Flow gorsel modu karakter fotografi hazir (${imageModel})${profile.name ? `: ${profile.name}` : ""}${options?.autoApprove ? "" : "; kullanici onayi bekleniyor"}`,
    });
    return character;
  } catch (err) {
    // Kopya hatasi SARILMADAN cikar: generateMissingCastImages bunu turunden
    // tanir ve ayni karakteri bir kez daha dener. Genel Error'a cevrilirse
    // retry devreye giremiyor ve karakter sheet'siz kaliyordu (Leyla vakasi).
    if (err instanceof FlowCharacterDuplicateError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await recordEvent({
      projectId,
      step: "character",
      level: "error",
      message: `Nano Banana karakter gorseli uretilemedi: ${message}`.slice(0, 280),
    });
    throw new Error(
      `Karakter gorseli yalnizca Nano Banana (resim) ile uretilir; video yolu kapali. ${message} ` +
        `Flow'da proje editorunun acik oldugundan ve gorsel modun (Metinden goruntuye / ${imageModel}) secilebildiginden emin olun.`
    );
  } finally {
    // Longform kare uretimi gorsel modda kalmali; /edit/ uzerinde video
    // gecisi kompozisyon cubugunu kaybettirip "editor acik degil" hatasi veriyordu.
    if (project.templateType !== "longform") {
      await switchOutputType(page, project, "video").catch(() => {});
    }
  }
  } finally {
    releaseSlot();
  }
}

/**
 * Kadrodaki gorselsiz herkese sirayla Flow referans gorseli uretir; hatada atlar.
 * Otomasyon / otopilot / gorsel slayt: autoApprove=true (onay ekrani bekletmez).
 */
export async function generateMissingCastImages(
  projectId: string,
  options?: {
    autoApprove?: boolean;
    onProgress?: (message: string) => void;
    assertContinuing?: () => void;
  }
): Promise<{ ok: number; failed: string[]; total: number }> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { templateType: true } });
  const timeTravel = project?.templateType === "time_travel";
  // Zaman Yolcusu kadrosu (sunucu, hayvan, donem yerlisi) kendi tarifini tasir;
  // isimden cinsiyet tahmini ve modern komsu yuzu buraya uygulanmaz.
  if (!timeTravel && project?.templateType !== "kids_animation") await ensureCastLooks(projectId);
  const voiceOverOnly = project?.templateType === "narrator";
  const cast = await prisma.characterProfile.findMany({
    where: { projectId, role: { in: ["main", "side"] } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  if (options?.autoApprove) {
    const unapproved = cast.filter(
      (member) => member.referenceImagePath && fs.existsSync(member.referenceImagePath) && !member.imageApproved
    );
    if (unapproved.length > 0) {
      await prisma.characterProfile.updateMany({
        where: { id: { in: unapproved.map((member) => member.id) } },
        data: { imageApproved: true },
      });
    }
  }
  const missing = cast.filter((member) => {
    if (member.referenceImagePath && fs.existsSync(member.referenceImagePath)) return false;
    // Sinema: anlatici kadrajda yok — isimsiz main icin Flow gorseli uretme.
    if (voiceOverOnly && member.role === "main") return false;
    if (project?.templateType === "kids_animation" && member.role === "main" && !member.name.trim()) return false;
    const name = member.name.trim();
    if (!timeTravel && member.role === "side" && name && !isLikelyPersonName(name)) return false;
    return true;
  });
  if (missing.length === 0) {
    options?.onProgress?.(`Kadro gorselleri tam (${cast.length} kisi)`);
    return { ok: 0, failed: [], total: cast.length };
  }

  let ok = 0;
  const failed: string[] = [];
  for (const member of missing) {
    options?.assertContinuing?.();
    const label = member.name || member.role;
    options?.onProgress?.(`Karakter gorseli: ${label} (${ok + failed.length + 1}/${missing.length})`);
    try {
      // Kopya gelirse bir kez daha denenir: Flow kutuphanesi bazen onceki
      // karakterin karesini gosteriyor, ikinci turda gercek uretim gelir.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await generateCharacterImageWithFlow(projectId, undefined, member.id, {
            autoApprove: options?.autoApprove === true,
            assertContinuing: options?.assertContinuing,
          });
          break;
        } catch (err) {
          if (!(err instanceof FlowCharacterDuplicateError) || attempt === 2) throw err;
          options?.onProgress?.(`Karakter gorseli kopya cikti, yeniden deneniyor: ${label}`);
        }
      }
      ok += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/giri[sş]|login|oturum/i.test(msg)) throw err;
      failed.push(label);
      await recordEvent({
        projectId,
        step: "character",
        level: "warning",
        message: `Karakter gorseli uretilemedi, atlandi: ${label} — ${msg.slice(0, 160)}`,
      });
    }
  }
  await recordEvent({
    projectId,
    step: "character",
    level: failed.length > 0 ? "warning" : "info",
    message:
      failed.length > 0
        ? `Kadro gorselleri: ${ok} uretildi, ${failed.length} atlandi (${failed.join(", ")})`
        : `Kadro gorselleri tamam: ${ok} kisi uretildi`,
  });
  return { ok, failed, total: cast.length };
}

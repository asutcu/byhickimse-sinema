import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Project } from "@prisma/client";
import { prisma } from "@/server/db";
import { ensureProjectDirs, safeProjectPath, slugify } from "@/server/lib/paths";
import { getSettings, wpmForPace } from "@/server/services/settings";
import { computeTargetWords } from "@/server/services/story";
import { preferredNarratorClipSeconds, resolveFlowImageModel } from "@/lib/flow-generation-settings";
import { buildCharacterLock, normalizeAge, stripEmotionTonePhrase } from "@/server/services/character";
import { recordEvent } from "@/server/lib/logger";
import { persistProjectFlowImageModel, withFlowImageModel } from "@/server/lib/flow-image-model-store";
import { FLOW_PROJECT_URL_EXAMPLE, normalizeFlowProjectUrl, parseTimeTravelSettings, serializeTimeTravelSettings } from "@/lib/time-travel";

/**
 * Proje olusturma / listeleme / silme ve ornek test projesi.
 */

export const createProjectSchema = z.object({
  name: z.string().min(1, "Proje adi gerekli").max(120),
  title: z.string().default(""),
  topic: z.string().default(""),
  genre: z.string().default("gizem"),
  targetDurationSeconds: z.number().int().min(20).max(3600).default(180),
  // Dil adlari Ingilizce saklanir: Flow'a giden yonetmen talimatlari Ingilizcedir
  // ("She speaks clearly in Turkish") ve model bunu daha guvenilir yorumlar.
  storyLanguage: z.string().default("Turkish"),
  speechLanguage: z.string().default("Turkish"),
  audience: z.string().default(""),
  narrationStyle: z.string().default(""),
  openingHook: z.string().default(""),
  avoidList: z.string().default(""),
  speechPace: z.enum(["slow", "normal", "fast"]).default("normal"),
  targetWordCount: z.number().int().min(0).default(0),
  templateType: z.enum(["narrator", "longform", "time_travel", "kids_animation"]).default("narrator"),
  longformSettings: z.string().default(""),
  timeTravelSettings: z.string().default(""),
  seriesHook: z.string().default(""),
  flowModel: z.string().default(""),
  flowImageModel: z.string().default(""),
  // 0 = ayarlar ekranindaki varsayilan klip suresi kullanilir
  clipSeconds: z
    .number()
    .int()
    .max(20)
    .default(0)
    .refine((v) => v === 0 || v >= 2, { message: "Klip suresi en az 2 saniye olmali (0 = varsayilan)" }),
  aspectRatio: z.string().default(""),
  outputsPerGeneration: z.number().int().min(1).max(4).default(1),
  audioEnabled: z.boolean().default(true),
  useReference: z.boolean().default(true),
  useFlowCharacter: z.boolean().default(true),
  useStartFrame: z.boolean().default(false),
  usePrevLastFrame: z.boolean().default(true),
  reuseFlowProject: z.boolean().default(true),
  flowProjectName: z.string().default(""),
  flowProjectUrl: z.string().default(""),
  generateButtonMode: z.enum(["auto", "manual"]).default("auto"),
  automationMode: z.enum(["full", "semi"]).default("full"),
  allowSubtitles: z.boolean().default(false),
  ageBand: z.string().default(""),
  moralLesson: z.string().default(""),
  visualStyle: z.string().default(""),
  channelName: z.string().default(""),
  character: z
    .object({
      name: z.string().default(""),
      age: z.number().int().default(20),
      nationalityLook: z.string().default(""),
      hair: z.string().default(""),
      faceFeatures: z.string().default(""),
      makeup: z.string().default(""),
      wardrobe: z.string().default(""),
      bodyFraming: z.string().default(""),
      sittingPose: z.string().default(""),
      gestureLevel: z.string().default(""),
      voiceCharacter: z.string().default(""),
      emotionTone: z.string().default(""),
      environment: z.string().default(""),
      lighting: z.string().default(""),
      cameraAngle: z.string().default(""),
      lensLook: z.string().default(""),
      background: z.string().default(""),
      negativePrompt: z.string().default(""),
      flowCharacterReference: z.string().default(""),
    })
    .optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let i = 2;
  while (await prisma.project.findUnique({ where: { slug } })) {
    slug = `${slugify(base)}-${i}`;
    i++;
  }
  return slug;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const settings = await getSettings();
  if (input.templateType === "time_travel" && input.flowProjectUrl.trim()) {
    const normalized = normalizeFlowProjectUrl(input.flowProjectUrl);
    if (!normalized) {
      throw new Error(`Geçersiz Google Flow proje adresi. Örnek: ${FLOW_PROJECT_URL_EXAMPLE}`);
    }
    input = { ...input, flowProjectUrl: normalized, reuseFlowProject: true };
  }
  const slug = await uniqueSlug(input.name);
  const wpm = wpmForPace(settings, input.speechPace);
  const targetWordCount = input.targetWordCount > 0 ? input.targetWordCount : computeTargetWords(input.targetDurationSeconds, wpm);

  const project = await prisma.project.create({
    data: {
      name: input.name,
      slug,
      title: input.title,
      topic: input.topic,
      genre: input.genre,
      targetDurationSeconds: input.targetDurationSeconds,
      storyLanguage: input.storyLanguage,
      speechLanguage: input.speechLanguage,
      audience: input.audience,
      narrationStyle: input.narrationStyle,
      openingHook: input.openingHook,
      avoidList: input.avoidList,
      speechPace: input.speechPace,
      targetWordCount,
      templateType: input.templateType,
      flowModel: input.flowModel || settings.defaultFlowModel,
      clipSeconds:
        input.templateType === "longform"
          ? [10, 15, 20].includes(input.clipSeconds)
            ? input.clipSeconds
            : 15
          : input.templateType === "narrator" ||
              input.templateType === "time_travel" ||
              input.templateType === "kids_animation"
            ? preferredNarratorClipSeconds(input.flowModel || settings.defaultFlowModel, input.clipSeconds || 10)
            : input.clipSeconds || settings.defaultClipSeconds,
      aspectRatio:
        input.templateType === "longform" ||
        input.templateType === "time_travel" ||
        input.templateType === "kids_animation"
          ? "16:9"
          : input.aspectRatio || settings.defaultAspectRatio,
      outputsPerGeneration: input.outputsPerGeneration,
      audioEnabled: input.audioEnabled,
      useReference: input.useReference,
      useFlowCharacter: true,
      useStartFrame: input.useStartFrame,
      usePrevLastFrame: input.usePrevLastFrame,
      reuseFlowProject: input.reuseFlowProject,
      flowProjectName: input.flowProjectName,
      flowProjectUrl: input.flowProjectUrl.trim(),
      generateButtonMode: input.generateButtonMode,
      automationMode: input.automationMode,
      allowSubtitles: input.templateType === "longform" ? Boolean(input.allowSubtitles) : false,
      ageBand: input.ageBand,
      moralLesson: input.moralLesson,
      visualStyle:
        input.templateType === "kids_animation" ? input.visualStyle || "pixar3d" : input.visualStyle,
      channelName: input.channelName,
      seriesHook: input.seriesHook || "",
      longformSettings: input.templateType === "longform" ? input.longformSettings || "{}" : "{}",
      timeTravelSettings:
        input.templateType === "time_travel"
          ? serializeTimeTravelSettings(parseTimeTravelSettings(input.timeTravelSettings || "{}"))
          : "{}",
    },
  });
  const createdImageModel = await persistProjectFlowImageModel(
    project.id,
    resolveFlowImageModel({
      flowImageModel: input.flowImageModel,
      longformSettings: input.longformSettings,
    })
  );

  // Ana karakter profili
  const characterInput = input.character;
  const character = await prisma.characterProfile.create({
    data: {
      projectId: project.id,
      role: "main",
      name: characterInput?.name ?? "",
      age: normalizeAge(characterInput?.age),
      adult: true,
      nationalityLook: characterInput?.nationalityLook ?? "",
      hair: characterInput?.hair ?? "",
      faceFeatures: characterInput?.faceFeatures ?? "",
      makeup: characterInput?.makeup ?? "",
      wardrobe: characterInput?.wardrobe ?? "",
      bodyFraming: characterInput?.bodyFraming ?? "",
      sittingPose: characterInput?.sittingPose ?? "",
      gestureLevel: characterInput?.gestureLevel ?? "",
      voiceCharacter: characterInput?.voiceCharacter ?? "",
      emotionTone: characterInput?.emotionTone ?? "",
      environment: characterInput?.environment ?? "",
      lighting: characterInput?.lighting ?? "",
      cameraAngle: characterInput?.cameraAngle ?? "",
      lensLook: characterInput?.lensLook ?? "",
      background: characterInput?.background ?? "",
      negativePrompt: characterInput?.negativePrompt ?? "",
      flowCharacterReference: characterInput?.flowCharacterReference ?? "",
    },
  });
  const lock = buildCharacterLock(character);
  await prisma.characterProfile.update({ where: { id: character.id }, data: lock });
  if (project.templateType === "time_travel") {
    const { seedTimeTravelCast } = await import("@/server/services/time-travel");
    await seedTimeTravelCast(project.id);
  }

  const root = ensureProjectDirs(slug);
  fs.writeFileSync(
    path.join(root, "project.json"),
    JSON.stringify({ id: project.id, name: project.name, slug, templateType: project.templateType, createdAt: project.createdAt }, null, 2),
    "utf8"
  );

  await recordEvent({ projectId: project.id, step: "project", message: `Proje olusturuldu: ${project.name} (${project.templateType})` });
  return withFlowImageModel(project, createdImageModel);
}

/** Projeyi ve istege bagli olarak dosyalarini siler. Once calisan her sey durdurulur. */
export async function deleteProject(projectId: string, deleteFiles: boolean): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  // Calisan surecler once durdurulur — silinen projeye karsi calisip hata uretmesinler.
  try {
    const { cancelAutoPilot } = await import("@/server/services/auto-pilot");
    cancelAutoPilot(projectId);
  } catch {
    // otopilot yoksa sorun degil
  }
  try {
    const { requestLongformCancel } = await import("@/server/services/longform-jobs");
    requestLongformCancel(projectId);
  } catch {
    // longform isi yoksa sorun degil
  }
  try {
    const { stopAutomation } = await import("@/server/automation/engine");
    await stopAutomation(projectId).catch(() => {});
  } catch {
    // otomasyon calismiyorsa sorun degil
  }

  await prisma.project.delete({ where: { id: projectId } });
  if (deleteFiles) {
    const root = safeProjectPath(project.slug);
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  }
  await recordEvent({ step: "project", message: `Proje silindi: ${project.name}${deleteFiles ? " (dosyalar dahil)" : ""}` });
}

export const createFilmSchema = z.object({
  name: z.string().min(1, "Film adi gerekli").max(120),
  title: z.string().default(""),
  topic: z.string().default(""),
  moralLesson: z.string().optional(),
  /** Yoksa seri kokunden kopyalanir. */
  targetDurationSeconds: z.number().int().min(20).max(3600).optional(),
  clipSeconds: z.number().int().min(2).max(20).optional(),
  /** Bu filme OZEL Flow adresi. Seri kokunden ASLA miras alinmaz: ayni adreste
   *  iki film paralel calisirsa birbirinin uretimini bozar. */
  flowProjectUrl: z.string().default(""),
});

export type CreateFilmInput = z.infer<typeof createFilmSchema>;

/**
 * Ayni ana karakterle yeni alt film olusturur.
 *
 * Davranis = YENI PROJE gibi sifir: klipler/sahne/diyalog/baslik/konu/tema/prop/kostum YOK.
 * Tek hazir sey: ana karakterin GORSEL KIMLIGI (yuz, tur, boy/oran, ses + referans kopyasi).
 * Tema secilince kostum ve prop kilidi bu film icin bastan yazilir.
 */
export async function createFilmFromProject(sourceProjectId: string, input: CreateFilmInput): Promise<Project> {
  const source = await prisma.project.findUniqueOrThrow({ where: { id: sourceProjectId } });
  const seriesRootId = source.parentProjectId ?? source.id;
  const seriesRoot = seriesRootId === source.id ? source : await prisma.project.findUniqueOrThrow({ where: { id: seriesRootId } });

  const mainSource =
    (await prisma.characterProfile.findFirst({ where: { projectId: seriesRootId, role: "main" } })) ??
    (await prisma.characterProfile.findFirst({ where: { projectId: source.id, role: "main" } }));
  if (!mainSource) throw new Error("Seride ana karakter yok — once karakteri secin");

  const filmRows = await prisma.project.findMany({
    where: { OR: [{ id: seriesRootId }, { parentProjectId: seriesRootId }] },
    select: { filmIndex: true },
  });
  const nextFilmIndex = Math.max(1, ...filmRows.map((f) => f.filmIndex), seriesRoot.filmIndex) + 1;

  const slug = await uniqueSlug(input.name);
  const settings = await getSettings();
  const targetDurationSeconds = input.targetDurationSeconds ?? seriesRoot.targetDurationSeconds;
  const clipSeconds = input.clipSeconds ?? seriesRoot.clipSeconds ?? settings.defaultClipSeconds;
  const wpm = wpmForPace(settings, seriesRoot.speechPace);
  const targetWordCount = computeTargetWords(targetDurationSeconds, wpm);

  const film = await prisma.project.create({
    data: {
      name: input.name,
      slug,
      title: input.title.trim() || input.name,
      // Yeni film: eski hikaye brief'i tasinmaz (opsiyonel input haric)
      topic: input.topic.trim(),
      genre: seriesRoot.genre,
      targetDurationSeconds,
      storyLanguage: seriesRoot.storyLanguage,
      speechLanguage: seriesRoot.speechLanguage,
      audience: seriesRoot.audience,
      narrationStyle: seriesRoot.narrationStyle,
      openingHook: "",
      avoidList: "",
      speechPace: seriesRoot.speechPace,
      targetWordCount,
      templateType: seriesRoot.templateType,
      status: "draft",
      flowModel: seriesRoot.flowModel || settings.defaultFlowModel,
      clipSeconds,
      aspectRatio: seriesRoot.aspectRatio || settings.defaultAspectRatio,
      outputsPerGeneration: seriesRoot.outputsPerGeneration,
      audioEnabled: seriesRoot.audioEnabled,
      useReference: seriesRoot.useReference,
      useFlowCharacter: true,
      useStartFrame: seriesRoot.useStartFrame,
      usePrevLastFrame: seriesRoot.usePrevLastFrame,
      // Eski Flow projesindeki karakter/malzeme tasinmasin — yeni film kendi Flow alani
      reuseFlowProject: false,
      flowProjectName: "",
      flowProjectUrl: input.flowProjectUrl.trim(),
      generateButtonMode: seriesRoot.generateButtonMode,
      automationMode: seriesRoot.automationMode,
      promptTemplate: seriesRoot.promptTemplate,
      allowSubtitles: false,
      ageBand: seriesRoot.ageBand,
      // Tema sifirdan secilsin — onceki filmin temasi miras kalmasin
      moralLesson: input.moralLesson?.trim() ?? "",
      visualStyle: seriesRoot.visualStyle,
      channelName: seriesRoot.channelName,
      episodeNumber: nextFilmIndex,
      seriesHook: "",
      emotionCurve: "[]",
      parentProjectId: seriesRootId,
      filmIndex: nextFilmIndex,
    },
  });
  await persistProjectFlowImageModel(film.id, resolveFlowImageModel(seriesRoot));

  const root = ensureProjectDirs(slug);
  let newRefPath: string | null = null;
  if (mainSource.referenceImagePath && fs.existsSync(mainSource.referenceImagePath)) {
    const ext = path.extname(mainSource.referenceImagePath) || ".png";
    newRefPath = path.join(root, "character", `main-ref${ext}`);
    fs.copyFileSync(mainSource.referenceImagePath, newRefPath);
  }

  const carriedVoicePrompt = stripEmotionTonePhrase(mainSource.baseVoicePrompt);
  const preparedDna = mainSource.dnaCard || "{}";
  let signatureProp = "";
  let identityAppearance = "";
  try {
    const parsed = JSON.parse(preparedDna) as { signatureProp?: string; imagePrompt?: string; bodyDetail?: string };
    signatureProp = parsed.signatureProp?.trim() || "";
    identityAppearance = [parsed.imagePrompt || "", parsed.bodyDetail || ""].filter((p) => p.trim()).join(" ");
  } catch {
    // ignore
  }
  if (!identityAppearance) {
    identityAppearance = mainSource.baseAppearancePrompt || "";
  }

  await prisma.characterProfile.create({
    data: {
      projectId: film.id,
      role: "main",
      name: mainSource.name,
      age: mainSource.age,
      adult: mainSource.adult,
      gender: mainSource.gender,
      nationalityLook: mainSource.nationalityLook,
      hair: mainSource.hair,
      faceFeatures: mainSource.faceFeatures,
      makeup: "",
      wardrobe: "",
      bodyFraming: mainSource.bodyFraming || "",
      sittingPose: "",
      gestureLevel: mainSource.gestureLevel || "",
      voiceCharacter: mainSource.voiceCharacter,
      emotionTone: "",
      environment: "",
      lighting: "",
      cameraAngle: "",
      lensLook: "",
      background: "",
      negativePrompt: mainSource.negativePrompt || "",
      referenceImagePath: newRefPath,
      // Eski Flow karakter kaydi eski kostumu kilitleyebilir — yeni filmde sifirla
      flowCharacterReference: "",
      baseAppearancePrompt: identityAppearance,
      baseWardrobePrompt: signatureProp ? `Always carries: ${signatureProp}` : "",
      baseEnvironmentPrompt: "",
      baseCameraPrompt: mainSource.baseCameraPrompt || "",
      baseVoicePrompt: carriedVoicePrompt,
      dnaCard: preparedDna,
      imagePrompt: identityAppearance,
      // Yuz/tur referansi kopyalandi; tema kostumu uretilip onaylanana kadar Flow'a gitmez
      imageApproved: false,
      storyRole: "",
      storyNote: "",
    },
  });

  fs.writeFileSync(
    path.join(root, "project.json"),
    JSON.stringify(
      {
        id: film.id,
        name: film.name,
        slug,
        templateType: film.templateType,
        parentProjectId: seriesRootId,
        filmIndex: nextFilmIndex,
        createdAt: film.createdAt,
      },
      null,
      2
    ),
    "utf8"
  );

  await recordEvent({
    projectId: film.id,
    step: "project",
    message: `Yeni film olusturuldu (sifir hikaye + hazir karakter kimligi): ${film.name} (Film ${nextFilmIndex}, seri: ${seriesRoot.name}, ana: ${mainSource.name})`,
  });
  return film;
}

/**
 * Kurulum sihirbazindaki 3 kliplik ornek test projesi (Bolum 24).
 * Hikaye onceden tanimlidir; OpenAI gerektirmez.
 */
export async function createSampleProject(): Promise<Project> {
  const clip1 = "Merhaba. Bugün size, hayatımda yaşadığım en tuhaf olayı anlatacağım.";
  const clip2 = "Her şey, geçen yaz küçük bir sahil kasabasına taşınmamla başladı.";
  const clip3 = "İlk gece, boş olduğunu sandığım evin üst katından ayak sesleri duydum.";
  const fullStory = `${clip1} ${clip2} ${clip3}`;

  const project = await createProject(
    createProjectSchema.parse({
      name: "Test Projesi - 3 Klip",
      title: "Sahil Kasabasindaki Ev",
      topic: "Sahil kasabasina tasinan bir kadinin evinde duydugu gizemli sesler",
      genre: "gizem",
      targetDurationSeconds: 30,
      speechPace: "normal",
      character: {
        name: "Lena",
        age: 20,
        nationalityLook: "German",
        hair: "long blonde hair",
        faceFeatures: "natural, soft facial features",
        makeup: "natural makeup",
        wardrobe: "modern, stylish casual outfit",
        bodyFraming: "medium close-up",
        sittingPose: "sitting on a sofa in a modern living room",
        gestureLevel: "subtle",
        voiceCharacter: "calm, warm female voice",
        emotionTone: "mysterious, slightly tense",
        environment: "modern living room with a comfortable sofa",
        lighting: "soft, warm indoor lighting",
        cameraAngle: "eye-level fixed camera",
        lensLook: "natural 35mm look",
        background: "modern living room, softly blurred",
        negativePrompt: "",
      },
    })
  );

  // Hikaye + klipler onceden tanimli
  const settings = await getSettings();
  const wpm = wpmForPace(settings, "normal");
  await prisma.story.create({
    data: {
      projectId: project.id,
      languageVariant: "primary",
      title: "Sahil Kasabasindaki Ev",
      summary: "Sahil kasabasina tasinan bir kadin, bos sandigi evin ust katindan sesler duyar.",
      hook: clip1,
      fullStory,
      estimatedWords: fullStory.split(/\s+/).length,
      estimatedDurationSeconds: Math.round((fullStory.split(/\s+/).length / wpm) * 60),
      language: "Türkçe",
    },
  });

  const dialogues = [clip1, clip2, clip3];
  for (let i = 0; i < dialogues.length; i++) {
    const words = dialogues[i].split(/\s+/).length;
    await prisma.clip.create({
      data: {
        projectId: project.id,
        languageVariant: "primary",
        index: i + 1,
        dialogue: dialogues[i],
        estimatedWords: words,
        estimatedDurationSeconds: Number(((words / wpm) * 60).toFixed(1)),
        hasHook: i === 0 || i === 2,
        curiosityScore: i === 2 ? 8 : 5,
        status: "draft",
      },
    });
  }
  await prisma.project.update({ where: { id: project.id }, data: { status: "clips_ready" } });
  await recordEvent({ projectId: project.id, step: "project", message: "3 kliplik ornek test projesi hazir" });
  return project;
}

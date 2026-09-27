import fs from "node:fs";
import path from "node:path";
import type { Clip } from "@prisma/client";
import { prisma } from "@/server/db";
import { preferredNarratorClipSeconds } from "@/lib/flow-generation-settings";
import {
  splitStoryIntoClips,
  splitIntoSentences,
  countWords,
  detectHook,
  maxWordsForClipSeconds,
  fitTextToMaxWords,
  speechFillRatioFor,
} from "@/server/services/splitter";
import { wpmForPace, getSettings } from "@/server/services/settings";
import { buildClipPrompt } from "@/server/services/prompt-builder";
import { stampNoOnscreenTextLock, stripEmbeddedOnscreenTextTails } from "@/lib/flow-prompt-compact";
import { ensureProjectDirs, safeProjectPath } from "@/server/lib/paths";
import { recordEvent } from "@/server/lib/logger";
import { publishEvent } from "@/server/lib/events";
import { reportCuriosityFlow } from "@/server/services/curiosity";
import { emptyDialogueHint } from "@/lib/templates";
import { narratorSupportingCastForPrompt } from "@/server/services/narrator-film";
import { onScreenCastForClipBeat } from "@/lib/cast-clip-match";
import { archiveClipPrompts } from "@/server/services/prompt-archive";

/**
 * Klip yasam dongusu: bolme, duzenleme, birlestirme, ikiye bolme,
 * siralama, prompt uretimi ve disa aktarma.
 */

function kidsPromptCast<T extends { id: string; role: string; name: string }>(
  cast: T[],
  scene: T | null,
  fallback: T | null
): { hero: T | null; supporting: T[] } {
  const sides = cast.filter((member) => member.role === "side" && member.name.trim());
  const hero = (scene && scene.role === "side" ? scene : null) || sides[0] || fallback;
  return { hero, supporting: sides.filter((member) => member.id !== hero?.id).slice(0, 4) };
}

/** Hikayeyi kliplere boler; onceki (tamamlanmamis) klip seti degistirilir.
 * force=true ise tamamlanmis klipler dahil silinir ve yeniden bolunur.
 */
export async function splitProjectStory(projectId: string, options?: { force?: boolean }): Promise<Clip[]> {
  const { runExclusiveProjectJob } = await import("@/server/lib/project-job");
  return runExclusiveProjectJob(projectId, "split", () => splitProjectStoryUnlocked(projectId, options));
}

async function splitProjectStoryUnlocked(projectId: string, options?: { force?: boolean }): Promise<Clip[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(
      "Proje bulunamadi — sekme eski veya proje silinmis. Sol menuden / projeler listesinden guncel projeyi acip tekrar deneyin."
    );
  }
  const story = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  if (!story || !story.fullStory.trim()) throw new Error("Once hikaye olusturun");

  const completedCount = await prisma.clip.count({ where: { projectId, languageVariant: "primary", status: "completed" } });
  if (completedCount > 0 && !options?.force) {
    throw new Error(
      `${completedCount} klip zaten tamamlanmis. Yeniden bolme tamamlanan uretimleri gecersiz kilar; "Uretimi silip yeniden bol" ile onaylayin veya projeyi kopyalayin.`
    );
  }
  if (completedCount > 0 && options?.force) {
    await recordEvent({
      projectId,
      step: "clips",
      level: "warning",
      message: `Zorla yeniden bolme: ${completedCount} tamamlanmis klip silinecek`,
    });
  }

  const settings = await getSettings();
  const wpm = wpmForPace(settings, project.speechPace);
  let clipSeconds = project.clipSeconds;
  const timeTravel = project.templateType === "time_travel";
  const kids = project.templateType === "kids_animation";
  if (project.templateType === "narrator" || timeTravel || kids) {
    const nextSeconds = preferredNarratorClipSeconds(project.flowModel, project.clipSeconds);
    if (nextSeconds !== project.clipSeconds) {
      await prisma.project.update({ where: { id: projectId }, data: { clipSeconds: nextSeconds } });
      clipSeconds = nextSeconds;
      (project as { clipSeconds: number }).clipSeconds = nextSeconds;
    }
  }
  const drafts = splitStoryIntoClips(story.fullStory, {
    clipSeconds,
    wpm,
    safetyRatio:
      project.templateType === "narrator" || timeTravel || kids
        ? speechFillRatioFor(project.templateType)
        : undefined,
  });
  if (drafts.length === 0) throw new Error("Hikaye kliplere bolunemedi (metin bos gorunuyor)");

  await archiveClipPrompts(projectId, "hikaye kliplere bolundu", { languageVariant: "primary" });
  await prisma.clip.deleteMany({ where: { projectId, languageVariant: "primary" } });
  const created: Clip[] = [];
  for (const draft of drafts) {
    created.push(
      await prisma.clip.create({
        data: {
          projectId,
          languageVariant: "primary",
          index: draft.index,
          dialogue: draft.dialogue,
          estimatedWords: draft.estimatedWords,
          estimatedDurationSeconds: draft.estimatedDurationSeconds,
          hasHook: draft.hasHook,
          curiosityScore: draft.curiosityScore,
          status: "draft",
          // Anlatici film: varsayilan cutaway (dis ses + hikaye dunyasi). Talking-head yalnizca acil durum.
          shotType: timeTravel ? "tt_selfie" : project.templateType === "narrator" ? "cutaway" : "narrator",
        },
      })
    );
  }

  await prisma.project.update({ where: { id: projectId }, data: { status: "clips_ready" } });
  publishEvent(projectId, { type: "project", payload: { id: projectId, status: "clips_ready" } });
  await persistClipsJson(projectId);
  await recordEvent({ projectId, step: "clips", message: `Hikaye ${created.length} klibe bolundu (hedef klip suresi ${project.clipSeconds} sn)` });
  if (!timeTravel) await reportCuriosityFlow(projectId);

  if (timeTravel) {
    const { planTimeTravelClips } = await import("@/server/services/time-travel");
    const planned = await planTimeTravelClips(projectId);
    await persistClipsJson(projectId);
    return planned;
  }

  if (project.templateType === "narrator") {
    const named = await assignClipsFromStoryNames(projectId);
    if (named > 0) {
      await recordEvent({
        projectId,
        step: "clips",
        message: `${named} klip hikaye metnindeki isimlere gore kadroya baglandi`,
      });
    }
    try {
      const { planNarratorFilm } = await import("@/server/services/narrator-film");
      await planNarratorFilm(projectId, { force: true });
      await assignClipsFromStoryNames(projectId);
      await persistClipsJson(projectId);
      await recordEvent({
        projectId,
        step: "clips",
        message: `Film sahneleri hazirlandi (${created.length} klip — voice-over / hikaye dunyasi)`,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Proje ortada silindiyse sessizce net hata ver
      const stillThere = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!stillThere) {
        throw new Error(
          "Proje bolme sirasinda silindi veya sekme eski. Guncel projeyi acip hikayeyi tekrar kliplere bolun."
        );
      }
      await recordEvent({
        projectId,
        step: "clips",
        level: "warning",
        message: `Film plani atlandi — Karakter sekmesinden yeniden uretin: ${detail}`,
      });
    }
    return prisma.clip.findMany({
      where: { projectId, languageVariant: "primary" },
      orderBy: { index: "asc" },
    });
  }

  if (project.templateType === "kids_animation") {
    const named = await assignClipsFromStoryNames(projectId);
    if (named > 0) {
      await recordEvent({
        projectId,
        step: "clips",
        message: `${named} klip cizgi film karakterlerine baglandi`,
      });
    }
    return prisma.clip.findMany({
      where: { projectId, languageVariant: "primary" },
      orderBy: { index: "asc" },
    });
  }
  return created;
}

/** Klip VO'sunda adi gecen kadroyu o klibe yazar (kac kisiyse; LEAD = ilk isim). */
export async function assignClipsFromStoryNames(projectId: string): Promise<number> {
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  const cast = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  if (clips.length === 0 || cast.length === 0) return 0;
  let linked = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (clip.status === "completed") continue;
    const prev = i > 0 ? clips[i - 1].dialogue : "";
    const onScreen = onScreenCastForClipBeat(clip.dialogue, cast, prev);
    const nextId = onScreen[0]?.id ?? null;
    if ((clip.characterId || null) === nextId) continue;
    await prisma.clip.update({ where: { id: clip.id }, data: { characterId: nextId } });
    clip.characterId = nextId;
    if (nextId) linked++;
  }
  return linked;
}

/** Klip metnini gunceller; klip suresi kelime butcesine sigdirir ve sure tahminini hesaplar. */
export async function updateClipDialogue(clipId: string, dialogue: string): Promise<Clip> {
  const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: clip.projectId } });
  const settings = await getSettings();
  const wpm = wpmForPace(settings, project.speechPace);
  const maxWords = maxWordsForClipSeconds(project.clipSeconds, wpm, speechFillRatioFor(project.templateType));
  const fitted = fitTextToMaxWords(dialogue, maxWords);
  const words = countWords(fitted);
  const lastSentence = splitIntoSentences(fitted).pop() ?? "";
  const hook = detectHook(lastSentence);
  const updated = await prisma.clip.update({
    where: { id: clipId },
    data: {
      dialogue: fitted,
      estimatedWords: words,
      estimatedDurationSeconds: Number(((words / wpm) * 60).toFixed(1)),
      hasHook: hook.hasHook,
      curiosityScore: hook.score,
      prompt: "", // metin degisti; prompt yeniden uretilmeli
      status: clip.status === "completed" ? "draft" : clip.status,
    },
  });
  await persistClipsJson(clip.projectId);
  return updated;
}

/**
 * Projeyi klip suresi / konusma hizina gore diyalog butcesine ceker.
 * clipSeconds veya speechPace degisince cagirilir.
 */
export async function fitProjectDialoguesToClipBudget(projectId: string): Promise<number> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const settings = await getSettings();
  const wpm = wpmForPace(settings, project.speechPace);
  const maxWords = maxWordsForClipSeconds(project.clipSeconds, wpm, speechFillRatioFor(project.templateType));
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });

  let updated = 0;
  for (const clip of clips) {
    if (!clip.dialogue?.trim()) continue;
    const fitted = fitTextToMaxWords(clip.dialogue, maxWords);
    const words = countWords(fitted);
    const estimatedDurationSeconds = Number(((words / wpm) * 60).toFixed(1));
    const dialogueChanged = fitted !== clip.dialogue;
    if (!dialogueChanged && words === clip.estimatedWords && estimatedDurationSeconds === clip.estimatedDurationSeconds) {
      continue;
    }
    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        dialogue: fitted,
        estimatedWords: words,
        estimatedDurationSeconds,
        ...(dialogueChanged ? { prompt: "" } : {}),
      },
    });
    updated++;
  }

  if (updated > 0) {
    await persistClipsJson(projectId);
    await recordEvent({
      projectId,
      step: "clips",
      message: `${updated} klip diyalogu ${project.clipSeconds} sn butcesine (~${maxWords} kelime) sigdirildi`,
    });
  }
  return updated;
}

/** Klibi bir sonraki kliple birlestirir. */
export async function mergeClipWithNext(clipId: string): Promise<Clip> {
  const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });
  const next = await prisma.clip.findFirst({
    where: { projectId: clip.projectId, languageVariant: clip.languageVariant, index: clip.index + 1 },
  });
  if (!next) throw new Error("Birlestirilecek sonraki klip yok");
  if (clip.status === "completed" || next.status === "completed") {
    throw new Error("Tamamlanmis klipler birlestirilemez");
  }

  const merged = await updateClipDialogue(clip.id, `${clip.dialogue} ${next.dialogue}`.trim());
  await prisma.clip.delete({ where: { id: next.id } });
  await renumberClips(clip.projectId, clip.languageVariant);
  await recordEvent({ projectId: clip.projectId, step: "clips", message: `Klip ${clip.index} ile ${next.index} birlestirildi` });
  return merged;
}

/** Klibi cumle sinirindan ikiye boler. */
export async function splitClipInTwo(clipId: string): Promise<[Clip, Clip]> {
  const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });
  if (clip.status === "completed") throw new Error("Tamamlanmis klip bolunemez");
  const sentences = splitIntoSentences(clip.dialogue);
  if (sentences.length < 2) throw new Error("Klip tek cumleden olusuyor; cumle sinirindan bolunemez");

  // Kelime sayisina gore ortaya en yakin cumle siniri
  const totalWords = countWords(clip.dialogue);
  let acc = 0;
  let splitAt = 1;
  for (let i = 0; i < sentences.length - 1; i++) {
    acc += countWords(sentences[i]);
    if (acc >= totalWords / 2) {
      splitAt = i + 1;
      break;
    }
  }
  const firstText = sentences.slice(0, splitAt).join(" ");
  const secondText = sentences.slice(splitAt).join(" ");

  // Sonraki kliplerin indexlerini kaydir
  const laterClips = await prisma.clip.findMany({
    where: { projectId: clip.projectId, languageVariant: clip.languageVariant, index: { gt: clip.index } },
    orderBy: { index: "desc" },
  });
  for (const later of laterClips) {
    await prisma.clip.update({ where: { id: later.id }, data: { index: later.index + 1 } });
  }

  const first = await updateClipDialogue(clip.id, firstText);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: clip.projectId } });
  const settings = await getSettings();
  const wpm = wpmForPace(settings, project.speechPace);
  const secondWords = countWords(secondText);
  const lastSentence = splitIntoSentences(secondText).pop() ?? "";
  const hook = detectHook(lastSentence);
  const second = await prisma.clip.create({
    data: {
      projectId: clip.projectId,
      languageVariant: clip.languageVariant,
      index: clip.index + 1,
      dialogue: secondText,
      estimatedWords: secondWords,
      estimatedDurationSeconds: Number(((secondWords / wpm) * 60).toFixed(1)),
      hasHook: hook.hasHook,
      curiosityScore: hook.score,
      status: "draft",
    },
  });
  await persistClipsJson(clip.projectId);
  await recordEvent({ projectId: clip.projectId, step: "clips", message: `Klip ${clip.index} ikiye bolundu` });
  return [first, second];
}

/** Siralamayi degistirir (id listesi yeni sirayi belirtir). */
export async function reorderClips(projectId: string, orderedClipIds: string[]): Promise<void> {
  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant: "primary" } });
  const byId = new Map(clips.map((c) => [c.id, c]));
  if (orderedClipIds.length !== clips.length || orderedClipIds.some((id) => !byId.has(id))) {
    throw new Error("Siralama listesi klip setiyle eslesmiyor");
  }
  // Once negatif gecici indexlere tasiyarak unique kisitini koru
  for (let i = 0; i < orderedClipIds.length; i++) {
    await prisma.clip.update({ where: { id: orderedClipIds[i] }, data: { index: -(i + 1) } });
  }
  for (let i = 0; i < orderedClipIds.length; i++) {
    await prisma.clip.update({ where: { id: orderedClipIds[i] }, data: { index: i + 1 } });
  }
  await persistClipsJson(projectId);
  await recordEvent({ projectId, step: "clips", message: "Klip siralamasi guncellendi" });
}

async function renumberClips(projectId: string, languageVariant: string): Promise<void> {
  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant }, orderBy: { index: "asc" } });
  for (let i = 0; i < clips.length; i++) {
    if (clips[i].index !== i + 1) {
      await prisma.clip.update({ where: { id: clips[i].id }, data: { index: -(i + 1) } });
    }
  }
  const renumbered = await prisma.clip.findMany({ where: { projectId, languageVariant }, orderBy: { index: "desc" } });
  for (const clip of renumbered) {
    if (clip.index < 0) {
      await prisma.clip.update({ where: { id: clip.id }, data: { index: -clip.index } });
    }
  }
}

/** Silinmis CharacterProfile'a kalan clip.characterId — SQLite her update'te FK kirar. */
export async function scrubOrphanClipCharacterIds(projectId: string): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE "Clip"
    SET "characterId" = NULL
    WHERE "projectId" = ${projectId}
      AND "characterId" IS NOT NULL
      AND "characterId" NOT IN (SELECT "id" FROM "CharacterProfile")
  `;
  return typeof result === "number" ? result : 0;
}

function isPrismaFkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Foreign key constraint|foreign key/i.test(msg);
}

/** Clip guncelle: FK kirilirsa characterId temizleyip tekrarla — toplu prompt hic dusmesin. */
async function safeUpdateClip(
  clipId: string,
  data: { shotType?: string; characterId?: string | null; imagePrompt?: string; prompt?: string; status?: string; sceneDescription?: string; emotionLabel?: string }
): Promise<Clip> {
  try {
    return await prisma.clip.update({ where: { id: clipId }, data });
  } catch (err) {
    if (!isPrismaFkError(err)) throw err;
    await prisma.$executeRaw`UPDATE "Clip" SET "characterId" = NULL WHERE "id" = ${clipId}`;
    const { characterId: _drop, ...rest } = data;
    return prisma.clip.update({
      where: { id: clipId },
      data: { ...rest, characterId: null },
    });
  }
}

/** Tum klipler icin Flow promptlarini uretir ve dosyalara yazar.
 * KOK GARANTI: OpenAI yok, sahne yoksa yerel yedek, orphan FK temizlenir,
 * gecerli olmayan characterId yazilmaz — toplu uretim FK/sahne yuzunden dusmez.
 */
export async function buildPromptsForProject(projectId: string, languageVariant = "primary"): Promise<Clip[]> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  await scrubOrphanClipCharacterIds(projectId);

  const character = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant }, orderBy: { index: "asc" } });
  if (clips.length === 0) throw new Error("Prompt uretilecek klip yok");

  const root = ensureProjectDirs(project.slug);
  const promptsDir = path.join(root, "prompts");
  const cast = await prisma.characterProfile.findMany({ where: { projectId } });
  const castById = new Map(cast.map((c) => [c.id, c]));
  const sideCast = cast.filter((c) => c.role === "side");
  const storyGearLock = "";
  let localSceneFills = 0;

  if (project.templateType === "narrator") {
    const {
      findNarratorCastInText,
      NARRATOR_VOICE_OVER_ONLY,
      buildLocalNarratorSceneFallback,
      resolveCachedNarratorWorldLock,
    } = await import("@/server/services/narrator-film");
    const worldLock = resolveCachedNarratorWorldLock(project.slug);

    for (const clip of clips) {
      if (clip.status === "completed") continue;

      // Orphan / yanlis characterId bellegini temizle
      if (clip.characterId && !castById.has(clip.characterId)) {
        clip.characterId = null;
      }

      let shotType = clip.shotType;
      if (NARRATOR_VOICE_OVER_ONLY && shotType === "narrator") shotType = "cutaway";

      if (!clip.sceneDescription?.trim()) {
        const hintMember = findNarratorCastInText(clip.dialogue || "", sideCast)[0];
        const filled = buildLocalNarratorSceneFallback({
          dialogue: clip.dialogue,
          clipSeconds: project.clipSeconds,
          worldLock,
          castHint: hintMember?.name,
        });
        await safeUpdateClip(clip.id, {
          shotType,
          sceneDescription: filled.sceneDescription,
          imagePrompt: filled.imagePrompt,
          emotionLabel: filled.emotionLabel || clip.emotionLabel || "gergin",
          characterId: shotType === "narrator" ? null : hintMember?.id ?? null,
        });
        clip.shotType = shotType;
        clip.sceneDescription = filled.sceneDescription;
        clip.imagePrompt = filled.imagePrompt;
        clip.emotionLabel = filled.emotionLabel || clip.emotionLabel || "gergin";
        clip.characterId = shotType === "narrator" ? null : hintMember?.id ?? null;
        localSceneFills++;
        continue;
      }

      if (shotType === "narrator") {
        if (clip.characterId || shotType !== clip.shotType) {
          await safeUpdateClip(clip.id, { shotType, characterId: null });
          clip.shotType = shotType;
          clip.characterId = null;
        }
        continue;
      }

      if (sideCast.length === 0) {
        if (shotType !== clip.shotType) {
          await safeUpdateClip(clip.id, { shotType });
          clip.shotType = shotType;
        }
        continue;
      }

      const hay = `${clip.sceneDescription || ""}\n${clip.imagePrompt || ""}\n${clip.dialogue || ""}`;
      const member =
        (clip.characterId && castById.has(clip.characterId)
          ? sideCast.find((c) => c.id === clip.characterId)
          : undefined) || findNarratorCastInText(hay, sideCast)[0];
      const nextId = member && castById.has(member.id) ? member.id : null;
      if (shotType !== clip.shotType || (clip.characterId || null) !== nextId) {
        await safeUpdateClip(clip.id, { shotType, characterId: nextId });
        clip.shotType = shotType;
        clip.characterId = nextId;
      }
    }
  }

  const timeTravel =
    project.templateType === "time_travel" ? await import("@/server/services/time-travel") : null;
  const companion = timeTravel ? cast.find(timeTravel.isTimeTravelCompanion) ?? null : null;

  const updated: Clip[] = [];
  for (const clip of clips) {
    // Gecerli olmayan characterId ile prompt yazma / update FK kirilmasin
    if (clip.characterId && !castById.has(clip.characterId)) {
      clip.characterId = null;
    }
    if (timeTravel) {
      const previous =
        clip.index > 1 ? clips.find((c) => c.index === clip.index - 1 && c.languageVariant === clip.languageVariant) ?? null : null;
      const prompt = stampNoOnscreenTextLock(
        timeTravel.buildTimeTravelClipPrompt({
          project,
          host: character,
          companion,
          local: clip.characterId ? castById.get(clip.characterId) ?? null : null,
          clip,
          previousClip: previous,
        })
      );
      const saved = await safeUpdateClip(clip.id, {
        prompt,
        status: clip.status === "draft" ? "pending" : clip.status,
      });
      fs.writeFileSync(path.join(promptsDir, `${String(clip.index).padStart(3, "0")}.txt`), prompt, "utf8");
      updated.push(saved);
      continue;
    }
    const sceneCharacter = clip.characterId ? (castById.get(clip.characterId) ?? null) : null;
    const kidsCast =
      project.templateType === "kids_animation" ? kidsPromptCast(cast, sceneCharacter, character) : null;
    const supportingCast = kidsCast
      ? kidsCast.supporting
      : project.templateType === "narrator"
        ? narratorSupportingCastForPrompt(cast, clip, sceneCharacter)
        : [];
    const previousClip =
      clip.index > 1
        ? clips.find((c) => c.index === clip.index - 1 && c.languageVariant === clip.languageVariant) ?? null
        : null;

    let imagePrompt = clip.imagePrompt;
    if (project.templateType === "narrator") {
      imagePrompt = stripEmbeddedOnscreenTextTails(imagePrompt || "");
    }

    const prompt = stampNoOnscreenTextLock(
      buildClipPrompt({
        project,
        character: kidsCast?.hero ?? character,
        clip: { ...clip, imagePrompt },
        sceneCharacter: kidsCast?.hero ?? sceneCharacter,
        supportingCast,
        isFirstClip: clip.index === 1,
        previousClip,
        storyGearLock,
      })
    );

    const saved = await safeUpdateClip(clip.id, {
      ...(imagePrompt !== clip.imagePrompt ? { imagePrompt } : {}),
      prompt,
      status: clip.status === "draft" ? "pending" : clip.status,
    });
    fs.writeFileSync(path.join(promptsDir, `${String(clip.index).padStart(3, "0")}.txt`), prompt, "utf8");
    updated.push(saved);
  }

  await prisma.project.update({ where: { id: projectId }, data: { status: "prompts_ready" } });
  publishEvent(projectId, { type: "project", payload: { id: projectId, status: "prompts_ready" } });
  await recordEvent({
    projectId,
    step: "prompts",
    message:
      localSceneFills > 0
        ? `${updated.length} klip promptu uretildi (${localSceneFills} sahne yerel yedek — istege bagli Film planini yenile)`
        : `${updated.length} klip icin Flow promptu uretildi`,
  });

  const emptyDialogue = updated.filter((c) => !c.dialogue.trim()).length;
  if (emptyDialogue > 0) {
    await recordEvent({
      projectId,
      step: "prompts",
      level: "warning",
      message: `DIKKAT: ${emptyDialogue} klibin metni bos. ${emptyDialogueHint(project.templateType)}`,
    });
  }
  return updated;
}

/** Kadro yuzlerini yeniler, sahne kilitlerini yazar, tum Flow promptlarini uretir. */
export async function refreshNarratorFacesAndPrompts(projectId: string): Promise<Clip[]> {
  const { rewriteCastLooksForNewFaces } = await import("@/server/services/cast");
  const faces = await rewriteCastLooksForNewFaces(projectId);
  await recomposeNarratorImagePrompts(projectId);
  await recordEvent({
    projectId,
    step: "prompts",
    message: `${faces} kadro yuzu yenilendi — dogal guzel hanimefendi yuz + zarif kiyafet`,
  });
  return buildPromptsForProject(projectId);
}

async function recomposeNarratorImagePrompts(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.templateType !== "narrator") return;
  const { composeNarratorFilmImagePrompt, resolveCachedNarratorWorldLock } = await import(
    "@/server/services/narrator-film"
  );
  const worldLock = resolveCachedNarratorWorldLock(project.slug);
  const clips = await prisma.clip.findMany({
    where: { projectId, languageVariant: "primary" },
    orderBy: { index: "asc" },
  });
  const cast = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (clip.status === "completed") continue;
    const prev = i > 0 ? clips[i - 1] : undefined;
    const onScreen = onScreenCastForClipBeat(clip.dialogue || "", cast, prev?.dialogue);
    const onScreenCastLock = onScreen.length
      ? onScreen
          .map((m, idx) => {
            const tag = idx === 0 ? "LEAD" : "ALSO";
            const look = (m.baseAppearancePrompt || m.name).slice(0, 140);
            const wardrobe = m.baseWardrobePrompt ? ` | ${m.baseWardrobePrompt.slice(0, 70)}` : "";
            return `${tag} ${m.name}: ${look}${wardrobe}`;
          })
          .join(" ")
      : "No featured portrait; distant extras only.";
    const imagePrompt = composeNarratorFilmImagePrompt({
      worldLock,
      sceneDescription: clip.sceneDescription || clip.dialogue,
      dialogue: clip.dialogue,
      clipSeconds: project.clipSeconds || 8,
      previousScene: prev?.sceneDescription || "",
      previousShotType: prev?.shotType || "",
      shotType: "cutaway",
      onScreenCastLock,
      emotion: clip.emotionLabel,
    });
    await safeUpdateClip(clip.id, { imagePrompt, prompt: "" });
  }
}

/** Tek klip icin promptu yeniden uretir. */
export async function rebuildClipPrompt(clipId: string): Promise<Clip> {
  const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });
  await scrubOrphanClipCharacterIds(clip.projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: clip.projectId } });
  const character = await prisma.characterProfile.findFirst({ where: { projectId: clip.projectId, role: "main" } });
  const allCast = await prisma.characterProfile.findMany({ where: { projectId: clip.projectId } });
  const castById = new Map(allCast.map((c) => [c.id, c]));
  let working = clip;
  if (working.characterId && !castById.has(working.characterId)) {
    working = await safeUpdateClip(working.id, { characterId: null });
  }
  if (project.templateType === "time_travel") {
    const timeTravel = await import("@/server/services/time-travel");
    const previous =
      working.index > 1
        ? await prisma.clip.findFirst({
            where: { projectId: working.projectId, languageVariant: working.languageVariant, index: working.index - 1 },
          })
        : null;
    const prompt = stampNoOnscreenTextLock(
      timeTravel.buildTimeTravelClipPrompt({
        project,
        host: character,
        companion: allCast.find(timeTravel.isTimeTravelCompanion) ?? null,
        local: working.characterId ? castById.get(working.characterId) ?? null : null,
        clip: working,
        previousClip: previous,
      })
    );
    const root = ensureProjectDirs(project.slug);
    fs.writeFileSync(path.join(root, "prompts", `${String(working.index).padStart(3, "0")}.txt`), prompt, "utf8");
    return safeUpdateClip(clipId, { prompt });
  }
  if (project.templateType === "narrator" && !working.sceneDescription?.trim()) {
    const { buildLocalNarratorSceneFallback, findNarratorCastInText, resolveCachedNarratorWorldLock, NARRATOR_VOICE_OVER_ONLY } =
      await import("@/server/services/narrator-film");
    const sideCast = allCast.filter((c) => c.role === "side");
    const hintMember = findNarratorCastInText(working.dialogue || "", sideCast)[0];
    const shotType = NARRATOR_VOICE_OVER_ONLY ? "cutaway" : working.shotType;
    const filled = buildLocalNarratorSceneFallback({
      dialogue: working.dialogue,
      clipSeconds: project.clipSeconds,
      worldLock: resolveCachedNarratorWorldLock(project.slug),
      castHint: hintMember?.name,
    });
    working = await safeUpdateClip(working.id, {
      shotType,
      sceneDescription: filled.sceneDescription,
      imagePrompt: filled.imagePrompt,
      emotionLabel: filled.emotionLabel,
      characterId: hintMember?.id ?? null,
    });
  }
  const sceneCharacter = working.characterId ? (castById.get(working.characterId) ?? null) : null;
  const kidsCast =
    project.templateType === "kids_animation" ? kidsPromptCast(allCast, sceneCharacter, character) : null;
  const supportingCast = kidsCast
    ? kidsCast.supporting
    : project.templateType === "narrator"
      ? narratorSupportingCastForPrompt(allCast, working, sceneCharacter)
      : [];
  const previousClip =
    working.index > 1
      ? await prisma.clip.findFirst({
          where: { projectId: working.projectId, languageVariant: working.languageVariant, index: working.index - 1 },
        })
      : null;
  const storyGearLock = "";
  let imagePrompt = working.imagePrompt;
  if (project.templateType === "narrator") {
    imagePrompt = stripEmbeddedOnscreenTextTails(imagePrompt || "");
  }
  const prompt = stampNoOnscreenTextLock(
    buildClipPrompt({
      project,
      character: kidsCast?.hero ?? character,
      clip: { ...working, imagePrompt },
      sceneCharacter: kidsCast?.hero ?? sceneCharacter,
      supportingCast,
      isFirstClip: working.index === 1,
      previousClip,
      storyGearLock,
    })
  );
  const root = ensureProjectDirs(project.slug);
  fs.writeFileSync(path.join(root, "prompts", `${String(working.index).padStart(3, "0")}.txt`), prompt, "utf8");
  return safeUpdateClip(clipId, {
    ...(imagePrompt !== working.imagePrompt ? { imagePrompt } : {}),
    prompt,
  });
}

/** clips.json dosyasini proje klasorune yazar. */
export async function persistClipsJson(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return;
  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant: "primary" }, orderBy: { index: "asc" } });
  const root = ensureProjectDirs(project.slug);
  fs.writeFileSync(
    path.join(root, "clips.json"),
    JSON.stringify(
      clips.map((c) => ({
        index: c.index,
        dialogue: c.dialogue,
        estimatedWords: c.estimatedWords,
        estimatedDurationSeconds: c.estimatedDurationSeconds,
        status: c.status,
        flowPrompt: c.prompt,
        attemptCount: c.attemptCount,
        videoPath: c.videoPath,
        lastFramePath: c.lastFramePath,
        errorMessage: c.errorMessage,
      })),
      null,
      2
    ),
    "utf8"
  );
}

/** CSV disa aktarma (Excel uyumlu, UTF-8 BOM'lu). */
export async function exportClipsCsv(projectId: string): Promise<string> {
  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant: "primary" }, orderBy: { index: "asc" } });
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = ["index", "dialogue", "estimatedWords", "estimatedDurationSeconds", "status", "attemptCount", "videoPath", "errorMessage"];
  const rows = clips.map((c) =>
    [
      c.index,
      escape(c.dialogue),
      c.estimatedWords,
      c.estimatedDurationSeconds,
      escape(c.status),
      c.attemptCount,
      escape(c.videoPath ?? ""),
      escape(c.errorMessage ?? ""),
    ].join(",")
  );
  return "\uFEFF" + [header.join(","), ...rows].join("\r\n");
}

/** JSON disa aktarma. */
export async function exportClipsJson(projectId: string): Promise<string> {
  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant: "primary" }, orderBy: { index: "asc" } });
  return JSON.stringify(
    clips.map((c) => ({
      index: c.index,
      dialogue: c.dialogue,
      estimatedWords: c.estimatedWords,
      estimatedDurationSeconds: c.estimatedDurationSeconds,
      status: c.status,
      flowPrompt: c.prompt,
      attemptCount: c.attemptCount,
      videoPath: c.videoPath,
      lastFramePath: c.lastFramePath,
      errorMessage: c.errorMessage,
    })),
    null,
    2
  );
}

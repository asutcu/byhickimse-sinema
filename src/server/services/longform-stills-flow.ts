import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Clip, Project } from "@prisma/client";
import { prisma } from "@/server/db";
import { recordEvent } from "@/server/lib/logger";
import { engineStatus } from "@/server/automation/engine";
import {
  configureImageGeneration,
  ensureFlowReady,
  enterPrompt,
  fetchGeneratedImage,
  forceImageOutputMode,
  imageLooksLikeCharacterSheet,
  openFlowProject,
  bindFlowProjectToOpenPage,
  PolicyBlockedError,
  resetImageComposer,
  returnToVideoComposer,
  snapshotImageSources,
  startGeneration,
  switchOutputType,
  uploadReferenceImages,
  waitForNewComposerImage,
} from "@/server/automation/flow-adapter";
import { releaseProjectPage } from "@/server/automation/browser";
import { bufferLooksLikeCharacterSheet, bufferLooksLikeStorySlide, readImageDimensions } from "@/lib/still-sheet-detect";
import { rewritePromptAfterPolicyBlock } from "@/lib/flow-prompt-safety";
import { getSettings } from "@/server/services/settings";
import { assertLongformContinuing } from "@/server/services/longform-jobs";

/** Flow jpg/webp de verebilir; dosya adi gercek bicime gore yazilir. */
function imageExtensionFromBuffer(buffer: Buffer): string {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return ".png";
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return ".jpg";
  if (buffer.length > 12 && buffer.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return ".png";
}

/** Ayni beat icin eski uzantili kalintilari temizler (001.png / 001.jpg birlikte kalmasin). */
function writeStillFile(stillPathPng: string, buffer: Buffer): string {
  const dir = path.dirname(stillPathPng);
  fs.mkdirSync(dir, { recursive: true });
  const base = stillPathPng.replace(/\.[a-z0-9]+$/i, "");
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    fs.rmSync(`${base}${ext}`, { force: true });
  }
  const finalPath = `${base}${imageExtensionFromBuffer(buffer)}`;
  fs.writeFileSync(finalPath, buffer);
  return finalPath;
}

function stillContentHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function loadExistingStillHashes(dir: string): Set<string> {
  const hashes = new Set<string>();
  if (!fs.existsSync(dir)) return hashes;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith("_")) continue;
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    try {
      hashes.add(stillContentHash(fs.readFileSync(path.join(dir, name))));
    } catch {
      /* okuma hatasi — kopya kontrolu atlanir */
    }
  }
  return hashes;
}

async function pauseBetweenStills(projectId: string): Promise<void> {
  // Kareler arasi kisa bekleme — Flow kota / UI kilitlenmesin.
  const settings = await getSettings();
  const waitMs = Math.max(0, Math.min(settings.waitBetweenGenerationsMs || 0, 30_000));
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    assertLongformContinuing(projectId);
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, until - Date.now())));
  }
}

/**
 * Duragan kareleri Flow gorsel modunda (Nano Banana Pro) SIRAYLA uretir.
 *
 * Tek Flow sekmesi paylasildigi icin paralel uretim yok. Her kare kendi
 * beat'ine (clip.sceneImagePath) yazilir; boylece "Konusmaya gore gorseller"
 * listesinde dogru sirada gorunur ve slayt montaji ayni sirayi kullanir.
 * Iptal bekleme sirasinda da islenir; bir kare patlarsa digerleri devam eder.
 */
export async function generateLongformStillsWithFlow(input: {
  project: Project;
  clips: Clip[];
  imageModel: string;
  promptFor: (clip: Clip) => string;
  stillPathFor: (clip: Clip) => string;
  referencesFor?: (clip: Clip) => string[];
  onProgress: (done: number, failed: number, currentIndex?: number) => void;
}): Promise<number[]> {
  const { project, clips, imageModel, promptFor, stillPathFor, referencesFor, onProgress } = input;
  if (engineStatus(project.id).loopAlive) {
    throw new Error(
      "Bu projenin Flow otomasyonu calisiyor. Gorsel slayt icin Flow kullanmadan once otomasyonu durdurun."
    );
  }

  const pending = clips.filter((clip) => !(clip.sceneImagePath && fs.existsSync(clip.sceneImagePath)));
  if (pending.length === 0) return [];

  let page = await ensureFlowReady(project.id, project.flowProjectUrl);
  const shoot: Project = {
    ...project,
    flowImageModel: imageModel,
    aspectRatio: "16:9",
    audioEnabled: false,
    outputsPerGeneration: 1,
  };
  const openAndConfigure = async () => {
    await openFlowProject(page, project);
    await bindFlowProjectToOpenPage(project, page);
    shoot.flowProjectUrl = project.flowProjectUrl;
    shoot.reuseFlowProject = project.reuseFlowProject;
    // Karakter sheet sonrasi Nano Banana /edit/ ekraninda kalinir; kare
    // uretimi prompt cubugunun oldugu proje kokune donup gorsel moda kilitlenir.
    await resetImageComposer(page, shoot, imageModel);
    await configureImageGeneration(page, shoot, imageModel);
  };
  await openAndConfigure();
  await recordEvent({
    projectId: project.id,
    step: "longform",
    message: `Gorseller Flow ile uretilecek: ${imageModel} · ${pending.length} kare (sirayla, her kare kendi beat'ine yazilir)`,
  });

  const failed: number[] = [];
  let done = clips.length - pending.length;
  onProgress(done, 0);

  const stillsDir = path.dirname(stillPathFor(clips[0]));
  const seenHashes = loadExistingStillHashes(stillsDir);

  const captureOne = async (clip: Clip, policyStage: number): Promise<void> => {
    // Flow, uretilen kareyi secip istemi "duzenleme" kutusuna cevirebiliyor;
    // her kareden once temiz metinden-goruntuye durumuna donulur.
    await resetImageComposer(page, shoot, imageModel);
    const refs = (referencesFor?.(clip) || []).filter((p) => p && fs.existsSync(p));
    const skipRefs = policyStage >= 1;
    if (refs.length > 0 && !skipRefs) {
      const uploaded = await uploadReferenceImages(page, shoot, refs);
      await forceImageOutputMode(page, shoot);
      await recordEvent({
        projectId: project.id,
        clipId: clip.id,
        step: "longform",
        message: `Kare ${clip.index}: ${uploaded} karakter sheet isteme eklendi`,
      });
    }
    const before = await snapshotImageSources(page);
    const raw = promptFor(clip);
    await enterPrompt(page, shoot, rewritePromptAfterPolicyBlock(raw, policyStage));
    await startGeneration(page, shoot, "auto", { output: "image" });
    const found = await waitForNewComposerImage(page, shoot, before, {
      timeoutMs: 180_000,
      onPoll: () => assertLongformContinuing(project.id),
      rejectBuffer: (buf) => seenHashes.has(stillContentHash(buf)) || bufferLooksLikeCharacterSheet(buf),
    });
    const buffer = await fetchGeneratedImage(page, found.locator, found.src);
    if (buffer.length < 5_000) throw new Error("Indirilen gorsel bos/bozuk gorunuyor");
    if (bufferLooksLikeCharacterSheet(buffer) || (await imageLooksLikeCharacterSheet(page, buffer))) {
      throw new Error("Uretilen kare karakter sheet / turnaround kopyasi — sahne degil");
    }
    const dims = readImageDimensions(buffer);
    if (!bufferLooksLikeStorySlide(buffer)) {
      throw new Error(
        `Uretilen kare slayt orani degil (${dims ? `${dims.w}×${dims.h}` : "boyut okunamadi"}) — 16:9 sahne bekleniyor`
      );
    }
    const hash = stillContentHash(buffer);
    if (seenHashes.has(hash)) {
      throw new Error("Uretilen kare onceki slaytin birebir kopyasi — kutuphanede eski varlik");
    }
    const stillPath = writeStillFile(stillPathFor(clip), buffer);
    seenHashes.add(hash);
    await prisma.clip.update({
      where: { id: clip.id },
      data: { sceneImagePath: stillPath, status: "pending", errorMessage: null },
    });
  };

  // Tarayici/sekme kapanmasi OLUMCUL bir durumdur: kare kare harcamak yerine
  // tarayici yeniden acilir; olmuyorsa uretim net bir hatayla durdurulur.
  const FATAL_PAGE_RE =
    /Target page, context or browser has been closed|browser has been closed|Target closed|page has been closed|browserContext\.newPage|browser\.newContext/i;
  let browserReinitBudget = 3;
  // Ust uste cok kare patliyorsa (tarayici bozuk, oturum dusmus vb.) 74 kareyi
  // tek tek harcamak anlamsiz — sigorta atar, "devam et" temiz baslatir.
  let consecutiveFails = 0;
  const MAX_CONSECUTIVE_FAILS = 6;

  const reopenBrowser = async (reason: string): Promise<void> => {
    if (browserReinitBudget <= 0) {
      throw new Error(
        `Flow tarayicisi tekrar tekrar kapandi (${reason.slice(0, 120)}). Uretim durduruldu — tarayiciyi acik birakin ve "Kaldigi yerden devam et" ile surdurun.`
      );
    }
    browserReinitBudget -= 1;
    await recordEvent({
      projectId: project.id,
      step: "longform",
      level: "warning",
      message: `Flow tarayicisi kapanmis — yeniden aciliyor (kalan hak: ${browserReinitBudget})`,
    });
    page = await ensureFlowReady(project.id, project.flowProjectUrl);
    await openAndConfigure();
  };

  try {
    let policyFloor = 0;
    for (const clip of pending) {
      assertLongformContinuing(project.id);
      onProgress(done, failed.length, clip.index);
      const MAX_ATTEMPTS = 4;
      let saved = false;
      let policyStage = policyFloor;
      let lastError = "";
      if (policyFloor > 0) {
        await recordEvent({
          projectId: project.id,
          clipId: clip.id,
          step: "longform",
          level: "warning",
          message: `Kare ${clip.index}: onceki politika reddi nedeniyle kademe ${policyFloor} ile basliyor (yuz sheet yok)`,
        });
      }
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !saved; attempt += 1) {
        try {
          await captureOne(clip, policyStage);
          saved = true;
          done += 1;
          consecutiveFails = 0;
          if (done === 1 || done % 10 === 0 || clip.index === pending[pending.length - 1].index) {
            await recordEvent({
              projectId: project.id,
              step: "longform",
              message: `Flow karesi hazir: #${clip.index} (${done}/${clips.length})`,
            });
          }
        } catch (err) {
          assertLongformContinuing(project.id);
          const message = err instanceof Error ? err.message : String(err);

          // Tarayici kapandiysa: ayni kareyi harcamadan tarayiciyi yeniden ac,
          // ayni denemeyi tekrarla. Yeniden acilamazsa reopenBrowser firlatir.
          if (FATAL_PAGE_RE.test(message)) {
            await reopenBrowser(message);
            attempt -= 1;
            continue;
          }

          const isPolicy = err instanceof PolicyBlockedError;
          if (isPolicy) {
            policyStage = Math.min(policyStage + 1, 3);
            if (policyStage > policyFloor) {
              policyFloor = policyStage;
            }
          }
          lastError = message;
          if (/karakter sheet|turnaround|katalog/i.test(message)) {
            policyStage = Math.min(Math.max(policyStage, 1) + (attempt > 1 ? 1 : 0), 3);
          }
          const policyHint =
            policyStage <= 1
              ? "yumusatilip tekrar deneniyor"
              : policyStage === 2
                ? "isimsiz + referanssiz deneniyor"
                : "SAHNE DEGISTI: yuzsuz kurgu (el / obje / siluet) deneniyor";
          await recordEvent({
            projectId: project.id,
            step: "longform",
            level: attempt < MAX_ATTEMPTS ? "warning" : "error",
            message: `Kare ${clip.index} ${
              attempt < MAX_ATTEMPTS
                ? isPolicy
                  ? `politika reddi — ${policyHint}`
                  : "tekrar deneniyor"
                : "basarisiz — atlandi, sonraki kareye geciliyor"
            } (${attempt}/${MAX_ATTEMPTS}): ${message}`.slice(0, 240),
          });
          await returnToVideoComposer(page, shoot).catch(() => {});
        }
      }
      if (!saved) {
        failed.push(clip.index);
        consecutiveFails += 1;
        await prisma.clip
          .update({ where: { id: clip.id }, data: { errorMessage: lastError.slice(0, 500) } })
          .catch(() => {});
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
          throw new Error(
            `${MAX_CONSECUTIVE_FAILS} kare ust uste basarisiz (${lastError.slice(0, 120)}). Uretim durduruldu — sorun cozulunce "Kaldigi yerden devam et" hazir kareleri atlayip surdurur.`
          );
        }
      }
      onProgress(done, failed.length);
      await pauseBetweenStills(project.id);
    }
  } finally {
    // Klip otomasyonu video modunda calisir; Flow'u gorsel modunda birakma.
    await switchOutputType(page, project, "video").catch(() => {});
    // Sekme sahipligini birak: aksi halde bu proje ana sekmeyi surekli tutar ve
    // sonraki isler gereksiz yeni sekme aciyordu.
    await releaseProjectPage(project.id).catch(() => {});
  }

  return failed;
}

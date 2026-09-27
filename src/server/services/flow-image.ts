import fs from "node:fs";
import type { Project } from "@prisma/client";
import { prisma } from "@/server/db";
import { recordEvent } from "@/server/lib/logger";
import { engineStatus } from "@/server/automation/engine";
import { getLongformJob } from "@/server/services/longform-jobs";
import {
  configureImageGeneration,
  enterPrompt,
  ensureFlowReady,
  fetchGeneratedImage,
  forceImageOutputMode,
  openFlowProject,
  PolicyBlockedError,
  resetImageComposer,
  snapshotImageSources,
  startGeneration,
  switchOutputType,
  uploadReferenceImages,
  waitForNewComposerImage,
} from "@/server/automation/flow-adapter";
import { clampPromptForFlowBox } from "@/lib/flow-prompt-compact";
import { resolveFlowImageModel } from "@/lib/flow-generation-settings";
import { hydrateProjectFlowImageModel } from "@/server/lib/flow-image-model-store";
import { rewritePromptAfterPolicyBlock, sanitizeCelebrityLikenessForFlow } from "@/lib/flow-prompt-safety";
import { bufferLooksLikeCharacterSheet } from "@/lib/still-sheet-detect";

/**
 * TEK GORSEL MOTORU: sitedeki her resim uretimi Flow gorsel modunda
 * Nano Banana Pro ile yapilir. OpenAI (gpt-image-1) resim yolu yoktur.
 *
 * Flow tek sekme paylasir; otomasyon veya gorsel slayt calisirken buradan
 * uretim yapilamaz — cakisma sessizce bozuk kare uretmesin diye net hata.
 */
export class FlowImageBusyError extends Error {
  constructor(what: string) {
    super(
      `${what} calisiyor (ayni Flow sekmesi kullaniliyor). Nano Banana Pro ile yeni gorsel uretmek icin once onun bitmesini bekleyin veya durdurun.`
    );
    this.name = "FlowImageBusyError";
  }
}

/** Flow sekmesi bu proje icin serbest mi. */
export function assertFlowImageIdle(projectId: string): void {
  if (engineStatus(projectId).loopAlive) throw new FlowImageBusyError("Bu projenin Flow otomasyonu");
  const job = getLongformJob(projectId);
  if (job && !job.finishedAt && job.phase !== "failed" && job.phase !== "cancelled" && job.phase !== "done") {
    throw new FlowImageBusyError("Bu projenin gorsel slayt uretimi");
  }
}

/**
 * Flow gorsel modunda (Nano Banana Pro) tek kare uretir ve tamponu dondurur.
 * Politika reddinde istem bir kez yumusatilip tekrar denenir.
 */
export async function generateFlowImageBuffer(input: {
  projectId: string;
  prompt: string;
  aspect?: "16:9" | "9:16";
  step?: "publish" | "character" | "longform" | "flow";
  label?: string;
  /** Gercek kadro sheet'leri — yeni yuz uydurulmasin */
  referenceImagePaths?: string[];
}): Promise<Buffer> {
  const { projectId, prompt } = input;
  const step = input.step ?? "flow";
  const label = input.label?.trim() || "gorsel";
  if (!prompt.trim()) throw new Error("Gorsel istemi bos");
  assertFlowImageIdle(projectId);

  const project = await hydrateProjectFlowImageModel(
    await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
  );
  const imageModel = resolveFlowImageModel(project);
  const shoot: Project = {
    ...project,
    flowImageModel: imageModel,
    aspectRatio: input.aspect ?? "16:9",
    audioEnabled: false,
    outputsPerGeneration: 1,
  };

  const page = await ensureFlowReady(projectId, project.flowProjectUrl);
  await openFlowProject(page, shoot);

  // Kapak/tek kare de ayni "taninmis kisiler" suzgecine takiliyor — unlu-dili gonderimden once sokulur.
  let text = clampPromptForFlowBox(sanitizeCelebrityLikenessForFlow(prompt));
  try {
    await configureImageGeneration(page, shoot, imageModel);
    await forceImageOutputMode(page, shoot);
    await recordEvent({
      projectId,
      step,
      message: `${label} Flow gorsel modunda uretiliyor (${imageModel})`,
    });

    const runOnce = async () => {
      const refs = (input.referenceImagePaths || []).filter((p) => p && fs.existsSync(p));
      if (refs.length > 0) {
        const uploaded = await uploadReferenceImages(page, shoot, refs);
        await forceImageOutputMode(page, shoot);
        await recordEvent({
          projectId,
          step,
          message: `${label}: ${uploaded} kadro sheet istemine eklendi`,
        });
      }
      const before = await snapshotImageSources(page);
      await enterPrompt(page, shoot, text);
      await forceImageOutputMode(page, shoot);
      await startGeneration(page, shoot, "auto", { output: "image" });
      return waitForNewComposerImage(page, shoot, before);
    };

    let found: Awaited<ReturnType<typeof waitForNewComposerImage>> | undefined;
    let lastErr: unknown;
    for (let policyStage = 0; policyStage <= 3; policyStage += 1) {
      if (policyStage > 0) {
        if (lastErr instanceof PolicyBlockedError) {
          text = clampPromptForFlowBox(rewritePromptAfterPolicyBlock(text, policyStage));
        } else if (policyStage > 1) {
          throw lastErr;
        }
        await recordEvent({
          projectId,
          step,
          level: "warning",
          message: `${label} tekrar deneniyor (kademe ${policyStage}). ${
            lastErr instanceof Error ? lastErr.message.slice(0, 140) : String(lastErr)
          }`,
        });
        await resetImageComposer(page, shoot, imageModel);
        await configureImageGeneration(page, shoot, imageModel);
      }
      try {
        found = await runOnce();
        break;
      } catch (err) {
        lastErr = err;
        if (policyStage >= 3) throw err;
        if (!(err instanceof PolicyBlockedError) && policyStage >= 1) throw err;
      }
    }
    if (!found) throw lastErr instanceof Error ? lastErr : new Error(`${label} uretilemedi`);

    const buffer = await fetchGeneratedImage(page, found.locator, found.src);
    if (buffer.length < 5_000) throw new Error("Uretilen gorsel bos/bozuk gorunuyor");
    if (bufferLooksLikeCharacterSheet(buffer)) {
      throw new Error("Uretilen kare karakter sheet / gri studyo katalog karesi — sahne degil");
    }
    await recordEvent({ projectId, step, message: `${label} hazir (${imageModel}, ${buffer.length} B)` });
    return buffer;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordEvent({
      projectId,
      step,
      level: "error",
      message: `${label} uretilemedi (${imageModel}): ${message}`.slice(0, 280),
    });
    throw new Error(
      `${label} yalnizca ${imageModel} ile uretilir. ${message} ` +
        `Flow'da proje editorunun acik ve gorsel modun (Metinden goruntuye / ${imageModel}) secilebilir oldugundan emin olun.`
    );
  } finally {
    await switchOutputType(page, project, "video").catch(() => {});
  }
}

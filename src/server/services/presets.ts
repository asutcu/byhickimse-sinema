import { z } from "zod";
import type { ChannelPreset } from "@prisma/client";
import { prisma } from "@/server/db";
import { recordEvent } from "@/server/lib/logger";
import { resolveFlowImageModel } from "@/lib/flow-generation-settings";
import { persistProjectFlowImageModel } from "@/server/lib/flow-image-model-store";

/**
 * Kanal on ayarlari: karakter + stil + ses + sablon ayarlarini kaydedip
 * yeni projelere tek tikla uygulama. JSON dista/ice aktarma destekli.
 */

export const presetPayloadSchema = z.object({
  project: z.object({
    genre: z.string().default("gizem"),
    storyLanguage: z.string().default("Türkçe"),
    speechLanguage: z.string().default("Türkçe"),
    audience: z.string().default(""),
    narrationStyle: z.string().default(""),
    speechPace: z.string().default("normal"),
    templateType: z.string().default("narrator"),
    flowModel: z.string().default(""),
    flowImageModel: z.string().default(""),
    clipSeconds: z.number().int().default(8),
    aspectRatio: z.string().default("16:9"),
    audioEnabled: z.boolean().default(true),
    useReference: z.boolean().default(true),
    useFlowCharacter: z.boolean().default(true),
    useStartFrame: z.boolean().default(false),
    usePrevLastFrame: z.boolean().default(true),
    generateButtonMode: z.string().default("auto"),
    automationMode: z.string().default("full"),
    promptTemplate: z.string().default(""),
    ageBand: z.string().default(""),
    moralLesson: z.string().default(""),
    visualStyle: z.string().default(""),
    channelName: z.string().default(""),
  }),
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
      dnaCard: z.string().default("{}"),
      imagePrompt: z.string().default(""),
    })
    .nullable(),
});

export type PresetPayload = z.infer<typeof presetPayloadSchema>;

/** Mevcut projeden preset olusturur. */
export async function savePresetFromProject(projectId: string, presetName: string): Promise<ChannelPreset> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const character = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });

  const payload: PresetPayload = {
    project: {
      genre: project.genre,
      storyLanguage: project.storyLanguage,
      speechLanguage: project.speechLanguage,
      audience: project.audience,
      narrationStyle: project.narrationStyle,
      speechPace: project.speechPace,
      templateType: project.templateType,
      flowModel: project.flowModel,
      flowImageModel: project.flowImageModel,
      clipSeconds: project.clipSeconds,
      aspectRatio: project.aspectRatio,
      audioEnabled: project.audioEnabled,
      useReference: project.useReference,
      useFlowCharacter: project.useFlowCharacter,
      useStartFrame: project.useStartFrame,
      usePrevLastFrame: project.usePrevLastFrame,
      generateButtonMode: project.generateButtonMode,
      automationMode: project.automationMode,
      promptTemplate: project.promptTemplate,
      ageBand: project.ageBand,
      moralLesson: project.moralLesson,
      visualStyle: project.visualStyle,
      channelName: project.channelName,
    },
    character: character
      ? {
          name: character.name,
          age: character.age,
          nationalityLook: character.nationalityLook,
          hair: character.hair,
          faceFeatures: character.faceFeatures,
          makeup: character.makeup,
          wardrobe: character.wardrobe,
          bodyFraming: character.bodyFraming,
          sittingPose: character.sittingPose,
          gestureLevel: character.gestureLevel,
          voiceCharacter: character.voiceCharacter,
          emotionTone: character.emotionTone,
          environment: character.environment,
          lighting: character.lighting,
          cameraAngle: character.cameraAngle,
          lensLook: character.lensLook,
          background: character.background,
          negativePrompt: character.negativePrompt,
          flowCharacterReference: character.flowCharacterReference,
          dnaCard: character.dnaCard,
          imagePrompt: character.imagePrompt,
        }
      : null,
  };

  const preset = await prisma.channelPreset.upsert({
    where: { name: presetName },
    create: { name: presetName, templateType: project.templateType, payload: JSON.stringify(payload) },
    update: { templateType: project.templateType, payload: JSON.stringify(payload) },
  });
  await recordEvent({ projectId, step: "preset", message: `Kanal on ayari kaydedildi: ${presetName}` });
  return preset;
}

/** Preseti mevcut projeye uygular. */
export async function applyPresetToProject(presetId: string, projectId: string): Promise<void> {
  const preset = await prisma.channelPreset.findUniqueOrThrow({ where: { id: presetId } });
  const payload = presetPayloadSchema.parse(JSON.parse(preset.payload));

  const { flowImageModel: presetImageModel, ...projectFields } = payload.project;
  await prisma.project.update({
    where: { id: projectId },
    data: projectFields,
  });
  await persistProjectFlowImageModel(projectId, resolveFlowImageModel(presetImageModel));

  if (payload.character) {
    const existing = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
    if (existing) {
      await prisma.characterProfile.update({ where: { id: existing.id }, data: payload.character });
    } else {
      await prisma.characterProfile.create({ data: { projectId, role: "main", ...payload.character } });
    }
    // Karakter Kilidi promptlarini yeniden uret
    const { buildCharacterLock } = await import("@/server/services/character");
    const updated = await prisma.characterProfile.findFirst({ where: { projectId, role: "main" } });
    if (updated) {
      await prisma.characterProfile.update({ where: { id: updated.id }, data: buildCharacterLock(updated) });
    }
  }
  await recordEvent({ projectId, step: "preset", message: `Kanal on ayari uygulandi: ${preset.name}` });
}

/** Preset JSON'unu ice aktarir. */
export async function importPreset(name: string, templateType: string, payloadJson: string): Promise<ChannelPreset> {
  const payload = presetPayloadSchema.parse(JSON.parse(payloadJson));
  return prisma.channelPreset.upsert({
    where: { name },
    create: { name, templateType, payload: JSON.stringify(payload) },
    update: { templateType, payload: JSON.stringify(payload) },
  });
}

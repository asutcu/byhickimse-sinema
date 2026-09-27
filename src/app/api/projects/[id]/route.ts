import { z } from "zod";
import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { deleteProject } from "@/server/services/projects";
import { fitProjectDialoguesToClipBudget } from "@/server/services/clips";
import { resolveFlowImageModel } from "@/lib/flow-generation-settings";
import { persistProjectFlowImageModel, readProjectFlowImageModel, withFlowImageModel } from "@/server/lib/flow-image-model-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const { reconcileOrphanJobs } = await import("@/server/automation/engine");
    await reconcileOrphanJobs(id);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        stories: true,
        characters: { orderBy: [{ role: "asc" }, { createdAt: "asc" }] },
        clips: { where: { languageVariant: "primary" }, orderBy: { index: "asc" } },
        jobs: { orderBy: { createdAt: "desc" }, take: 5 },
        parent: { select: { id: true, name: true, filmIndex: true } },
        films: {
          orderBy: { filmIndex: "asc" },
          select: { id: true, name: true, title: true, filmIndex: true, status: true },
        },
      },
    });
    const flowImageModel = await readProjectFlowImageModel(id);
    return withFlowImageModel(project, flowImageModel);
  });
}

const patchSchema = z
  .object({
    name: z.string().min(1).max(120),
    title: z.string(),
    topic: z.string(),
    genre: z.string(),
    targetDurationSeconds: z.number().int().min(20).max(3600),
    storyLanguage: z.string(),
    speechLanguage: z.string(),
    audience: z.string(),
    narrationStyle: z.string(),
    openingHook: z.string(),
    avoidList: z.string(),
    speechPace: z.enum(["slow", "normal", "fast"]),
    targetWordCount: z.number().int().min(0),
    flowModel: z.string(),
    flowImageModel: z.string(),
    clipSeconds: z.number().int().min(2).max(20),
    aspectRatio: z.string(),
    outputsPerGeneration: z.number().int().min(1).max(4),
    audioEnabled: z.boolean(),
    useReference: z.boolean(),
    useFlowCharacter: z.boolean(),
    useStartFrame: z.boolean(),
    usePrevLastFrame: z.boolean(),
    reuseFlowProject: z.boolean(),
    flowProjectName: z.string(),
    flowProjectUrl: z.string(),
    generateButtonMode: z.enum(["auto", "manual"]),
    automationMode: z.enum(["full", "semi"]),
    promptTemplate: z.string(),
    allowSubtitles: z.boolean(),
    ageBand: z.string(),
    moralLesson: z.string(),
    visualStyle: z.string(),
    channelName: z.string(),
    episodeNumber: z.number().int().min(1),
    seriesHook: z.string(),
    longformSettings: z.string(),
    timeTravelSettings: z.string(),
  })
  .partial();

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = patchSchema.parse(await request.json());
    const before = await prisma.project.findUniqueOrThrow({
      where: { id },
      select: {
        clipSeconds: true,
        speechPace: true,
        targetDurationSeconds: true,
        targetWordCount: true,
        moralLesson: true,
        topic: true,
        templateType: true,
      },
    });

    const data: typeof body & { targetWordCount?: number; flowImageModel?: string } = { ...body };
    if (before.templateType === "time_travel" && data.flowProjectUrl !== undefined && data.flowProjectUrl.trim()) {
      const { FLOW_PROJECT_URL_EXAMPLE, normalizeFlowProjectUrl } = await import("@/lib/time-travel");
      const normalized = normalizeFlowProjectUrl(data.flowProjectUrl);
      if (!normalized) {
        throw new Error(`Geçersiz Google Flow proje adresi. Örnek: ${FLOW_PROJECT_URL_EXAMPLE}`);
      }
      data.flowProjectUrl = normalized;
    }
    if (data.timeTravelSettings !== undefined) {
      if (before.templateType !== "time_travel") {
        delete data.timeTravelSettings;
      } else {
        const { parseTimeTravelSettings, serializeTimeTravelSettings } = await import("@/lib/time-travel");
        data.timeTravelSettings = serializeTimeTravelSettings(parseTimeTravelSettings(data.timeTravelSettings));
      }
    }
    data.useFlowCharacter = true;
    const nextImageModel =
      data.flowImageModel !== undefined
        ? resolveFlowImageModel(data.flowImageModel)
        : data.longformSettings
          ? resolveFlowImageModel({ longformSettings: data.longformSettings })
          : undefined;
    delete data.flowImageModel;
    if (before.templateType !== "longform") {
      data.allowSubtitles = false;
    }
    if (body.targetDurationSeconds !== undefined && body.targetDurationSeconds !== before.targetDurationSeconds) {
      const { getSettings, wpmForPace } = await import("@/server/services/settings");
      const { computeTargetWords } = await import("@/server/services/story");
      const settings = await getSettings();
      const pace = body.speechPace ?? before.speechPace;
      const wpm = wpmForPace(settings, pace);
      data.targetWordCount = computeTargetWords(body.targetDurationSeconds, wpm);
    }

    const updated = await prisma.project.update({ where: { id }, data });
    const flowImageModel =
      nextImageModel !== undefined
        ? await persistProjectFlowImageModel(id, nextImageModel)
        : await readProjectFlowImageModel(id);
    const budgetChanged =
      (body.clipSeconds !== undefined && body.clipSeconds !== before.clipSeconds) ||
      (body.speechPace !== undefined && body.speechPace !== before.speechPace);
    if (budgetChanged) {
      await fitProjectDialoguesToClipBudget(id);
    }
    if (data.timeTravelSettings !== undefined) {
      const { seedTimeTravelCast } = await import("@/server/services/time-travel");
      await seedTimeTravelCast(id);
    }

    return withFlowImageModel(updated, flowImageModel);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const url = new URL(request.url);
    const deleteFiles = url.searchParams.get("deleteFiles") === "true";
    await deleteProject(id, deleteFiles);
    return { deleted: true };
  });
}

import fs from "node:fs";
import path from "node:path";
import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { ensureProjectDirs } from "@/server/lib/paths";
import { readPersistedLongformJob } from "@/server/services/longform-jobs";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * SALT-OKUNUR otopilot ilerleme ozeti — calisan surece dokunmaz.
 * Otopilot durumunu dogrudan diskteki autopilot.json'dan, sayilari DB'den okur;
 * auto-pilot servis modulunu IMPORT ETMEZ (dev yeniden derlemesi kosuyu bozmasin).
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
      select: { slug: true, templateType: true, status: true },
    });
    if (!project) return { exists: false };

    // Otopilot durumu (disk)
    let autopilot: {
      running: boolean;
      phase: string;
      message: string;
      error: string;
      updatedAt: number;
    } | null = null;
    try {
      const file = path.join(ensureProjectDirs(project.slug), "autopilot.json");
      if (fs.existsSync(file)) {
        autopilot = JSON.parse(fs.readFileSync(file, "utf8"));
      }
    } catch {
      autopilot = null;
    }

    // Longform isi (kendi kalici dosyasindan; produce fazinin canli nabzi)
    const longformJob = project.templateType === "longform" ? readPersistedLongformJob(id) : null;

    // Canlilik: otomasyon fazinda 15 sn'de bir nabiz var; 90 sn guncelleme yoksa yarim sayilir.
    let running = Boolean(autopilot?.running);
    if (running && autopilot) {
      const fresh = Date.now() - (autopilot.updatedAt || 0) < 90_000;
      const produceAlive =
        autopilot.phase === "produce" && Boolean(longformJob && !longformJob.finishedAt && !longformJob.error);
      if (!fresh && !produceAlive) running = false;
    }

    const [storyCount, clipTotal, clipCompleted, clipFailed, stillCount, promptReady, castTotal, castWithImage] =
      await Promise.all([
        prisma.story.count({ where: { projectId: id, languageVariant: "primary" } }),
        prisma.clip.count({ where: { projectId: id, languageVariant: "primary" } }),
        prisma.clip.count({ where: { projectId: id, languageVariant: "primary", status: "completed" } }),
        prisma.clip.count({
          where: { projectId: id, languageVariant: "primary", status: { in: ["failed", "needs_manual_action"] } },
        }),
        prisma.clip.count({ where: { projectId: id, languageVariant: "primary", sceneImagePath: { not: null } } }),
        prisma.clip.count({ where: { projectId: id, languageVariant: "primary", NOT: { prompt: "" } } }),
        prisma.characterProfile.count({ where: { projectId: id, role: { in: ["main", "side"] } } }),
        prisma.characterProfile.count({
          where: { projectId: id, role: { in: ["main", "side"] }, referenceImagePath: { not: null } },
        }),
      ]);

    // Su an islenen klip (varsa)
    const activeClip = await prisma.clip.findFirst({
      where: {
        projectId: id,
        languageVariant: "primary",
        status: {
          notIn: ["draft", "pending", "completed", "failed", "needs_manual_action"],
        },
      },
      orderBy: { index: "asc" },
      select: { index: true, status: true },
    });

    // Son olaylar (kucuk feed)
    const events = await prisma.automationEvent.findMany({
      where: { projectId: id, step: { in: ["autopilot", "clip", "character", "longform", "job", "publish", "arsiv"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { message: true, level: true, step: true, createdAt: true },
    });

    return {
      exists: true,
      templateType: project.templateType,
      projectStatus: project.status,
      autopilot: autopilot
        ? { running, phase: running ? autopilot.phase : autopilot.phase, message: autopilot.message, error: autopilot.error, stale: Boolean(autopilot.running) && !running }
        : null,
      longform: longformJob
        ? {
            phase: longformJob.phase,
            message: longformJob.message,
            step: longformJob.step,
            totalSteps: longformJob.totalSteps,
            finished: Boolean(longformJob.finishedAt),
            error: longformJob.error,
          }
        : null,
      counts: {
        story: storyCount > 0,
        clipTotal,
        clipCompleted,
        clipFailed,
        stillCount,
        promptReady,
        castTotal,
        castWithImage,
      },
      activeClip,
      events: events.map((e) => ({
        message: e.message,
        level: e.level,
        step: e.step,
        at: e.createdAt.toISOString(),
      })),
    };
  });
}

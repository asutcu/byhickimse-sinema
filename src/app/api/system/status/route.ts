import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { checkSessionStatusCached, isBrowserOpen } from "@/server/automation/browser";
import { engineStatus, reconcileOrphanJobs } from "@/server/automation/engine";
import { describeOpenAiKey } from "@/server/services/settings";

export const runtime = "nodejs";

let lastReconcileAt = 0;

/** Dashboard ozet verisi. */
export async function GET() {
  return handle(async () => {
    if (Date.now() - lastReconcileAt > 15_000) {
      lastReconcileAt = Date.now();
      await reconcileOrphanJobs();
    }

    const [projectCount, runningJobs, completedClips, failedClips, recentProjects, recentEvents, session, openaiKey] =
      await Promise.all([
      prisma.project.count(),
      prisma.automationJob.count({ where: { state: { in: ["running", "paused", "needs_manual_action"] } } }),
      prisma.clip.count({ where: { status: "completed" } }),
      prisma.clip.count({ where: { status: { in: ["failed", "needs_manual_action"] } } }),
      prisma.project.findMany({
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { id: true, name: true, status: true, templateType: true, updatedAt: true },
      }),
      prisma.automationEvent.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      checkSessionStatusCached(),
      describeOpenAiKey(),
    ]);

    return {
      projectCount,
      runningJobs,
      completedClips,
      failedClips,
      recentProjects,
      recentEvents,
      flowSession: session,
      browserOpen: isBrowserOpen(),
      engine: engineStatus(),
      openaiKeyPresent: openaiKey.present,
    };
  });
}

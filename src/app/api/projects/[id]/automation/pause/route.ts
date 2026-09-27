import { handle } from "@/server/lib/api";
import { pauseAutomation, engineStatus, reconcileOrphanJobs } from "@/server/automation/engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const status = engineStatus(id);
    if (!status.runningJobId) {
      // Canli dongu yok: yetim "calisiyor" kaydini temizle (sahte Duraklat)
      await reconcileOrphanJobs(id);
      return { paused: false, orphanReconciled: true };
    }
    pauseAutomation(id);
    return { paused: true, jobId: status.runningJobId };
  });
}

import { handle } from "@/server/lib/api";
import { cancelCurrentClip, engineStatus, reconcileOrphanJobs } from "@/server/automation/engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const status = engineStatus(id);
    if (!status.runningJobId) {
      await reconcileOrphanJobs(id);
      return { cancelling: false, orphanReconciled: true };
    }
    cancelCurrentClip(id);
    return { cancelling: true, jobId: status.runningJobId };
  });
}

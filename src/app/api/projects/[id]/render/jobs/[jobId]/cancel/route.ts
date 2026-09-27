import { handle } from "@/server/lib/api";
import { cancelRenderJob, getRenderJob } from "@/server/services/render-jobs";
import { recordEvent } from "@/server/lib/logger";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; jobId: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id, jobId } = await params;
    const existing = getRenderJob(jobId);
    if (!existing || existing.projectId !== id) {
      throw new Error("Birlestirme isi bulunamadi");
    }
    if (existing.status !== "running" && existing.status !== "cancelling") {
      return { cancelled: false, job: existing, reason: "already_finished" as const };
    }
    const job = cancelRenderJob(jobId, id);
    await recordEvent({
      projectId: id,
      step: "render",
      level: "warning",
      message: `Birlestirme iptali istendi (#${jobId.slice(0, 8)}) — yalnizca bu is durdurulacak`,
    });
    return { cancelled: true, job };
  });
}

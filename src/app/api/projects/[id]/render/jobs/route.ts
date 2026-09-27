import { handle } from "@/server/lib/api";
import { getProjectRenderJobs } from "@/server/services/render";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const jobs = getProjectRenderJobs(id);
    return {
      jobs,
      activeCount: jobs.filter((j) => j.status === "running" || j.status === "cancelling").length,
    };
  });
}

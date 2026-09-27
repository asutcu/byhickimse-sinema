import { handle } from "@/server/lib/api";
import { resumeAutomation, engineStatus, startAutomation } from "@/server/automation/engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const status = engineStatus(id);
    if (status.runningJobId) {
      // Calisan is var: duraklatmayi kaldir
      resumeAutomation(id);
      return { resumed: true, jobId: status.runningJobId };
    }
    // Calisan is yok (uygulama yeniden baslamis olabilir): yeni is baslat, tamamlanmis klipler atlanir
    const result = await startAutomation(id);
    return { resumed: true, jobId: result.jobId };
  });
}

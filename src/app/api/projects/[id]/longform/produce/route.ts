import { z } from "zod";
import { handle } from "@/server/lib/api";
import { runLongformProduction } from "@/server/services/longform";
import { getLongformJob, isLongformCancelledError, requestLongformCancel } from "@/server/services/longform-jobs";
import { isLongformProduceStep } from "@/lib/longform-pipeline";

export const runtime = "nodejs";
export const maxDuration = 3600; // stills can run for hours

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    step: z.enum(["all", "auto", "story", "beats", "tts", "stills", "mix"]).optional(),
    /** true: senaryo dahil her sey silinip sifirdan uretilir (varsayilan: kaldigi yerden devam). */
    restart: z.boolean().optional(),
  })
  .optional();

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const step = body?.step && isLongformProduceStep(body.step) ? body.step : "all";
    const restart = body?.restart === true;
    void runLongformProduction(id, { step, restart }).catch((error) => {
      if (isLongformCancelledError(error)) return;
      console.error(`[longform] ${id} ${step} hata:`, error instanceof Error ? error.message : error);
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { started: true, step, restart, job: getLongformJob(id) };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const cancelled = requestLongformCancel(id);
    // ANINDA durdurma: iptal bayragi uzun Playwright beklemelerinde dakikalarca
    // fark edilmiyordu. Sekme kapaninca bekleyen tum cagrilar aninda duser;
    // yukaridaki catch bunu "iptal edildi" olarak kapatir.
    if (cancelled) {
      const { forceCloseProjectPage } = await import("@/server/automation/browser");
      void forceCloseProjectPage(id).catch(() => {});
    }
    return { cancelled };
  });
}

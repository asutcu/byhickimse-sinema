import { handle } from "@/server/lib/api";
import { closeFlowBrowser } from "@/server/automation/browser";
import { engineStatus } from "@/server/automation/engine";

export const runtime = "nodejs";

export async function POST() {
  return handle(async () => {
    const status = engineStatus();
    if (status.runningProjectIds.length > 0) {
      throw new Error(
        `${status.runningProjectIds.length} projenin otomasyonu calisiyor. Once hepsini durdurun, sonra tarayiciyi kapatin.`
      );
    }
    await closeFlowBrowser();
    return { closed: true };
  });
}

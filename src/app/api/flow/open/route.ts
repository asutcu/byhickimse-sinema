import { handle } from "@/server/lib/api";
import { openFlowBrowser, checkSessionStatus } from "@/server/automation/browser";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  return handle(async () => {
    await openFlowBrowser();
    return checkSessionStatus();
  });
}

import { handle } from "@/server/lib/api";
import { openFlowBrowser } from "@/server/automation/browser";
import { testAllSelectors } from "@/server/automation/selectors";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  return handle(async () => {
    const page = await openFlowBrowser();
    return testAllSelectors(page);
  });
}

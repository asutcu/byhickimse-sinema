import { handle } from "@/server/lib/api";
import { checkSessionStatus, isBrowserOpen } from "@/server/automation/browser";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const session = await checkSessionStatus();
    return { ...session, browserOpen: isBrowserOpen() };
  });
}

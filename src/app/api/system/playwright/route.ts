import { handle } from "@/server/lib/api";
import { checkChrome, checkChromeProfile, checkPlaywright } from "@/server/lib/system-checks";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const [playwright, profile] = await Promise.all([checkPlaywright(), checkChromeProfile()]);
    const chrome = checkChrome();
    return { playwright, chrome, profile };
  });
}

import { handle } from "@/server/lib/api";
import { checkFfmpeg } from "@/server/lib/system-checks";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => checkFfmpeg());
}

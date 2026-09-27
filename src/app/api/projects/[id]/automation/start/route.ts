import { handle } from "@/server/lib/api";
import { startAutomation } from "@/server/automation/engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return startAutomation(id);
  });
}

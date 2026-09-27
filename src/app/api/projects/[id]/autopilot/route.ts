import { handle } from "@/server/lib/api";
import { autoPilotStatus, cancelAutoPilot, startAutoPilot } from "@/server/services/auto-pilot";

export const runtime = "nodejs";
export const maxDuration = 3600;

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return startAutoPilot(id);
  });
}

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return (await autoPilotStatus(id)) ?? { projectId: id, running: false, phase: "idle", message: "", error: "" };
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return { cancelled: cancelAutoPilot(id) };
  });
}

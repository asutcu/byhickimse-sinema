import { handle } from "@/server/lib/api";
import { retryClip } from "@/server/automation/engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; clipId: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { clipId } = await params;
    await retryClip(clipId);
    return { queued: true };
  });
}

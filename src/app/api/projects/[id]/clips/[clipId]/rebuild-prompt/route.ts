import { handle } from "@/server/lib/api";
import { rebuildClipPrompt } from "@/server/services/clips";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; clipId: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { clipId } = await params;
    return rebuildClipPrompt(clipId);
  });
}

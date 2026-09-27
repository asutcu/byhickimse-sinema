import { handle } from "@/server/lib/api";
import { splitClipInTwo } from "@/server/services/clips";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; clipId: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { clipId } = await params;
    return splitClipInTwo(clipId);
  });
}

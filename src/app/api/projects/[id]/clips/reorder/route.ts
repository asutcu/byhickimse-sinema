import { z } from "zod";
import { handle } from "@/server/lib/api";
import { reorderClips } from "@/server/services/clips";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ orderedClipIds: z.array(z.string()).min(1) });

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = schema.parse(await request.json());
    await reorderClips(id, body.orderedClipIds);
    return { reordered: true };
  });
}

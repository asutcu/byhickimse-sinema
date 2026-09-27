import { handle } from "@/server/lib/api";
import { generateLongformBeats } from "@/server/services/longform";

export const runtime = "nodejs";
export const maxDuration = 600;

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return generateLongformBeats(id);
  });
}

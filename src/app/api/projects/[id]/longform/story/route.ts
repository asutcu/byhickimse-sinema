import { handle } from "@/server/lib/api";
import { generateLongformStory } from "@/server/services/longform";

export const runtime = "nodejs";
export const maxDuration = 1800;

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return generateLongformStory(id);
  });
}

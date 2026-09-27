import { handle } from "@/server/lib/api";
import { generateStory } from "@/server/services/story";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return generateStory(id);
  });
}

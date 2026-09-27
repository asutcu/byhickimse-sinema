import { z } from "zod";
import { handle } from "@/server/lib/api";
import { splitProjectStory } from "@/server/services/clips";

export const runtime = "nodejs";
export const maxDuration = 1200;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional();

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    return splitProjectStory(id, { force: Boolean(body?.force) });
  });
}

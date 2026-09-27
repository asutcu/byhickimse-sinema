import { z } from "zod";
import { handle } from "@/server/lib/api";
import { suggestTimeTravelIdeas } from "@/server/services/time-travel-research";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  category: z.string().optional(),
  speechLanguage: z.string().default("Turkish"),
  exclude: z.array(z.string()).max(40).optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    return { ideas: await suggestTimeTravelIdeas(body) };
  });
}

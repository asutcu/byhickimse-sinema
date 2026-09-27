import { handle } from "@/server/lib/api";
import { suggestNarratorTopic } from "@/server/services/narrator-topic";
import { prisma } from "@/server/db";
import { wpmForPace } from "@/server/services/settings";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // Kelime hedefi ayarlardaki gercek konusma temposuna gore (sabit 120 degil)
    if (!body.wpm) {
      const app = await prisma.appSettings.findUnique({ where: { id: 1 } });
      if (app) body.wpm = wpmForPace(app, "normal");
    }
    return suggestNarratorTopic(body);
  });
}

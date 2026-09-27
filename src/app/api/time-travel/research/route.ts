import { z } from "zod";
import { handle } from "@/server/lib/api";
import { researchTimeTravelTopic } from "@/server/services/time-travel-research";

export const runtime = "nodejs";
export const maxDuration = 600;

const bodySchema = z.object({
  topic: z.string().min(3, "Araştırma için bir konu yazın").max(600),
  speechLanguage: z.string().default("Turkish"),
  targetDurationSeconds: z.number().int().min(60).max(3600).default(840),
  hostName: z.string().max(80).optional(),
  companion: z.string().max(120).optional(),
});

/** Yeni yolculuk formu: proje olusturmadan once konu arastirmasi. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = bodySchema.parse(await request.json());
    return researchTimeTravelTopic(body);
  });
}

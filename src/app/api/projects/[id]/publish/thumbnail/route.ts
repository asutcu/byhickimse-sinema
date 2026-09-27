import { z } from "zod";
import { handle } from "@/server/lib/api";
import { generateThumbnail, generateThumbnailFromVideo } from "@/server/services/publish";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** video = klipten ilgi cekici kare (varsayilan); ai = OpenAI gorsel */
  source: z.enum(["video", "ai"]).optional(),
  customPrompt: z.string().optional(),
  clipIndex: z.number().int().positive().optional(),
  /** Kapak uzerine yazilacak kisa metin (or. "Neler Oldu Neler?") */
  overlayText: z.string().optional(),
  /** false ise yazi bindirmez */
  withText: z.boolean().optional(),
});

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = schema.parse(await request.json().catch(() => ({})));
    const source = body.source ?? (body.customPrompt ? "ai" : "video");

    if (source === "ai") {
      const path = await generateThumbnail(id, body.customPrompt);
      return { path, source: "ai" as const };
    }

    const picked = await generateThumbnailFromVideo(id, {
      preferredClipIndex: body.clipIndex,
      overlayText: body.overlayText,
      withText: body.withText,
    });
    return {
      path: picked.path,
      source: "video" as const,
      clipIndex: picked.clipIndex,
      reason: picked.reason,
      overlayText: picked.overlayText,
    };
  });
}

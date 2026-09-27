import { handle } from "@/server/lib/api";
import { generateThumbnailVariants } from "@/server/services/publish";

export const runtime = "nodejs";
export const maxDuration = 600;

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const variants = await generateThumbnailVariants(id);
    return { variants, overlayText: variants[0]?.overlayText || "" };
  });
}

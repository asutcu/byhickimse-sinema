import { handle } from "@/server/lib/api";
import { regeneratePublishDescription } from "@/server/services/publish";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** Sadece YouTube aciklamasini GPT-5 ile kisa + merakli yeniler. */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const meta = await regeneratePublishDescription(id);
    return { meta };
  });
}

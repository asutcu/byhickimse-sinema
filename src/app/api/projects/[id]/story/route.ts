import { z } from "zod";
import { handle } from "@/server/lib/api";
import { refineStory, saveEditedStory } from "@/server/services/story";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const refineSchema = z.object({
  action: z.enum(["regenerate", "scarier", "more_mysterious", "shorten", "lengthen", "stronger_opening", "change_ending"]),
});

/** Hikaye duzenleme eylemleri (yeniden olustur, korkutucu yap, kisalt...) */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = refineSchema.parse(await request.json());
    return refineStory(id, body.action);
  });
}

const saveSchema = z.object({
  title: z.string().optional(),
  fullStory: z.string().min(1, "Hikaye metni bos olamaz"),
});

/** Panelde duzenlenen metni kaydet */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = saveSchema.parse(await request.json());
    return saveEditedStory(id, body);
  });
}

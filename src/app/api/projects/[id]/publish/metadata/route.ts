import { z } from "zod";
import { handle } from "@/server/lib/api";
import {
  generatePublishMetadata,
  loadPublishMetadata,
  loadPublishPackage,
  savePublishMetadata,
} from "@/server/services/publish";

export const runtime = "nodejs";
export const maxDuration = 900;

type Params = { params: Promise<{ id: string }> };

const generateSchema = z.object({
  autoThumbnail: z.boolean().optional(),
});

const saveSchema = z.object({
  primaryTitle: z.string().optional(),
  titleVariants: z.array(z.string()).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  hashtags: z.array(z.string()).optional(),
  pinnedComment: z.string().optional(),
  communityPost: z.string().optional(),
  thumbnailPrompt: z.string().optional(),
  thumbnailText: z.string().optional(),
  endScreenCta: z.string().optional(),
  seriesHook: z.string().optional(),
  postingStrategy: z.string().optional(),
  kidsSafetyNotes: z.string().optional(),
});

/** Tam paket: meta + son thumbnail/SRT yollari */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return loadPublishPackage(id);
  });
}

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = generateSchema.parse(await request.json().catch(() => ({})));
    return generatePublishMetadata(id, { autoThumbnail: body.autoThumbnail ?? true });
  });
}

/** Elle duzenlenen yayin alanlarini kaydet */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = saveSchema.parse(await request.json());
    const meta = await savePublishMetadata(id, body);
    return { meta };
  });
}

/** Geriye uyumluluk: bazi istemciler sadece meta bekleyebilir */
export async function HEAD(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const meta = await loadPublishMetadata(id);
    return { exists: Boolean(meta) };
  });
}

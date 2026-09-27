import { z } from "zod";
import { handle } from "@/server/lib/api";
import { createLanguageVariant, listLanguageVariants } from "@/server/services/variants";

export const runtime = "nodejs";
export const maxDuration = 600;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return listLanguageVariants(id);
  });
}

const schema = z.object({ targetLanguage: z.string().min(2) });

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = schema.parse(await request.json());
    return createLanguageVariant(id, body.targetLanguage);
  });
}

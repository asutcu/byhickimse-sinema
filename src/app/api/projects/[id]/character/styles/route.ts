import { z } from "zod";
import { handle } from "@/server/lib/api";
import {
  listCharacterStyles,
  suggestAndGenerateOutfitStyles,
  generateOutfitStyle,
  approveOutfitStyle,
  activateOutfitStyle,
  deleteOutfitStyle,
} from "@/server/services/character-styles";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    return listCharacterStyles(id);
  });
}

const methodSchema = z.enum(["openai", "flow"]).optional();

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suggest"), count: z.number().int().min(3).max(5).optional(), method: methodSchema }),
  z.object({
    action: z.literal("generate"),
    suggestion: z.object({
      label: z.string().min(1),
      occasion: z.string().min(1),
      outfitDetail: z.string().min(10),
      imagePrompt: z.string().min(40),
      signatureProp: z.string().optional().default(""),
    }),
    method: methodSchema,
  }),
  z.object({ action: z.literal("approve"), styleId: z.string().min(1) }),
  z.object({ action: z.literal("activate"), styleId: z.string().min(1) }),
  z.object({ action: z.literal("delete"), styleId: z.string().min(1) }),
]);

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = postSchema.parse(await request.json());
    switch (body.action) {
      case "suggest":
        return suggestAndGenerateOutfitStyles(id, body.count ?? 3, body.method ?? "openai");
      case "generate":
        return { entry: await generateOutfitStyle(id, body.suggestion, body.method ?? "openai") };
      case "approve":
        return { entry: await approveOutfitStyle(id, body.styleId) };
      case "activate":
        return activateOutfitStyle(id, body.styleId);
      case "delete":
        await deleteOutfitStyle(id, body.styleId);
        return { ok: true };
      default:
        throw new Error("Bilinmeyen islem");
    }
  });
}

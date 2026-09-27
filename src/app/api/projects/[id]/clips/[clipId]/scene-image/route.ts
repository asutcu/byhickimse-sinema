import { handle } from "@/server/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; clipId: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    await params;
    throw new Error("Sahne gorseli uretimi kaldirildi");
  });
}

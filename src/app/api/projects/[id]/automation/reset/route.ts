import { z } from "zod";
import { handle } from "@/server/lib/api";
import { resetAutomation } from "@/server/automation/engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const resetSchema = z.object({
  deleteVideos: z.boolean().default(true),
});

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = resetSchema.parse(await request.json().catch(() => ({})));
    return resetAutomation(id, { deleteVideos: body.deleteVideos });
  });
}

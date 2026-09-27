import { z } from "zod";
import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { importPreset, savePresetFromProject } from "@/server/services/presets";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => prisma.channelPreset.findMany({ orderBy: { updatedAt: "desc" } }));
}

const createSchema = z.union([
  z.object({ mode: z.literal("from_project"), projectId: z.string(), name: z.string().min(1) }),
  z.object({ mode: z.literal("import"), name: z.string().min(1), templateType: z.string(), payload: z.string() }),
]);

export async function POST(request: Request) {
  return handle(async () => {
    const body = createSchema.parse(await request.json());
    if (body.mode === "from_project") {
      return savePresetFromProject(body.projectId, body.name);
    }
    return importPreset(body.name, body.templateType, body.payload);
  });
}

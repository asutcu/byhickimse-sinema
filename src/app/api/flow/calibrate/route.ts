import { z } from "zod";
import { handle } from "@/server/lib/api";
import { calibrateSelector } from "@/server/automation/calibration";

export const runtime = "nodejs";
export const maxDuration = 180;

const schema = z.object({ key: z.string().min(1) });

export async function POST(request: Request) {
  return handle(async () => {
    const body = schema.parse(await request.json());
    return calibrateSelector(body.key);
  });
}

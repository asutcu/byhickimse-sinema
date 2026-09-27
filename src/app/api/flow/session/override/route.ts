import { z } from "zod";
import { handle } from "@/server/lib/api";
import { isSessionCheckOverridden, setSessionCheckOverride } from "@/server/automation/browser";
import { recordEvent } from "@/server/lib/logger";

export const runtime = "nodejs";

const schema = z.object({ ignore: z.boolean() });

/**
 * "Dogrulama tespiti yanlis alarm" durumunda kontrolu atlar.
 * Yalnizca TESPITI atlar; hicbir guvenlik dogrulamasi asilmaz.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = schema.parse(await request.json());
    setSessionCheckOverride(body.ignore);
    await recordEvent({
      step: "flow",
      level: "warning",
      message: body.ignore
        ? "Oturum dogrulama tespiti kullanici istegiyle atlaniyor (yanlis alarm bildirildi)"
        : "Oturum dogrulama tespiti yeniden etkinlestirildi",
    });
    return { ignore: isSessionCheckOverridden() };
  });
}

export async function GET() {
  return handle(async () => ({ ignore: isSessionCheckOverridden() }));
}

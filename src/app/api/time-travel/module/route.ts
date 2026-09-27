import { z } from "zod";
import { handle } from "@/server/lib/api";
import {
  flowUrlUsedOutsideTimeTravel,
  readTimeTravelModuleSettings,
  writeTimeTravelModuleSettings,
} from "@/server/services/time-travel-module";
import { normalizeFlowProjectUrl } from "@/lib/time-travel";

export const runtime = "nodejs";

/** Zaman Yolcusu modul ayarlari + verilen Flow adresinin baska modulde kullanilip kullanilmadigi. */
export async function GET(request: Request) {
  return handle(async () => {
    const check = new URL(request.url).searchParams.get("check") || "";
    const settings = readTimeTravelModuleSettings();
    const target = check || settings.flowProjectUrl;
    return {
      ...settings,
      checkedUrl: target ? normalizeFlowProjectUrl(target) : "",
      usedOutside: target ? await flowUrlUsedOutsideTimeTravel(target) : [],
    };
  });
}

const putSchema = z.object({ flowProjectUrl: z.string().max(400) });

export async function PUT(request: Request) {
  return handle(async () => {
    const body = putSchema.parse(await request.json());
    return writeTimeTravelModuleSettings(body);
  });
}

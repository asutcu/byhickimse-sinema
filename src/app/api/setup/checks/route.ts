import { handle } from "@/server/lib/api";
import { checkChrome, checkChromeProfile, checkFfmpeg, checkNode, checkPlaywright } from "@/server/lib/system-checks";
import { describeOpenAiKey } from "@/server/services/settings";
import { checkSessionStatus, isBrowserOpen } from "@/server/automation/browser";
import { prisma } from "@/server/db";

export const runtime = "nodejs";

/** Kurulum sihirbazi kontrol listesi. */
export async function GET() {
  return handle(async () => {
    const [ffmpegChecks, playwright, profile, openaiKey] = await Promise.all([
      checkFfmpeg(),
      checkPlaywright(),
      checkChromeProfile(),
      describeOpenAiKey(),
    ]);
    const node = checkNode();
    const chrome = checkChrome();
    const session = await checkSessionStatus();
    const configuredSelectors = await prisma.flowSelector.count({ where: { value: { not: "" } } });
    const totalSelectors = await prisma.flowSelector.count();

    return {
      node,
      ffmpeg: ffmpegChecks.ffmpeg,
      ffprobe: ffmpegChecks.ffprobe,
      chrome,
      playwright,
      profile,
      openaiKey: {
        ok: openaiKey.present,
        label: "OpenAI API Anahtari",
        detail: openaiKey.present ? `Ayarli (${openaiKey.masked}, kaynak: ${openaiKey.source})` : "Anahtar girilmemis. Ayarlar ekranindan ekleyin.",
      },
      flowSession: {
        ok: session.status === "ready",
        label: "Flow Oturumu",
        detail: isBrowserOpen() ? session.detail : "Tarayici kapali. Kalibrasyon ekranindan Flow'u acin ve Google'a elle giris yapin.",
      },
      selectors: {
        ok: configuredSelectors >= 4,
        label: "Flow Secicileri",
        detail: `${configuredSelectors}/${totalSelectors} secici yapilandirilmis${configuredSelectors < 4 ? " — kalibrasyon onerilir" : ""}`,
      },
    };
  });
}

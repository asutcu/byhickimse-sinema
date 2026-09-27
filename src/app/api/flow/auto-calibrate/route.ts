import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { openFlowBrowser, checkSessionStatus } from "@/server/automation/browser";
import { autoCalibrateAll, ensureDefaultSelectors, resolveSelector } from "@/server/automation/selectors";
import { ensureEditorReady } from "@/server/automation/flow-adapter";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Otomatik kalibrasyon:
 * 1. Flow'u acar, SPA'nin yuklenmesini bekler, oturumu kontrol eder
 * 2. Mumkunse proje editorune girer (prompt kutusunun oldugu ekran)
 * 3. Tum secicileri yerlesik tariflerle cozumleyip kaydeder
 */
export async function POST() {
  return handle(async () => {
    await ensureDefaultSelectors();
    const page = await openFlowBrowser();

    // Flow agir bir SPA: govde gelmeden yapilan kontroller bos doner
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    const session = await checkSessionStatus();
    if (session.status === "needs_login" || session.status === "needs_verification") {
      return { session, editorReady: false, editorNote: session.detail, url: page.url(), results: [] as unknown[] };
    }

    // Prompt kutusu icin sabirli bekleme: SPA parca parca render eder
    let editorReady = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const prompt = await resolveSelector(page, "promptInput", { selfHeal: false, timeoutMs: 1_500 });
      if (prompt) {
        editorReady = true;
        break;
      }
      await page.waitForTimeout(2_500);
    }

    // Hala yoksa editor ekranina gecmeyi dene (proje karti / yeni proje)
    let editorNote = "";
    if (!editorReady) {
      const project = await prisma.project.findFirst({ orderBy: { updatedAt: "desc" } });
      if (project) {
        try {
          await ensureEditorReady(page, project);
          editorReady = true;
        } catch (err) {
          editorNote = err instanceof Error ? err.message : String(err);
        }
      }
    }

    const results = await autoCalibrateAll(page);
    return { session, editorReady, editorNote, url: page.url(), results };
  });
}

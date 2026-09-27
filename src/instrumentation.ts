/**
 * Next.js sunucusu ayaga kalkarken bir kez calisir:
 * - Yarim kalmis otomasyon islerini "paused" durumuna alir
 *   (kullanici otomasyonu tekrar baslattiginda tamamlanmis klipler atlanir)
 * - Varsayilan Flow secicilerini olusturur
 * - Bilinen zararsiz surec hatalarini sessizce yutar (SSE ReadableStream kapanisi)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverInterruptedJobs } = await import("@/server/automation/engine");
    const { ensureDefaultSelectors } = await import("@/server/automation/selectors");
    const { getSettings } = await import("@/server/services/settings");
    try {
      await getSettings();
      await ensureDefaultSelectors();
      await recoverInterruptedJobs();
    } catch (err) {
      console.error("Baslangic kurtarma adimi basarisiz:", err);
    }

    // Yarim kalmis otopilotlar: sunucu oturunca kendiliginden devam eder
    // (islem yarida kalmasin — kullanici tiklamasina gerek yok).
    setTimeout(() => {
      void import("@/server/services/auto-pilot")
        .then(({ resumeInterruptedAutoPilots }) => resumeInterruptedAutoPilots())
        .then((n) => {
          if (n > 0) console.log(`[otopilot] ${n} yarim kalmis is otomatik devam ettirildi`);
        })
        .catch((err) => console.error("Otopilot otomatik devam hatasi:", err));
    }, 8_000);

    const isBenignStreamClose = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
      return code === "ERR_INVALID_STATE" || /ReadableStream is already closed/i.test(message);
    };
    const isBenignPrismaMiss = (err: unknown) => {
      const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
      return code === "P2025" || code === "P2003";
    };

    process.on("uncaughtException", (err) => {
      if (isBenignStreamClose(err)) return;
      console.error("uncaughtException:", err);
    });
    process.on("unhandledRejection", (reason) => {
      if (isBenignStreamClose(reason) || isBenignPrismaMiss(reason)) return;
      console.error("unhandledRejection:", reason);
    });
  }
}

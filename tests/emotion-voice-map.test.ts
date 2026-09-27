import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NETSHORT_CORPUS_STORY_LOCK,
  NETSHORT_EMOTIONS,
  netShortEmotionPaletteBlock,
} from "@/lib/netshort-corpus";
import {
  elevenV3Text,
  flowVoiceDirection,
  foldTurkish,
  resolveTtsMood,
  ttsPerformanceFor,
} from "@/lib/tts-performance";

describe("duygu paleti → seslendirme", () => {
  it("prompt kutuphanesindeki HER duygu bir oyunculuk profiline baglanir", () => {
    const flat = NETSHORT_EMOTIONS.filter((label) => resolveTtsMood(label, "") === "calm");
    expect(flat).toEqual([]);
  });

  it("palet duygulari ayni tek moda yigilmaz", () => {
    const moods = new Set(NETSHORT_EMOTIONS.map((label) => resolveTtsMood(label, "")));
    expect(moods.size).toBeGreaterThanOrEqual(6);
  });

  it("Turkce harfli ve harfsiz etiket ayni sonucu verir", () => {
    expect(foldTurkish("İĞRENME ŞOKU")).toBe("igrenme soku");
    expect(resolveTtsMood("iğrenme / tiksinti bakisi", "")).toBe(resolveTtsMood("igrenme / tiksinti bakisi", ""));
    expect(resolveTtsMood("şok", "")).toBe("shock");
    expect(resolveTtsMood("sok", "")).toBe("shock");
  });

  it("en sik etiketler dogru profile gider", () => {
    expect(resolveTtsMood("etki sonrasi tepki (goz kırılması)", "")).toBe("shock");
    expect(resolveTtsMood("donuk asagilanma", "")).toBe("disgust");
    expect(resolveTtsMood("pişkin hakimiyet bakisi (yukaridan)", "")).toBe("smug");
    expect(resolveTtsMood("kin", "")).toBe("angry");
    expect(resolveTtsMood("soguk kin (bastirilmis nefret)", "")).toBe("cold");
    expect(resolveTtsMood("yukun kalkmasi (rahatlama)", "")).toBe("relief");
    expect(resolveTtsMood("Sevinc patlaması", "")).toBe("joy");
    expect(resolveTtsMood("heyecanlı merak, sakin odak", "")).toBe("curious");
  });

  it("v3 etiketi cumle cumle dagilir; sert cumle sert okunur", () => {
    const text = elevenV3Text("Kapiyi acti. Yeter artik, defol bu evden! Sonra sessizce oturdum.", "angry");
    expect(text.startsWith("[angry]")).toBe(true);
    expect(text).toContain("[shouts] Yeter artik");
    // Son sakin cumle yeni etiket almaz — v3 tekrarlarda abartiyor.
    expect(text.endsWith("Sonra sessizce oturdum.")).toBe(true);
  });

  it("ayni etiket ust uste tekrarlanmaz", () => {
    const text = elevenV3Text("Bagirdi. Yine bagirdi.", "angry");
    expect(text.match(/\[shouts\]/g)?.length).toBe(1);
  });

  it("sinema klibine ses yonetmeni notu gider", () => {
    expect(flowVoiceDirection("donuk asagilanma", "")).toMatch(/VOCAL DELIVERY \(DISGUST\)/);
    expect(flowVoiceDirection("etki sonrasi tepki", "")).toMatch(/VOCAL DELIVERY \(SHOCK\)/);
    expect(flowVoiceDirection("", "")).toBe("");
  });

  it("hikaye kilidi duygu etiketinin sesi yonettigini yazar", () => {
    expect(NETSHORT_CORPUS_STORY_LOCK).toMatch(/SES YONETIMI/);
    expect(NETSHORT_CORPUS_STORY_LOCK).toMatch(/AYNI ETIKET ARKA ARKAYA/);
  });

  it("palet blogu tum duygulari tasir ve sinema akisina baglidir", () => {
    const block = netShortEmotionPaletteBlock();
    for (const label of NETSHORT_EMOTIONS) expect(block).toContain(label);
    const film = fs.readFileSync(path.join(process.cwd(), "src/server/services/narrator-film.ts"), "utf8");
    // Sinema: hem film plani hem diyalog cilasi ayni paletten secer.
    expect(film.match(/netShortEmotionPaletteBlock\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("ElevenLabs ayarlari moda gore degisir", () => {
    const angry = ttsPerformanceFor({ emotion: "bagirmaya yakin ofke (patlama esigi)", text: "Defol!" });
    const cold = ttsPerformanceFor({ emotion: "soguk kin (bastirilmis nefret)", text: "Imzala." });
    expect(angry.elevenStability).toBeLessThan(cold.elevenStability);
    expect(angry.elevenV3Tags.length).toBeGreaterThan(0);
    expect(angry.volume).toBeGreaterThan(cold.volume);
  });
});

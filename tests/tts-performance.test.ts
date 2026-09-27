import { describe, expect, it } from "vitest";
import { buildAzureSsml } from "@/server/services/tts-providers";
import {
  applyTtsPerformance,
  googleGeminiSpeaker,
  isGoogleGeminiVoice,
  resolveTtsMood,
  ttsPerformanceFor,
} from "@/lib/tts-performance";
import { ttsVoiceById, ttsVoicesFor } from "@/lib/tts-catalog";

describe("TTS sahne duygusu", () => {
  it("sinirli / ofke etiketini angry yapar", () => {
    expect(resolveTtsMood("donuk ofke", "Yeter, bu evden cik.")).toBe("angry");
    expect(resolveTtsMood("fiziksel ustunluk (itme, tokat, kapi carpma)", "")).toBe("angry");
    expect(ttsPerformanceFor({ emotion: "ofke", text: "Defol." }).mood).toBe("angry");
    expect(ttsPerformanceFor({ emotion: "ofke" }).speedDelta).toBeGreaterThan(0);
    expect(ttsPerformanceFor({ emotion: "ofke", language: "English" }).instruction).toMatch(/Speak in English/);
    expect(ttsPerformanceFor({ emotion: "ofke", language: "German" }).instruction).toMatch(/Speak in German/);
  });

  it("sakin yikici karari soguk okur, pismanligi yavaslatir", () => {
    expect(resolveTtsMood("sakin yikici kararlilik", "Bosanma kagidini imzaladim.")).toBe("cold");
    expect(resolveTtsMood("pismanlik bogulmasi (yalvarma)", "")).toBe("sad");
    expect(ttsPerformanceFor({ emotion: "pismanlik" }).speedDelta).toBeLessThan(0);
  });

  it("kapaliysa duz anlatima duser", () => {
    const flat = ttsPerformanceFor({ emotion: "ofke", text: "Yeter", enabled: false });
    expect(flat.mood).toBe("calm");
    expect(flat.speedDelta).toBe(0);
  });

  it("temel hiz ve perdeyi kirpar", () => {
    const angry = ttsPerformanceFor({ emotion: "sinir" });
    expect(applyTtsPerformance(1.28, 6, angry).speed).toBeLessThanOrEqual(1.3);
    expect(applyTtsPerformance(1.28, 6, angry).pitchSemitones).toBeLessThanOrEqual(6);
  });

  it("Gemini duygulu sesler katalogda vardir", () => {
    const turkish = ttsVoicesFor({ language: "Türkçe", provider: "google" });
    expect(turkish.some((v) => v.name === "gemini:Kore")).toBe(true);
    expect(isGoogleGeminiVoice("gemini:Kore")).toBe(true);
    expect(googleGeminiSpeaker("gemini:Kore")).toBe("Kore");
    expect(ttsVoiceById("google:gemini:Kore")?.label).toMatch(/Gemini/i);
    expect(ttsVoicesFor({ language: "English", provider: "google" }).some((v) => v.name === "gemini:Kore")).toBe(true);
    expect(ttsVoiceById("google:gemini:Kore:en")?.languageTag).toBe("en");
  });

  it("Azure SSML ofke stilini tasir", () => {
    const ssml = buildAzureSsml({
      voiceName: "tr-TR-EmelNeural",
      languageCode: "tr-TR",
      text: "Yeter",
      speed: 1.1,
      pitchSemitones: 1,
      style: "angry",
      volumePercent: 16,
    });
    expect(ssml).toContain('style="angry"');
    expect(ssml).toContain("mstts");
    expect(ssml).toContain('volume="+16%"');
  });
});

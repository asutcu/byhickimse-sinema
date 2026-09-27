import { describe, expect, it } from "vitest";
import {
  elevenLabsSpeechBodies,
  inferElevenLabsGender,
  normalizeElevenLabsVoice,
  pickElevenLabsVoice,
  scoreElevenLabsVoice,
  voiceSupportsLanguage,
} from "@/lib/elevenlabs-voice-pick";

function voice(raw: Record<string, unknown>) {
  return normalizeElevenLabsVoice(raw)!;
}

describe("ElevenLabs hikayeye gore ses", () => {
  it("API kaydini normalize eder", () => {
    const v = voice({
      voice_id: "abc123",
      name: "Leyla",
      labels: { gender: "female", language: "tr" },
      category: "cloned",
    });
    expect(v.voiceId).toBe("abc123");
    expect(v.gender).toBe("female");
    expect(v.verifiedLanguages).toContain("tr");
    expect(inferElevenLabsGender({ name: "Adam", labels: { gender: "male" }, description: "" })).toBe("male");
  });

  it("Turkce kadin anlatıcıyı cocuk sestense onceler", () => {
    const kid = voice({
      voice_id: "kid",
      name: "Child Story",
      labels: { gender: "female", age: "child" },
    });
    const leyla = voice({
      voice_id: "leyla",
      name: "Leyla",
      labels: { gender: "female", language: "turkish" },
      description: "Dramatic narrator",
      category: "cloned",
    });
    const hint = { language: "Turkish", genre: "aldatma", preferGender: "female" as const };
    expect(scoreElevenLabsVoice(leyla, hint)).toBeGreaterThan(scoreElevenLabsVoice(kid, hint));
    expect(pickElevenLabsVoice([kid, leyla], hint)?.voiceId).toBe("leyla");
  });

  it("Ingilizce/Almanca/Fransizca/Ispanyolca icin Turkce sese kilitlenmez", () => {
    const leyla = voice({
      voice_id: "leyla",
      name: "Leyla",
      labels: { gender: "female", language: "turkish" },
    });
    const rachel = voice({
      voice_id: "rachel",
      name: "Rachel",
      labels: { gender: "female", language: "english" },
      verified_languages: [{ language: "en", locale: "en-US" }],
    });
    const katja = voice({
      voice_id: "katja",
      name: "Katja",
      labels: { gender: "female", language: "german" },
      verified_languages: [{ language: "de" }],
    });
    const amelia = voice({
      voice_id: "amelia",
      name: "Amelie",
      labels: { gender: "female", language: "french" },
      verified_languages: [{ language: "fr" }],
    });
    const elvira = voice({
      voice_id: "elvira",
      name: "Elvira",
      labels: { gender: "female", language: "spanish" },
      verified_languages: [{ language: "es" }],
    });
    expect(voiceSupportsLanguage(leyla, "English")).toBe(false);
    expect(voiceSupportsLanguage(rachel, "English")).toBe(true);
    expect(pickElevenLabsVoice([leyla, rachel], { language: "English", preferGender: "female" })?.voiceId).toBe("rachel");
    expect(pickElevenLabsVoice([leyla, katja], { language: "German", preferGender: "female" })?.voiceId).toBe("katja");
    expect(pickElevenLabsVoice([leyla, amelia], { language: "French", preferGender: "female" })?.voiceId).toBe("amelia");
    expect(pickElevenLabsVoice([leyla, elvira], { language: "Spanish", preferGender: "female" })?.voiceId).toBe("elvira");
    expect(scoreElevenLabsVoice(rachel, { language: "German", preferGender: "female" })).toBeLessThan(
      scoreElevenLabsVoice(katja, { language: "German", preferGender: "female" })
    );
  });

  it("female kelimesindeki de harfini Almanca sanmaz", () => {
    const englishFemale = voice({
      voice_id: "en-f",
      name: "Jane",
      labels: { gender: "female", language: "english" },
    });
    expect(voiceSupportsLanguage(englishFemale, "German")).toBe(false);
  });

  it("v3 duygu etiketiyle once dener; her dilde kalite sirasi v3 → multilingual → flash", () => {
    const en = elevenLabsSpeechBodies({
      text: "Hello",
      language: "English",
      stability: 0.4,
      style: 0.2,
      v3Tags: ["[angry]"],
    });
    expect(en[0].model_id).toBe("eleven_v3");
    expect(en[0].text).toBe("[angry] Hello");
    const v3Settings = en[0].voice_settings as { stability: number; style?: number };
    expect([0, 0.5, 1]).toContain(v3Settings.stability);
    expect(v3Settings.style).toBeUndefined();
    expect(en[1].model_id).toBe("eleven_multilingual_v2");
    expect(en[1].text).toBe("Hello");
    expect(en[2].model_id).toBe("eleven_flash_v2_5");
    expect(en[2].language_code).toBe("en");

    const tr = elevenLabsSpeechBodies({ text: "Merhaba", language: "Turkish", stability: 0.4, style: 0.2 });
    expect(tr[0].model_id).toBe("eleven_v3");
    expect(tr[0].text).toBe("Merhaba");
    expect(tr[1].model_id).toBe("eleven_multilingual_v2");
    expect(tr[1].language_code).toBeUndefined();
    expect(tr[2].model_id).toBe("eleven_flash_v2_5");
  });

  it("dusuk stability v3'te Creative (0.0) moda cevrilir", () => {
    const angry = elevenLabsSpeechBodies({ text: "Yeter!", language: "Turkish", stability: 0.28, style: 0.6 });
    const settings = angry[0].voice_settings as { stability: number };
    expect(settings.stability).toBe(0);
  });
});

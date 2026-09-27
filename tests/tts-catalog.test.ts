import { describe, expect, it } from "vitest";
import {
  allTtsVoices,
  elevenLabsVoice,
  isLegacyVoiceId,
  languageTagFor,
  localeForLanguage,
  piperModelUrls,
  readyPaidProviders,
  resolvePreferredTtsVoice,
  resolveTtsVoice,
  spokenLanguageName,
  ttsPreviewSample,
  ELEVENLABS_VOICE_ID,
  ttsProviderInfo,
  ttsVoicesForReady,
  ttsVoiceById,
  ttsVoicesFor,
  TTS_PROVIDERS,
} from "@/lib/tts-catalog";
import { buildAzureSsml, escapeXml } from "@/server/services/tts-providers";
import { buildTempoFilter } from "@/server/services/ffmpeg";

describe("Dil normalizasyonu", () => {
  it("Turkce dil adinin her yazimini tanir", () => {
    // Project.speechLanguage varsayilani "Türkçe", form ise "Turkish" yaziyor.
    expect(languageTagFor("Türkçe")).toBe("tr");
    expect(languageTagFor("Turkish")).toBe("tr");
    expect(languageTagFor("tr-TR")).toBe("tr");
    expect(languageTagFor("TÜRKÇE")).toBe("tr");
  });

  it("diger dilleri ve bilinmeyeni ayirir", () => {
    expect(languageTagFor("İngilizce")).toBe("en");
    expect(languageTagFor("English")).toBe("en");
    expect(languageTagFor("Almanca")).toBe("de");
    expect(languageTagFor("Fransızca")).toBe("fr");
    expect(languageTagFor("İspanyolca")).toBe("es");
    expect(languageTagFor("Klingon")).toBe("");
    expect(localeForLanguage("Turkish")).toBe("tr-TR");
    expect(localeForLanguage("English")).toBe("en-US");
    expect(spokenLanguageName("English")).toBe("English");
    expect(ttsPreviewSample("English")).toMatch(/kitchen light/i);
    expect(ttsPreviewSample("German")).toMatch(/Küche|Kuche/i);
    expect(ttsPreviewSample("French")).toMatch(/cuisine/i);
    expect(ttsPreviewSample("Spanish")).toMatch(/cocina/i);
  });
});

describe("Ses katalogu", () => {
  it("Turkce icin yerli Google ve Azure sesleri vardir", () => {
    const turkish = ttsVoicesFor({ language: "Türkçe" });
    const names = turkish.map((v) => v.name);
    expect(names).toContain("tr-TR-Chirp3-HD-Kore");
    expect(names).toContain("tr-TR-Wavenet-A");
    expect(names).toContain("tr-TR-EmelNeural");
    expect(names).toContain("tr-TR-AhmetNeural");
    expect(names).toContain("tr_TR-dfki-medium");
    expect(turkish.every((v) => v.languageTag === "tr")).toBe(true);
  });

  it("saglayiciya gore filtreler ve kimlikler tekildir", () => {
    const google = ttsVoicesFor({ language: "Turkish", provider: "google" });
    expect(google.length).toBeGreaterThan(5);
    expect(google.every((v) => v.provider === "google")).toBe(true);
    const ids = allTtsVoices().map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("her saglayici katalogda veya dinamik olarak tanimlidir", () => {
    const providers = new Set(allTtsVoices().map((v) => v.provider));
    for (const p of TTS_PROVIDERS) {
      // ElevenLabs sesi kullanicinin hesabindan gelir, katalogda durmaz.
      if (p === "elevenlabs") continue;
      expect(providers.has(p)).toBe(true);
    }
    expect(elevenLabsVoice("abc123", "Türkçe").name).toBe("abc123");
    expect(ttsProviderInfo("azure").label).toContain("Azure");
  });

  it("Chirp3 perdeyi motorunda desteklemez, WaveNet destekler", () => {
    expect(ttsVoiceById("google:tr-TR-Chirp3-HD-Kore")?.supportsPitch).toBe(false);
    expect(ttsVoiceById("google:tr-TR-Wavenet-A")?.supportsPitch).toBe(true);
    expect(ttsVoiceById("azure:tr-TR-EmelNeural")?.supportsPitch).toBe(true);
  });
});

describe("Ses cozumleme", () => {
  it("ElevenLabs anahtari varsa Voice ID olmasa da oraya tasir", () => {
    const result = resolvePreferredTtsVoice({
      voiceId: "female",
      language: "Türkçe",
      provider: "google",
      readyProviders: ["elevenlabs", "google"],
      elevenLabsReady: true,
      elevenLabsVoiceId: "",
      preferElevenLabs: true,
    });
    expect(result.voice.provider).toBe("elevenlabs");
    expect(result.voice.id).toBe(ELEVENLABS_VOICE_ID);
  });

  it("ElevenLabs hazirsa sahne sesini oraya tasir", () => {
    const result = resolvePreferredTtsVoice({
      voiceId: "female",
      language: "Türkçe",
      provider: "google",
      readyProviders: ["elevenlabs", "google"],
      elevenLabsReady: true,
      elevenLabsVoiceId: "abcVoice",
      preferElevenLabs: true,
    });
    expect(result.voice.provider).toBe("elevenlabs");
    expect(result.voice.name).toBe("abcVoice");
    expect(result.voice.id).toBe(ELEVENLABS_VOICE_ID);
  });

  it("eski female/male kaydini dogru dilde sese cevirir", () => {
    expect(isLegacyVoiceId("female")).toBe(true);
    const result = resolveTtsVoice({ voiceId: "female", language: "Türkçe", provider: "google" });
    expect(result.switched).toBe(true);
    expect(result.voice.languageTag).toBe("tr");
    expect(result.voice.gender).toBe("female");
    expect(result.voice.provider).toBe("google");
  });

  it("dil uyusmayan sesi ayni cinsiyette dogru dile tasir", () => {
    // Asil hata: Turkce anlatida Ingilizce ses kullaniliyordu.
    const result = resolveTtsVoice({
      voiceId: "azure:en-US-JennyNeural",
      language: "Türkçe",
      provider: "azure",
    });
    expect(result.switched).toBe(true);
    expect(result.voice.name).toBe("tr-TR-EmelNeural");
    expect(result.reason).toContain("Turkce");
  });

  it("uyumlu ses aynen korunur", () => {
    const result = resolveTtsVoice({
      voiceId: "azure:tr-TR-AhmetNeural",
      language: "Turkish",
      provider: "azure",
    });
    expect(result.switched).toBe(false);
    expect(result.voice.name).toBe("tr-TR-AhmetNeural");
  });

  it("kayitli ses Ayarlar saglayicisindan bagimsiz korunur", () => {
    const result = resolveTtsVoice({
      voiceId: "openai:onyx:tr",
      language: "Turkish",
      provider: "piper",
    });
    expect(result.switched).toBe(false);
    expect(result.voice.provider).toBe("openai");
    expect(result.voice.name).toBe("onyx");
  });

  it("calisan ucretli sesleri Piper'dan once listeler", () => {
    const voices = ttsVoicesForReady({
      language: "Turkish",
      ready: { google: false, azure: false, elevenlabs: false, openai: true },
      includeLocalFree: true,
    });
    expect(voices[0]?.provider).toBe("openai");
    expect(voices.some((v) => v.provider === "piper")).toBe(true);
    expect(readyPaidProviders({ google: false, azure: true, elevenlabs: false, openai: true })).toEqual([
      "azure",
      "openai",
    ]);
  });

  it("eski kayitta ucretli hazir saglayiciyi Piper'a tercih eder", () => {
    const result = resolveTtsVoice({
      voiceId: "male",
      language: "Turkish",
      provider: "piper",
      readyProviders: ["openai"],
    });
    expect(result.voice.provider).toBe("openai");
    expect(result.voice.gender).toBe("male");
  });

  it("saglayici o dilde ses sunmuyorsa baska saglayiciya duser", () => {
    // Piper yalnizca Turkce sesler tasiyor.
    const result = resolveTtsVoice({ voiceId: "piper:tr_TR-dfki-medium", language: "English", provider: "piper" });
    expect(result.switched).toBe(true);
    expect(result.voice.languageTag).toBe("en");
  });
});

describe("Saglayici istekleri", () => {
  it("Azure SSML hiz ve perdeyi prosody ile tasir", () => {
    const ssml = buildAzureSsml({
      voiceName: "tr-TR-EmelNeural",
      languageCode: "tr-TR",
      text: "Kapı açıldı",
      speed: 1.1,
      pitchSemitones: -2,
    });
    expect(ssml).toContain('name="tr-TR-EmelNeural"');
    expect(ssml).toContain('rate="+10%"');
    expect(ssml).toContain('pitch="-2st"');
    expect(ssml).toContain("Kapı açıldı");
  });

  it("SSML metnini kacirir", () => {
    expect(escapeXml('5 < 6 & "x"')).toBe("5 &lt; 6 &amp; &quot;x&quot;");
    expect(buildAzureSsml({
      voiceName: "v",
      languageCode: "tr-TR",
      text: "<script>",
      speed: 1,
      pitchSemitones: 0,
    })).toContain("&lt;script&gt;");
  });

  it("Piper model adresleri onnx ve json dondurur", () => {
    const urls = piperModelUrls("tr_TR-dfki-medium");
    expect(urls?.onnx).toContain("tr_TR-dfki-medium.onnx");
    expect(urls?.config).toContain("tr_TR-dfki-medium.onnx.json");
    expect(piperModelUrls("yok-boyle-model")).toBeNull();
  });

  it("hiz filtresi 1.0'da bos, uclarda zincirlenir", () => {
    expect(buildTempoFilter(1)).toBe("");
    expect(buildTempoFilter(1.2)).toBe("atempo=1.20000");
    expect(buildTempoFilter(0.4)).toContain("atempo=0.5");
  });
});

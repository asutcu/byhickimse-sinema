import { describe, expect, it } from "vitest";
import {
  splitIntoSentences,
  splitStoryIntoClips,
  detectHook,
  maxWordsForClipSeconds,
  minWordsForClipSeconds,
  NARRATOR_SPEECH_FILL_RATIO,
  speechFillRatioFor,
} from "@/server/services/splitter";

describe("Cumle bolme", () => {
  it("metni dogal cumle sinirlarinda boler", () => {
    const sentences = splitIntoSentences("Merhaba. Bugun size bir sey anlatacagim. Hazir misiniz?");
    expect(sentences).toEqual(["Merhaba.", "Bugun size bir sey anlatacagim.", "Hazir misiniz?"]);
  });

  it("ondalik sayilari ve kisaltmalari cumle sonu saymaz", () => {
    const sentences = splitIntoSentences("Saat 3.5 saat surdu. Dr. Ahmet geldi. Bitti.");
    expect(sentences).toEqual(["Saat 3.5 saat surdu.", "Dr. Ahmet geldi.", "Bitti."]);
  });

  it("uc nokta ve unlem isaretlerini korur", () => {
    const sentences = splitIntoSentences("Kapiyi actim... Kimse yoktu! Sonra bir ses duydum.");
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toBe("Kapiyi actim...");
  });
});

describe("Kliplere bolme", () => {
  const story =
    "Merhaba, bugun size hayatimda yasadigim en tuhaf olayi anlatacagim. " +
    "Her sey gecen yaz kucuk bir sahil kasabasina tasinmamla basladi. " +
    "Ilk gece ust kattan ayak sesleri duydum. " +
    "Ertesi sabah komsuma sordum ama evin yillardir bos oldugunu soyledi. " +
    "O an sirtimdan asagi soguk bir urperti indi. " +
    "Yine de kalmaya karar verdim, cunku kira cok ucuzdu. " +
    "Ama kapiyi actigimda gordugum sey her seyi degistirdi...";

  it("cumleleri ortadan bolmez", () => {
    const clips = splitStoryIntoClips(story, { clipSeconds: 8, wpm: 130 });
    const rejoined = clips.map((c) => c.dialogue).join(" ");
    expect(rejoined.replace(/\s+/g, " ")).toBe(story.replace(/\s+/g, " "));
    // Her klip cumle sonu noktalama ile bitmeli
    for (const clip of clips) {
      expect(clip.dialogue.trim()).toMatch(/[.!?…]$/);
    }
  });

  it("klip sira numaralari 1'den baslar ve ardisik olur", () => {
    const clips = splitStoryIntoClips(story, { clipSeconds: 8, wpm: 130 });
    expect(clips.length).toBeGreaterThan(1);
    clips.forEach((clip, i) => expect(clip.index).toBe(i + 1));
  });

  it("klip surelerini hesaplar ve butceye yaklasik uyar", () => {
    const clips = splitStoryIntoClips(story, { clipSeconds: 8, wpm: 130 });
    for (const clip of clips) {
      expect(clip.estimatedDurationSeconds).toBeGreaterThan(0);
      // Tek cumle butceyi asabilir ama makul sinirda kalmali (2x)
      expect(clip.estimatedDurationSeconds).toBeLessThanOrEqual(16);
    }
  });

  it("cok kisa son klibi oncekiyle birlestirir", () => {
    const shortEnd = "Bu ilk cumle oldukca uzun ve normal bir cumledir tamam mi. Kisa son.";
    const clips = splitStoryIntoClips(shortEnd, { clipSeconds: 6, wpm: 130 });
    const last = clips[clips.length - 1];
    expect(last.dialogue.split(/\s+/).length).toBeGreaterThanOrEqual(2);
  });

  it("bos metin icin bos dizi doner", () => {
    expect(splitStoryIntoClips("", { clipSeconds: 8, wpm: 130 })).toEqual([]);
  });

  it("8 sn sahnede konusma butcesi 3-5 sn'lik kisa satira dusmez", () => {
    expect(maxWordsForClipSeconds(8, 130)).toBe(17);
    expect(minWordsForClipSeconds(8, 130)).toBe(14);
    // 14 kelime / 130 wpm = 6.5 sn — 3-5 sn'nin uzerinde
    expect((minWordsForClipSeconds(8, 130) / 130) * 60).toBeGreaterThan(6);
  });

  it("10 sn anlatici sahnesinde diyalog 8 sn butcesinden uzun olur", () => {
    expect(speechFillRatioFor("narrator")).toBe(NARRATOR_SPEECH_FILL_RATIO);
    const eight = maxWordsForClipSeconds(8, 143);
    const ten = maxWordsForClipSeconds(10, 143, NARRATOR_SPEECH_FILL_RATIO);
    expect(ten).toBeGreaterThan(eight);
    expect(ten).toBeGreaterThanOrEqual(26);
    const longStory = Array.from({ length: 16 }, (_, i) =>
      `Bu ${i + 1}. cumle aldatilma gecesini sakin sakin anlatir ve her sahneyi goz detayiyla doldurur.`
    ).join(" ");
    const clips8 = splitStoryIntoClips(longStory, { clipSeconds: 8, wpm: 143 });
    const clips10 = splitStoryIntoClips(longStory, {
      clipSeconds: 10,
      wpm: 143,
      safetyRatio: NARRATOR_SPEECH_FILL_RATIO,
    });
    expect(clips10.length).toBeLessThan(clips8.length);
    const avg10 =
      clips10.reduce((sum, c) => sum + c.estimatedDurationSeconds, 0) / clips10.length;
    const avg8 = clips8.reduce((sum, c) => sum + c.estimatedDurationSeconds, 0) / clips8.length;
    expect(avg10).toBeGreaterThan(avg8);
    expect(avg10).toBeGreaterThan(8);
  });

  it("bolunen kliplerin cogu sahne suresine yakin konusma tasir", () => {
    const longStory = Array.from({ length: 12 }, (_, i) =>
      `Bu ${i + 1}. cumle sahil kasabasinda gecen tuhaf geceyi sakin sakin anlatir ve meraki taze tutar.`
    ).join(" ");
    const clips = splitStoryIntoClips(longStory, { clipSeconds: 8, wpm: 130 });
    expect(clips.length).toBeGreaterThan(1);
    const body = clips.length > 2 ? clips.slice(0, -1) : clips;
    for (const clip of body) {
      expect(clip.estimatedDurationSeconds).toBeGreaterThanOrEqual(6);
      expect(clip.estimatedWords).toBeGreaterThanOrEqual(14);
    }
  });
});

describe("Kanca tespiti (Merak Mimarisi)", () => {
  it("soru ve uc nokta ile biten cumleleri kanca sayar", () => {
    expect(detectHook("Sonra ne oldu dersiniz?").hasHook).toBe(true);
    expect(detectHook("Kapiyi actigimda gordugum sey...").hasHook).toBe(true);
  });

  it("duz cumleyi kanca saymaz", () => {
    expect(detectHook("Kahvalti yaptim.").hasHook).toBe(false);
  });

  it("skor 0-10 araligindadir", () => {
    const result = detectHook("Ama birden, o an fark ettim: acaba bir sir mi vardi?");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });
});

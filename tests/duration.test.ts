import { describe, expect, it } from "vitest";
import { computeTargetWords, estimateSpeechSeconds, countWords } from "@/server/services/story";
import { maxWordsForClipSeconds, minWordsForClipSeconds } from "@/server/services/splitter";

describe("Hikaye sure hesabi", () => {
  it("hedef sure ve konusma hizindan kelime sayisi hesaplar", () => {
    // 3 dakika x 130 kelime/dk = 390 kelime
    expect(computeTargetWords(180, 130)).toBe(390);
    // 1 dakika x 110 = 110
    expect(computeTargetWords(60, 110)).toBe(110);
    // 10 dakika x 150 = 1500
    expect(computeTargetWords(600, 150)).toBe(1500);
  });

  it("kelime sayisindan konusma suresi tahmin eder", () => {
    expect(estimateSpeechSeconds(390, 130)).toBe(180);
    expect(estimateSpeechSeconds(65, 130)).toBe(30);
  });

  it("sinir durumlarini guvenli isler", () => {
    expect(computeTargetWords(0, 130)).toBe(0);
    expect(computeTargetWords(180, 0)).toBe(0);
    expect(estimateSpeechSeconds(0, 130)).toBe(0);
  });

  it("kelime sayar (coklu bosluk ve satir sonlari dahil)", () => {
    expect(countWords("Merhaba  dunya\nnasilsin")).toBe(3);
    expect(countWords("   ")).toBe(0);
  });

  it("8 sn klipte konusma kelime butcesi sahne suresine orantlidir", () => {
    const max = maxWordsForClipSeconds(8, 130);
    const min = minWordsForClipSeconds(8, 130);
    expect(estimateSpeechSeconds(max, 130)).toBeGreaterThanOrEqual(7);
    expect(estimateSpeechSeconds(min, 130)).toBeGreaterThanOrEqual(6);
    expect(estimateSpeechSeconds(min, 130)).toBeLessThanOrEqual(8);
  });
});

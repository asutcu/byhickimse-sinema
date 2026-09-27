import { describe, expect, it } from "vitest";
import {
  buildClipAlignedSrtCues,
  buildFilmStyleSrtCues,
  buildSrtCues,
  buildSrtContent,
  wrapSubtitleText,
  wrapSubtitleToFitClip,
} from "@/server/services/srt";

describe("SRT altyazi uretimi", () => {
  it("satirlari ~42 karakterde sarar", () => {
    const wrapped = wrapSubtitleText("Bu oldukca uzun bir cumledir ve kesinlikle kirk iki karakterden daha uzun olmalidir");
    for (const line of wrapped.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(50);
    }
  });

  it("klip surelerine gore zaman damgalari uretir", () => {
    const cues = buildSrtCues([
      { index: 1, dialogue: "Merhaba, bugun size bir sey anlatacagim.", durationSeconds: 8 },
      { index: 2, dialogue: "Her sey gecen yaz basladi.", durationSeconds: 6 },
    ]);
    expect(cues.length).toBeGreaterThanOrEqual(2);
    // Ikinci klibin kuyruklari 8. saniyeden sonra baslamali
    const secondClipCue = cues.find((c) => c.text.includes("gecen yaz"));
    expect(secondClipCue).toBeDefined();
    expect(secondClipCue!.startSeconds).toBeGreaterThanOrEqual(8);
  });

  it("kuyruk suresi 1-7 saniye araligindadir", () => {
    const cues = buildSrtCues([{ index: 1, dialogue: "Kisa.", durationSeconds: 8 }]);
    for (const cue of cues) {
      const duration = cue.endSeconds - cue.startSeconds;
      expect(duration).toBeGreaterThanOrEqual(0.9);
      expect(duration).toBeLessThanOrEqual(7.1);
    }
  });

  it("gecerli SRT bicimi uretir", () => {
    const content = buildSrtContent([
      { index: 1, startSeconds: 0, endSeconds: 2.5, text: "Merhaba" },
      { index: 2, startSeconds: 2.5, endSeconds: 5, text: "Dunya" },
    ]);
    expect(content).toContain("1\n00:00:00,000 --> 00:00:02,500\nMerhaba");
    expect(content).toContain("2\n00:00:02,500 --> 00:00:05,000\nDunya");
  });

  it("kuyruklar birbirleriyle ortusmez", () => {
    const cues = buildSrtCues([
      { index: 1, dialogue: "Merhaba. Bugun size hayatimda yasadigim en tuhaf olayi anlatacagim.", durationSeconds: 3 },
      { index: 2, dialogue: "Her sey gecen yaz basladi.", durationSeconds: 3 },
    ]);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startSeconds).toBeGreaterThanOrEqual(cues[i - 1].endSeconds);
    }
  });

  it("gorsel slaytta her klip tek altyazi ve tam sure", () => {
    const cues = buildClipAlignedSrtCues([
      { index: 1, dialogue: "Mutfaktaki isik hala yaniyordu ve telefon bir kez daha titredi.", durationSeconds: 15 },
      { index: 2, dialogue: "Kapi acildi.", durationSeconds: 12 },
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0].startSeconds).toBe(0);
    expect(cues[0].endSeconds).toBe(15);
    expect(cues[1].startSeconds).toBe(15);
    expect(cues[1].endSeconds).toBe(27);
    expect(cues[0].text.split("\n").length).toBeLessThanOrEqual(2);
  });

  it("uzun diyalogu klibe sigacak satir sayisina indirir", () => {
    const long =
      "Bu cumle gercekten cok uzun ve tek karede birkac satir halinde durmali ama uc satirdan fazla olmamali cunku goruntunun altindaki bant sinirlidir ve tasmasin.";
    const fitted = wrapSubtitleToFitClip(long);
    expect(fitted.split("\n").length).toBeLessThanOrEqual(2);
    expect(fitted.length).toBeGreaterThan(20);
  });

  it("film altyazisi 2 satirlik parcaciklarla klibi kaplar", () => {
    const cues = buildFilmStyleSrtCues([
      {
        index: 1,
        dialogue:
          "Mutfaktaki isik hala yaniyordu. Telefon bir kez daha titredi ve kapı aralandı.",
        durationSeconds: 12,
      },
    ]);
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0].startSeconds).toBe(0);
    expect(cues[cues.length - 1].endSeconds).toBe(12);
    for (const cue of cues) {
      expect(cue.text.split("\n").length).toBeLessThanOrEqual(2);
    }
  });

  it("bos diyaloglu klipleri atlar ama sureyi sayar", () => {
    const cues = buildSrtCues([
      { index: 1, dialogue: "", durationSeconds: 5 },
      { index: 2, dialogue: "Ikinci klip.", durationSeconds: 5 },
    ]);
    expect(cues[0].startSeconds).toBeGreaterThanOrEqual(5);
  });
});

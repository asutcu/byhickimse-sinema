import { describe, expect, it } from "vitest";
import { buildSrtCues, buildSrtContent } from "@/server/services/srt";
import { YOUTUBE_SUBTITLE_LANGS } from "@/server/services/youtube-subtitles";

describe("YouTube altyazi paketi", () => {
  it("6 dil tanimi TR/EN/DE/FR/ES/AR icerir ve dosya adlari dil etiketli", () => {
    expect(YOUTUBE_SUBTITLE_LANGS.map((l) => l.code)).toEqual(["tr", "en", "de", "fr", "es", "ar"]);
    for (const lang of YOUTUBE_SUBTITLE_LANGS) {
      expect(`youtube-altyazi-${lang.fileLabel}.srt`).toMatch(
        /youtube-altyazi-(turkce|english|almanca|fransizca|ispanyolca|arapca)\.srt/
      );
    }
    expect(YOUTUBE_SUBTITLE_LANGS.find((l) => l.code === "ar")?.youtube).toBe("Arabic");
  });

  it("zaman damgalari ceviri sonrasi ayni kalabilir (cue iskeleti)", () => {
    const cues = buildSrtCues([
      { index: 1, dialogue: "Merhaba arkadaşlar. Bugün tırmanış var.", durationSeconds: 8 },
      { index: 2, dialogue: "Ip gerildi!", durationSeconds: 6 },
    ]);
    // Ceviri yalnizca text degistirir — start/end ayni kalmali
    const translated = cues.map((c) => ({
      ...c,
      text: c.index === 1 ? "Hello friends. Today we climb." : "The rope went tight!",
    }));
    for (let i = 0; i < cues.length; i++) {
      expect(translated[i].startSeconds).toBe(cues[i].startSeconds);
      expect(translated[i].endSeconds).toBe(cues[i].endSeconds);
    }
    const srt = buildSrtContent(translated);
    expect(srt).toContain("Hello friends");
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} -->/);
  });
});

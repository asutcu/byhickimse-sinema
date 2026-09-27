import { describe, expect, it } from "vitest";
import {
  buildConcatListContent,
  clipsAreUniform,
  isSpawnNameTooLong,
  parseProbeOutput,
  quoteWindowsArg,
  WINDOWS_CMDLINE_SAFE,
  windowsCommandLineLength,
  type VideoInfo,
} from "@/server/services/ffmpeg";

describe("FFmpeg concat listesi", () => {
  it("Windows yollarini bolu ile normallestirir ve tek tirnak icine alir", () => {
    const content = buildConcatListContent(["C:\\projeler\\klip 1.mp4", "C:\\projeler\\klip2.mp4"]);
    expect(content).toBe("file 'C:/projeler/klip 1.mp4'\nfile 'C:/projeler/klip2.mp4'");
  });

  it("icteki tek tirnaklari kacirir", () => {
    const content = buildConcatListContent(["C:\\proje's\\clip.mp4"]);
    expect(content).toContain("'\\''");
  });
});

describe("ffprobe cikti ayristirma", () => {
  const sampleProbe = JSON.stringify({
    format: { duration: "8.016000", size: "2458624" },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1280,
        height: 720,
        pix_fmt: "yuv420p",
        avg_frame_rate: "24/1",
      },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000" },
    ],
  });

  it("video bilgilerini dogru cikartir", () => {
    const info = parseProbeOutput("test.mp4", sampleProbe);
    expect(info.durationSeconds).toBeCloseTo(8.016);
    expect(info.width).toBe(1280);
    expect(info.height).toBe(720);
    expect(info.fps).toBe(24);
    expect(info.videoCodec).toBe("h264");
    expect(info.audioCodec).toBe("aac");
    expect(info.audioSampleRate).toBe(48000);
    expect(info.pixelFormat).toBe("yuv420p");
    expect(info.sizeBytes).toBe(2458624);
  });

  it("video akisi olmayan dosyada hata firlatir", () => {
    const audioOnly = JSON.stringify({ format: { duration: "5" }, streams: [{ codec_type: "audio", codec_name: "aac" }] });
    expect(() => parseProbeOutput("ses.mp4", audioOnly)).toThrow(/Video akisi/);
  });

  it("kesirli fps degerini hesaplar (30000/1001)", () => {
    const ntsc = JSON.stringify({
      format: { duration: "10", size: "1000000" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p", avg_frame_rate: "30000/1001" }],
    });
    const info = parseProbeOutput("ntsc.mp4", ntsc);
    expect(info.fps).toBeCloseTo(29.97, 1);
  });
});

describe("Klip uyumluluk kontrolu", () => {
  const base: VideoInfo = {
    path: "a.mp4",
    durationSeconds: 8,
    width: 1280,
    height: 720,
    fps: 24,
    videoCodec: "h264",
    audioCodec: "aac",
    audioSampleRate: 48000,
    pixelFormat: "yuv420p",
    sizeBytes: 1000,
  };

  it("ayni ozellikli klipleri uyumlu sayar", () => {
    expect(clipsAreUniform([base, { ...base, path: "b.mp4" }])).toBe(true);
  });

  it("Windows komut satirinda bosluklu yolu tirnaklar", () => {
    expect(quoteWindowsArg("C:\\flow bot\\a.mp4")).toBe('"C:\\flow bot\\a.mp4"');
    expect(quoteWindowsArg("ffmpeg")).toBe("ffmpeg");
    const args = Array.from({ length: 130 }, (_, i) => [`-i`, `C:\\Users\\oem\\Desktop\\flow bot\\clips\\${String(i).padStart(3, "0")}-abcdefghij.mp4`]).flat();
    const inline = windowsCommandLineLength("ffmpeg", ["-y", ...args, "-filter_complex", "x".repeat(40_000), "out.mp4"]);
    const scripted = windowsCommandLineLength("ffmpeg", [
      "-y",
      ...args,
      "-filter_complex_script",
      "C:\\Users\\oem\\Desktop\\flow bot\\output\\final.filter.txt",
      "out.mp4",
    ]);
    expect(inline).toBeGreaterThan(WINDOWS_CMDLINE_SAFE);
    expect(scripted).toBeLessThan(WINDOWS_CMDLINE_SAFE);
    expect(isSpawnNameTooLong({ code: "ENAMETOOLONG", message: "spawn ENAMETOOLONG" })).toBe(true);
    expect(isSpawnNameTooLong(new Error("diger"))).toBe(false);
  });

  it("farkli cozunurlugu uyumsuz sayar", () => {
    expect(clipsAreUniform([base, { ...base, width: 1920, height: 1080 }])).toBe(false);
  });

  it("farkli ses codec'ini uyumsuz sayar", () => {
    expect(clipsAreUniform([base, { ...base, audioCodec: null }])).toBe(false);
  });
});

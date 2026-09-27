import { describe, expect, it } from "vitest";
import {
  longformEncodeProfile,
  longformFrameSize,
  longformH264Args,
  longformScaleFilter,
  parseLongformEncoder,
  parseLongformFps,
  parseLongformResolution,
} from "@/lib/longform-render";
import { DEFAULT_LONGFORM_SETTINGS, parseLongformSettings, serializeLongformSettings } from "@/lib/longform-catalog";
import { buildLongformFingerprint, shouldRebuildMix, shouldRebuildSegments, shouldRebuildStills } from "@/lib/longform-pipeline";
import { buildKenBurnsFilter, buildStillHoldFilter } from "@/server/services/ken-burns";

describe("slayt render bicimleri", () => {
  it("HD / QHD / 4K boyutlari cif ve 16:9", () => {
    expect(longformFrameSize("1080")).toEqual({ width: 1920, height: 1080 });
    expect(longformFrameSize("1440")).toEqual({ width: 2560, height: 1440 });
    expect(longformFrameSize("2160")).toEqual({ width: 3840, height: 2160 });
    for (const id of ["1080", "1440", "2160"] as const) {
      const { width, height } = longformFrameSize(id);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width / height).toBeCloseTo(16 / 9, 5);
    }
  });

  it("bozuk kaydi HD 24fps dengeliye dusurur", () => {
    expect(parseLongformResolution("4k")).toBe("1080");
    expect(parseLongformFps(60)).toBe(24);
    expect(parseLongformEncoder("ultra")).toBe("balanced");
  });

  it("4K icin High 5.1/5.2 ve daha yavas timeout", () => {
    const p24 = longformEncodeProfile("2160", "balanced", 24);
    const p30 = longformEncodeProfile("2160", "balanced", 30);
    const hd = longformEncodeProfile("1080", "fast", 24);
    expect(p24.profile).toBe("high");
    expect(p24.level).toBe("5.1");
    expect(p30.level).toBe("5.2");
    expect(p24.timeoutMultiplier).toBeGreaterThan(hd.timeoutMultiplier);
    expect(longformH264Args(p24).join(" ")).toContain("libx264");
    expect(longformH264Args(p24).join(" ")).toContain("yuv420p");
  });

  it("olcek filtresi hedefe pad + fps yazar", () => {
    const filter = longformScaleFilter(3840, 2160, 25);
    expect(filter).toContain("scale=3840:2160");
    expect(filter).toContain("pad=3840:2160");
    expect(filter).toContain("fps=25");
    expect(filter).toContain("lanczos");
  });

  it("ayar yuvarlak doner", () => {
    const parsed = parseLongformSettings(
      JSON.stringify({
        ...DEFAULT_LONGFORM_SETTINGS,
        outputResolution: "2160",
        renderFps: 30,
        renderEncoder: "quality",
      })
    );
    expect(parsed.outputResolution).toBe("2160");
    expect(parsed.renderFps).toBe(30);
    expect(parsed.renderEncoder).toBe("quality");
    expect(parseLongformSettings(serializeLongformSettings(parsed)).outputResolution).toBe("2160");
  });

  it("cozunurluk degisince mix ve segment ister, kare silmez", () => {
    const previous = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, outputResolution: "1080" },
      storyText: "Metin",
    });
    const next = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, outputResolution: "2160" },
      storyText: "Metin",
    });
    expect(shouldRebuildStills(previous, next)).toBe(false);
    expect(shouldRebuildSegments(previous, next)).toBe(true);
    expect(shouldRebuildMix(previous, next)).toBe(true);
    expect(next.renderKey).toContain("2160");
  });

  it("4K ken burns 2x tampon kullanmaz", () => {
    const filter = buildKenBurnsFilter({ durationSeconds: 8, width: 3840, height: 2160, fps: 24 });
    expect(filter).toContain("3840x2160");
    expect(filter).not.toContain("7680:4320");
    expect(buildStillHoldFilter({ width: 2560, height: 1440 })).toContain("scale=2560:1440");
  });
});

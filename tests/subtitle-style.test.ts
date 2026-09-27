import { describe, expect, it } from "vitest";
import {
  buildAssContent,
  buildAssForceStyle,
  DEFAULT_SUBTITLE_STYLE,
  hexToAssColor,
  subtitleBelowBandHeight,
  subtitleFontSize,
  subtitleMarginH,
  parseSubtitleStyle,
  subtitleAssAlignment,
  subtitleStyleFingerprint,
} from "@/lib/subtitle-style";
import { parseLongformSettings, serializeLongformSettings, DEFAULT_LONGFORM_SETTINGS } from "@/lib/longform-catalog";

describe("altyazi stili", () => {
  it("bos kaydi varsayilana cevirir (kapali, film alti)", () => {
    const style = parseSubtitleStyle(undefined);
    expect(style.enabled).toBe(false);
    expect(style.position).toBe("bottom");
    expect(style.color).toBe("#FFFFFF");
    expect(subtitleStyleFingerprint(style)).toBe("off");
  });

  it("gecersiz rengi dusurur, gecerli stili korur", () => {
    const style = parseSubtitleStyle({
      enabled: true,
      position: "center",
      color: "red",
      outlineColor: "#112233",
      size: "large",
      look: "outline",
      bold: false,
      font: "impact",
    });
    expect(style.color).toBe("#FFFFFF");
    expect(style.outlineColor).toBe("#112233");
    expect(style.position).toBe("center");
    expect(style.font).toBe("impact");
    expect(subtitleStyleFingerprint(style)).toContain("on|center");
  });

  it("ASS rengi BGR + alpha yazar", () => {
    expect(hexToAssColor("#FFFFFF", 0)).toBe("&H00FFFFFF");
    expect(hexToAssColor("#FF0000", 0)).toBe("&H000000FF");
    expect(hexToAssColor("#000000", 128)).toBe("&H80000000");
  });

  it("konum her klipte ayni hizayi kilitler", () => {
    expect(subtitleAssAlignment("below")).toBe(2);
    expect(subtitleAssAlignment("bottom")).toBe(2);
    expect(subtitleAssAlignment("center")).toBe(5);
    expect(subtitleAssAlignment("top")).toBe(8);
    const force = buildAssForceStyle({ ...DEFAULT_SUBTITLE_STYLE, enabled: true, position: "below" }, 1080);
    expect(force).toContain("Alignment=2");
    expect(force).toContain("FontName=Arial");
    expect(force).toMatch(/MarginV=\d+/);
    expect(force).toMatch(/MarginL=\d+/);
    expect(force).toMatch(/MarginR=\d+/);
    const marginV = Number(/MarginV=(\d+)/.exec(force)?.[1] || 0);
    const band = subtitleBelowBandHeight(1080, "medium");
    expect(band % 2).toBe(0);
    expect(marginV).toBeLessThan(band);
    expect(marginV).toBeGreaterThanOrEqual(14);
    expect(subtitleMarginH(1080)).toBeGreaterThanOrEqual(48);
  });

  it("video alti bant 16:9 karenin disinda kalir", () => {
    const band = subtitleBelowBandHeight(1080, "small");
    expect(band).toBeGreaterThanOrEqual(120);
    const force = buildAssForceStyle(
      { ...DEFAULT_SUBTITLE_STYLE, enabled: true, position: "below", size: "small" },
      1080,
      { belowBand: band }
    );
    const marginV = Number(/MarginV=(\d+)/.exec(force)?.[1] || 0);
    expect(marginV + 40).toBeLessThanOrEqual(band);
  });

  it("longform ayarlarinda altyazi yuvarlak doner", () => {
    const parsed = parseLongformSettings(
      JSON.stringify({
        ...DEFAULT_LONGFORM_SETTINGS,
        subtitles: { enabled: true, position: "bottom", color: "#EEEEEE", look: "shadow" },
      })
    );
    expect(parsed.subtitles.enabled).toBe(true);
    expect(parsed.subtitles.position).toBe("bottom");
    expect(parsed.subtitles.look).toBe("shadow");
    expect(parseLongformSettings(serializeLongformSettings(parsed)).subtitles).toEqual(parsed.subtitles);
  });

  it("film alti punto sahne ortasini kaplamaz", () => {
    expect(subtitleFontSize("medium", 1080)).toBe(46);
    expect(subtitleFontSize("large", 1080)).toBe(56);
    expect(subtitleFontSize("large", 1080)).toBeGreaterThan(subtitleFontSize("medium", 1080));
    const force = buildAssForceStyle({ ...DEFAULT_SUBTITLE_STYLE, enabled: true, position: "bottom", size: "large" }, 1080);
    const marginV = Number(/MarginV=(\d+)/.exec(force)?.[1] || 0);
    expect(force).toContain("Alignment=2");
    expect(marginV).toBeGreaterThanOrEqual(36);
    expect(marginV).toBeLessThan(1080 * 0.12);
  });

  it("ASS PlayRes cikis karesiyle ayni kalir", () => {
    const ass = buildAssContent(
      [{ startSeconds: 0, endSeconds: 2, text: "Altta durur.\nIkinci satir." }],
      { ...DEFAULT_SUBTITLE_STYLE, enabled: true, position: "bottom", size: "large" },
      1920,
      1080
    );
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("Alignment,");
    expect(ass).toContain("\\N");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Altta durur.\\NIkinci satir.");
  });
});

import { describe, expect, it } from "vitest";
import {
  cropFilterFor,
  FRONT_PANEL_LEFT_HALF,
  frontPanelRectFromRgba,
  rgbaLooksBlank,
} from "@/lib/still-front-crop";
import type { DecodedRgba } from "@/lib/png-rgba";

/** Test goruntusu: gri studyo zemin + istenen dikdortgenlere koyu figur. */
function makeImage(
  width: number,
  height: number,
  figures: Array<{ x0: number; x1: number; y0: number; y1: number }>,
  background = 150
): DecodedRgba {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inFigure = figures.some((f) => x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1);
      const value = inFigure ? 40 : background;
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("kare referansi: on panel kirpmasi", () => {
  it("on+arka sheet'te SOL paneli kirpar, ortadaki bos serit alinmaz", () => {
    // Sol panel figuru x 20..44, sag panel figuru x 84..108 (orta bos).
    const img = makeImage(128, 72, [
      { x0: 20, x1: 44, y0: 6, y1: 66 },
      { x0: 84, x1: 108, y0: 6, y1: 66 },
    ]);
    const rect = frontPanelRectFromRgba(img);
    // Kirpma sol yarimda kalir (x + w <= 0.5) ve figuru icerir.
    expect(rect.xFrac + rect.wFrac).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(rect.xFrac * 128).toBeLessThanOrEqual(20);
    expect((rect.xFrac + rect.wFrac) * 128).toBeGreaterThanOrEqual(44);
    // Eski hata: ortadan kirpmak (x ~ 0.41) bos gri veriyordu.
    expect(rect.xFrac).toBeLessThan(0.35);
  });

  it("figur bulunamazsa sol yarimin tamamina duser", () => {
    const flat = makeImage(120, 80, []);
    expect(frontPanelRectFromRgba(flat)).toEqual(FRONT_PANEL_LEFT_HALF);
  });

  it("ince panel cizgisi figur sayilmaz", () => {
    // Sadece 2 piksellik dikey ayirici cizgi.
    const img = makeImage(120, 80, [{ x0: 58, x1: 60, y0: 0, y1: 80 }]);
    expect(frontPanelRectFromRgba(img)).toEqual(FRONT_PANEL_LEFT_HALF);
  });

  it("bos gri kare bos sayilir, figurlu kare sayilmaz", () => {
    expect(rgbaLooksBlank(makeImage(60, 40, []))).toBe(true);
    expect(rgbaLooksBlank(makeImage(60, 40, [{ x0: 10, x1: 40, y0: 5, y1: 35 }]))).toBe(false);
  });

  it("crop filtresi oran tabanlidir (gercek boyut gerekmez)", () => {
    expect(cropFilterFor(FRONT_PANEL_LEFT_HALF)).toBe("crop=iw*0.5000:ih*1.0000:iw*0.0000:ih*0.0000");
    expect(cropFilterFor({ wFrac: 0.4, hFrac: 0.9, xFrac: 0.05, yFrac: 0.02 })).toBe(
      "crop=iw*0.4000:ih*0.9000:iw*0.0500:ih*0.0200"
    );
  });
});

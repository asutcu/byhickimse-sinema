import { describe, expect, it } from "vitest";
import { computeThumbnailTextLayout, estimateTextWidthEm } from "@/server/services/ffmpeg";

const W = 1280;
const H = 720;

/** Kutu dahil metin blogunun kapladigi genislik (px). */
function blockWidth(layout: ReturnType<typeof computeThumbnailTextLayout>): number {
  const longestEm = Math.max(...layout.lines.map((line) => estimateTextWidthEm(line)));
  return longestEm * layout.fontSize + layout.boxBorderWidth * 2;
}

/** Kutu dahil metin blogunun kapladigi yukseklik (px). */
function blockHeight(layout: ReturnType<typeof computeThumbnailTextLayout>): number {
  return layout.lines.length * layout.fontSize * 1.18 + layout.boxBorderWidth * 2;
}

describe("Thumbnail kapak yazisi yerlesimi", () => {
  it("kisa yazi tek satirda kalir ve gorsele sigar", () => {
    const layout = computeThumbnailTextLayout({ text: "Vay Canına!", width: W, height: H });
    expect(layout.lines).toHaveLength(1);
    expect(blockWidth(layout)).toBeLessThanOrEqual(W);
    expect(blockHeight(layout)).toBeLessThanOrEqual(H);
  });

  it("uzun yazi tasmaz: punto kucultulur veya satira bolunur", () => {
    const layout = computeThumbnailTextLayout({
      text: "Sakın Kaçırma Bunu",
      width: W,
      height: H,
    });
    expect(blockWidth(layout)).toBeLessThanOrEqual(W * 0.9);
    expect(blockHeight(layout)).toBeLessThanOrEqual(H * 0.35);
  });

  it("punto ust sinirla kapali — resme gore asiri buyuk olmaz", () => {
    const layout = computeThumbnailTextLayout({ text: "Ne?", width: W, height: H });
    // YouTube drama kapagi: dev ama h/7 sabitinden kucuk kalir
    expect(layout.fontSize).toBeLessThanOrEqual(Math.floor(H * 0.125));
    expect(layout.fontSize).toBeLessThan(H / 7);
  });

  it("cok satira bolunurken satirlar dengeli olur", () => {
    const layout = computeThumbnailTextLayout({
      text: "Bunu Sakın Kaçırmayın Çok Önemli Bir An",
      width: W,
      height: H,
      maxLines: 2,
    });
    expect(layout.lines).toHaveLength(2);
    const widths = layout.lines.map((line) => estimateTextWidthEm(line));
    // en uzun satir, en kisa satirin 1.6 katindan fazla olmasin (dengesiz bolme yok)
    expect(Math.max(...widths) / Math.min(...widths)).toBeLessThan(1.6);
    expect(blockWidth(layout)).toBeLessThanOrEqual(W);
  });

  it("kontur ve kutu boslugu puntoyla oranli buyur", () => {
    const small = computeThumbnailTextLayout({ text: "Bunu Kaçırma Sakın", width: 640, height: 360 });
    const large = computeThumbnailTextLayout({ text: "Bunu Kaçırma Sakın", width: 1920, height: 1080 });
    expect(large.fontSize).toBeGreaterThan(small.fontSize);
    expect(large.borderWidth).toBeGreaterThan(small.borderWidth);
    expect(large.boxBorderWidth).toBeGreaterThan(small.boxBorderWidth);
  });

  it("dikey (9:16) gorselde de yazi genisliğe sigar", () => {
    const layout = computeThumbnailTextLayout({ text: "Şimdi Ne Oldu", width: 720, height: 1280 });
    expect(blockWidth(layout)).toBeLessThanOrEqual(720);
  });

  it("tek kelimelik uzun yazi bolunmeden sigacak sekilde kuculur", () => {
    const layout = computeThumbnailTextLayout({ text: "Kaçırmayacaksınız", width: W, height: H });
    expect(layout.lines).toHaveLength(1);
    expect(blockWidth(layout)).toBeLessThanOrEqual(W);
  });
});

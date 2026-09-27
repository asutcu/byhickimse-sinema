import { decodeImageRgba } from "@/lib/png-rgba";

/** PNG IHDR / JPEG SOF. */
export function readImageDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 16 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return null;
}

/** Tam 16:9 slayt (kutuphane 717×400 ve 4:3 yuz karesi elenir). */
export function bufferLooksLikeStorySlide(buf: Buffer): boolean {
  const dims = readImageDimensions(buf);
  if (!dims) return false;
  const ratio = dims.w / dims.h;
  return dims.w >= 1100 && dims.h >= 600 && ratio >= 1.5 && ratio <= 2.4;
}

/**
 * 16:9 on+arka turnaround / gri stüdyo katalog karesi.
 * Flow sayfasinda canvas/CSP guvenilmez; Playwright PNG tamponu yerelde orneklenir.
 */
export function bufferLooksLikeCharacterSheet(buf: Buffer): boolean {
  const img = decodeImageRgba(buf);
  if (!img || img.width < 200 || img.height < 120) return false;
  const { width: W, height: H, data } = img;
  const ratio = W / H;
  if (ratio < 1.15 || ratio > 2.5) return false;

  const gw = 80;
  const gh = 45;
  const x0 = Math.floor(W * 0.08);
  const x1 = Math.max(x0 + 8, Math.floor(W * 0.92));
  const y0 = Math.floor(H * 0.08);
  const y1 = Math.max(y0 + 8, Math.floor(H * 0.78));

  const lumAt = (gx: number, gy: number) => {
    const sx = x0 + Math.floor((gx / (gw - 1)) * (x1 - x0 - 1));
    const sy = y0 + Math.floor((gy / (gh - 1)) * (y1 - y0 - 1));
    const i = (Math.max(0, Math.min(H - 1, sy)) * W + Math.max(0, Math.min(W - 1, sx))) * 4;
    return (data[i] + data[i + 1] + data[i + 2]) / 3;
  };

  const topL = lumAt(4, 3);
  const topR = lumAt(gw - 5, 3);
  const botL = lumAt(4, gh - 5);
  const botR = lumAt(gw - 5, gh - 5);
  const topStudio = topL > 108 && topR > 108 && Math.abs(topL - topR) < 50;
  // Ayakkabi golgesi bir koseyi karartabiliyor (006.jpg botL ~93).
  const floorStudio = botL > 86 && botR > 86 && (botL > 108 || botR > 108);

  let mid = 0;
  for (let y = 2; y < gh - 2; y += 1) mid += lumAt(Math.floor(gw / 2), y);
  mid /= Math.max(1, gh - 4);

  const darkFrac = (x0g: number, x1g: number) => {
    let dark = 0;
    let tot = 0;
    for (let x = x0g; x < x1g; x += 1) {
      for (let y = 5; y < gh - 3; y += 1) {
        tot += 1;
        if (lumAt(x, y) < 108) dark += 1;
      }
    }
    return tot ? dark / tot : 0;
  };

  const leftFig = darkFrac(Math.floor(gw * 0.08), Math.floor(gw * 0.4));
  const rightFig = darkFrac(Math.floor(gw * 0.6), Math.floor(gw * 0.92));
  const centerGap = darkFrac(Math.floor(gw * 0.45), Math.floor(gw * 0.55));
  const centerFig = darkFrac(Math.floor(gw * 0.34), Math.floor(gw * 0.66));
  const leftEdge = darkFrac(0, Math.floor(gw * 0.12));
  const rightEdge = darkFrac(Math.floor(gw * 0.88), gw);
  const diptych = mid >= 100 && leftFig > 0.05 && rightFig > 0.05 && centerGap < Math.min(leftFig, rightFig) * 0.9;
  const singleCatalog = centerFig > 0.1 && leftEdge < 0.05 && rightEdge < 0.05;
  let seamDark = 0;
  const cx = Math.floor(gw / 2);
  for (let y = 0; y < gh; y += 1) {
    if (lumAt(cx, y) < 50) seamDark += 1;
  }
  const blackCenterLine = seamDark / gh > 0.4 && leftFig > 0.04 && rightFig > 0.04;
  if ((!topStudio || !floorStudio) && !blackCenterLine) return false;

  // Acik ten / krem gomlek gri stüdyoda "darkFrac" ile gorunmez; koseler stüdyo
  // ve karenin cogu notr acik griyse bu da katalog MCU'dur.
  let studio = 0;
  let tot = 0;
  let chroma = 0;
  let mean = 0;
  for (let x = 0; x < gw; x += 1) {
    for (let y = 0; y < gh; y += 1) {
      const sx = x0 + Math.floor((x / (gw - 1)) * (x1 - x0 - 1));
      const sy = y0 + Math.floor((y / (gh - 1)) * (y1 - y0 - 1));
      const i = (Math.max(0, Math.min(H - 1, sy)) * W + Math.max(0, Math.min(W - 1, sx))) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const L = (r + g + b) / 3;
      tot += 1;
      mean += L;
      chroma += Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
      if (L > 125 && L < 210) studio += 1;
    }
  }
  const grayCyclorama = tot > 0 && studio / tot > 0.5 && chroma / tot < 42 && mean / tot > 100;
  const studioLook = grayCyclorama || (topStudio && floorStudio && tot > 0 && mean / tot > 100);

  return grayCyclorama || (studioLook && (diptych || singleCatalog || blackCenterLine));
}

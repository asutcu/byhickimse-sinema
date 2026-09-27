import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
const jpeg = require("jpeg-js") as {
  decode: (buf: Buffer, opts?: object) => { width: number; height: number; data: Uint8Array };
};

export type DecodedRgba = { width: number; height: number; data: Buffer };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Playwright ekran goruntusu ve standart 8-bit RGB/RGBA PNG. */
export function decodePngRgba(buf: Buffer): DecodedRgba | null {
  if (buf.length < 33 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 1;
  const idats: Buffer[] = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (off + 12 + len > buf.length) break;
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idats.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
  if (colorType !== 0 && colorType !== 2 && colorType !== 6) return null;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idats));
  } catch {
    return null;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (inflated.length < expected) return null;
  const rgba = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src];
    src += 1;
    inflated.copy(cur, 0, src, src + stride);
    src += stride;
    if (filter === 1) {
      for (let i = bpp; i < stride; i += 1) cur[i] = (cur[i] + cur[i - bpp]) & 255;
    } else if (filter === 2) {
      for (let i = 0; i < stride; i += 1) cur[i] = (cur[i] + prev[i]) & 255;
    } else if (filter === 3) {
      for (let i = 0; i < stride; i += 1) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i += 1) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        cur[i] = (cur[i] + paeth(a, b, c)) & 255;
      }
    } else if (filter !== 0) {
      return null;
    }
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (bpp === 1) {
        const g = cur[x];
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      } else {
        const p = x * bpp;
        rgba[o] = cur[p];
        rgba[o + 1] = cur[p + 1];
        rgba[o + 2] = cur[p + 2];
        rgba[o + 3] = bpp === 4 ? cur[p + 3] : 255;
      }
    }
    cur.copy(prev);
  }
  return { width, height, data: rgba };
}

/** Flow slaytlari cogu zaman JPEG; sheet tespiti PNG-only kalirsa turnaround kaciyor. */
export function decodeJpegRgba(buf: Buffer): DecodedRgba | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  try {
    const decoded = jpeg.decode(buf, { maxMemoryUsageInMB: 96, useTArray: true });
    if (!decoded?.width || !decoded?.height || !decoded.data?.length) return null;
    return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
  } catch {
    return null;
  }
}

export function decodeImageRgba(buf: Buffer): DecodedRgba | null {
  return decodePngRgba(buf) ?? decodeJpegRgba(buf);
}

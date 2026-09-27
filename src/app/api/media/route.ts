import fs from "node:fs";
import path from "node:path";
import { isInsideProjectsRoot, relocateStoredProjectFile } from "@/server/lib/paths";

export const runtime = "nodejs";

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".srt": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * Proje klasorundeki medya dosyalarini panele akitir.
 * Guvenlik: yalnizca projects/ koku altindaki dosyalar servis edilir.
 * Video icin HTTP Range destegi vardir (oynatici sarma yapabilsin).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) return new Response("path parametresi gerekli", { status: 400 });

  const resolved = relocateStoredProjectFile(filePath);
  if (!resolved || !isInsideProjectsRoot(resolved)) {
    return new Response("Erisim engellendi: dosya proje klasoru disinda", { status: 403 });
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return new Response("Dosya bulunamadi", { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  const stat = fs.statSync(resolved);

  const range = request.headers.get("range");
  if (range && ext === ".mp4") {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : NaN;
      const end = Number.isFinite(requestedEnd)
        ? Math.min(requestedEnd, stat.size - 1)
        : Math.min(start + 16 * 1024 * 1024, stat.size - 1);
      if (start < 0 || start >= stat.size || end < start) {
        return new Response("Range gecersiz", {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(resolved, { start, end });
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": mime,
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const stream = fs.createReadStream(resolved);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}

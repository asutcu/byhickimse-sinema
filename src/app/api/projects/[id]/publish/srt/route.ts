import { z } from "zod";
import { handle } from "@/server/lib/api";
import { generateSrtFile } from "@/server/services/publish";
import { generateYoutubeSubtitlePack } from "@/server/services/youtube-subtitles";

export const runtime = "nodejs";
export const maxDuration = 900;

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  /** pack = TR/EN/DE/ES/AR YouTube paketi (varsayilan). single = eski tek dil. */
  mode: z.enum(["pack", "single"]).default("pack"),
  languageVariant: z.string().default("primary"),
  /** true = tum dilleri yeniden cevir. false/default = eksik dosyalari tamamla. */
  force: z.boolean().default(false),
});

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = schema.parse(await request.json().catch(() => ({})));

    if (body.mode === "single") {
      const path = await generateSrtFile(id, body.languageVariant);
      return { mode: "single" as const, path };
    }

    const pack = await generateYoutubeSubtitlePack(id, {
      force: body.force,
      onlyMissing: !body.force,
    });
    return {
      mode: "pack" as const,
      cueCount: pack.cueCount,
      sourceLang: pack.sourceLang,
      complete: pack.complete,
      errors: pack.errors,
      files: pack.files.map((f) => ({
        code: f.code,
        name: f.name,
        youtube: f.youtube,
        path: f.path,
        downloadName: f.downloadName,
        cueCount: f.cueCount,
        fromCache: f.fromCache ?? false,
      })),
    };
  });
}

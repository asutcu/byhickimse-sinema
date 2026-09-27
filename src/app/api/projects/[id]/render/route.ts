import { z } from "zod";
import { handle } from "@/server/lib/api";
import { renderProject, getLatestRenderReport, listFinalRenders } from "@/server/services/render";
import { FfmpegCancelledError } from "@/server/services/ffmpeg";
import { RenderCancelledError } from "@/server/services/render-jobs";
import { parseSubtitleStyle } from "@/lib/subtitle-style";

export const runtime = "nodejs";
export const maxDuration = 1800;

type Params = { params: Promise<{ id: string }> };

const renderSchema = z.object({
  mode: z.enum(["direct", "reencode", "auto"]).default("auto"),
  audioFadeMs: z.number().int().min(0).max(300).default(0),
  trimSilence: z.boolean().default(false),
  trimBlack: z.boolean().default(false),
  outputResolution: z.enum(["source", "1080", "1440", "2160"]).default("source"),
  burnSubtitles: z.boolean().default(false),
  subtitleStyle: z
    .object({
      enabled: z.boolean().optional(),
      position: z.enum(["below", "bottom", "center", "top"]).optional(),
      color: z.string().optional(),
      outlineColor: z.string().optional(),
      size: z.enum(["small", "medium", "large"]).optional(),
      look: z.enum(["box", "outline", "shadow"]).optional(),
      bold: z.boolean().optional(),
      font: z.enum(["arial", "segoe", "impact"]).optional(),
    })
    .optional(),
});

function isCancelError(err: unknown): boolean {
  return err instanceof FfmpegCancelledError || err instanceof RenderCancelledError;
}

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = renderSchema.parse(await request.json().catch(() => ({})));
    const burnSubtitles = body.burnSubtitles || body.subtitleStyle?.enabled === true;
    const subtitleStyle = parseSubtitleStyle({ ...body.subtitleStyle, enabled: burnSubtitles });
    try {
      return await renderProject(id, {
        mode: body.mode,
        audioFadeMs: body.audioFadeMs,
        trimSilence: body.trimSilence,
        trimBlack: body.trimBlack,
        outputResolution: body.outputResolution,
        burnSubtitles,
        subtitleStyle,
      });
    } catch (err) {
      if (isCancelError(err)) {
        return {
          cancelled: true as const,
          message: "Birlestirme iptal edildi",
          jobId: err instanceof RenderCancelledError ? err.jobId : undefined,
        };
      }
      throw err;
    }
  });
}

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const [report, finals] = await Promise.all([getLatestRenderReport(id), listFinalRenders(id)]);
    return { report, finals };
  });
}

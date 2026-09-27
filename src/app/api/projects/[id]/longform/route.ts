import { z } from "zod";
import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { getLongformJob } from "@/server/services/longform-jobs";
import { getLongformSnapshot } from "@/server/services/longform";
import {
  LONGFORM_GENRE_IDS,
  longformSettingsSource,
  longformStoredGenreName,
  parseLongformSettings,
  serializeLongformSettings,
} from "@/lib/longform-catalog";
import { parseSubtitleStyle } from "@/lib/subtitle-style";
import { persistProjectFlowImageModel } from "@/server/lib/flow-image-model-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const snapshot = await getLongformSnapshot(id);
    return { ...snapshot, job: getLongformJob(id) };
  });
}

const patchSchema = z.object({
  genreId: z.enum(LONGFORM_GENRE_IDS).optional(),
  customGenre: z.string().max(80).optional(),
  // TTS katalogu kimligi ("google:tr-TR-Chirp3-HD-Kore") veya eski female/male
  voiceId: z.string().min(1).max(120).optional(),
  ttsSpeed: z.number().min(0.7).max(1.3).optional(),
  ttsPitch: z.number().int().min(-6).max(6).optional(),
  ttsExpressive: z.boolean().optional(),
  stillIntervalSeconds: z.union([z.literal(10), z.literal(15), z.literal(20)]).optional(),
  visualFormat: z.literal("stills").optional(),
  stillMotion: z.enum(["hold", "kenburns"]).optional(),
  musicEnabled: z.boolean().optional(),
  musicFileName: z.string().optional(),
  imageProvider: z.literal("flow").optional(),
  imageModel: z.string().min(1).max(80).optional(),
  outputResolution: z.enum(["1080", "1440", "2160"]).optional(),
  renderFps: z.union([z.literal(24), z.literal(25), z.literal(30)]).optional(),
  renderEncoder: z.enum(["fast", "balanced", "quality"]).optional(),
  subtitles: z
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

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    const current = parseLongformSettings(longformSettingsSource(project));
    const body = patchSchema.parse(await request.json());
    const next = {
      ...current,
      ...body,
      subtitles: parseSubtitleStyle({ ...current.subtitles, ...body.subtitles }),
    };
    const payload = serializeLongformSettings(next);
    const updated = await prisma.project.update({
      where: { id },
      data: {
        longformSettings: payload,
        genre: longformStoredGenreName(next),
        aspectRatio: "16:9",
        clipSeconds: next.stillIntervalSeconds,
        allowSubtitles: next.subtitles.enabled,
      },
    });
    await persistProjectFlowImageModel(id, next.imageModel);
    return { settings: parseLongformSettings(longformSettingsSource(updated)) };
  });
}

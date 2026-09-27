import { z } from "zod";
import { handle } from "@/server/lib/api";
import {
  describeOpenAiKey,
  describeTtsSecrets,
  getSettings,
  setTtsSecret,
  updateSettings,
} from "@/server/services/settings";

export const runtime = "nodejs";

const updateSchema = z.object({
  openaiModel: z.string().min(1).optional(),
  flowUrl: z.string().url().optional(),
  chromeProfileDir: z.string().optional(),
  downloadDir: z.string().optional(),
  ffmpegPath: z.string().min(1).optional(),
  ffprobePath: z.string().min(1).optional(),
  maxRetries: z.number().int().min(1).max(10).optional(),
  waitBetweenGenerationsMs: z.number().int().min(0).max(600_000).optional(),
  generationTimeoutMs: z.number().int().min(30_000).max(3_600_000).optional(),
  pollIntervalMs: z.number().int().min(500).max(60_000).optional(),
  defaultFlowModel: z.string().optional(),
  defaultClipSeconds: z.number().int().min(2).max(20).optional(),
  defaultAspectRatio: z.string().optional(),
  headless: z.boolean().optional(),
  slowMoMs: z.number().int().min(0).max(2_000).optional(),
  maxParallelProjects: z.number().int().min(1).max(6).optional(),
  wpmSlow: z.number().int().min(60).max(240).optional(),
  wpmNormal: z.number().int().min(60).max(240).optional(),
  wpmFast: z.number().int().min(60).max(240).optional(),
  modelSupportMatrix: z.string().optional(),
  // Seslendirme
  ttsProvider: z.enum(["google", "azure", "piper", "elevenlabs", "openai"]).optional(),
  azureSpeechRegion: z.string().max(40).optional(),
  elevenLabsVoiceId: z.string().max(120).optional(),
  piperPython: z.string().max(260).optional(),
  piperModelDir: z.string().max(400).optional(),
  // Anahtarlar: sifreli saklanir, GET'te asla donmez. Bos gonderilirse silinir.
  googleTtsApiKey: z.string().max(400).optional(),
  azureSpeechKey: z.string().max(400).optional(),
  elevenLabsApiKey: z.string().max(400).optional(),
});

/** Sifreli anahtar alanlari istemciye hicbir zaman gonderilmez. */
function stripSecrets(settings: Awaited<ReturnType<typeof getSettings>>) {
  const {
    openaiApiKeyEncrypted: _openai,
    googleTtsKeyEncrypted: _google,
    azureSpeechKeyEncrypted: _azure,
    elevenLabsKeyEncrypted: _eleven,
    sunoApiKeyEncrypted: _suno,
    ...safe
  } = settings as typeof settings & {
    googleTtsKeyEncrypted?: string | null;
    azureSpeechKeyEncrypted?: string | null;
    elevenLabsKeyEncrypted?: string | null;
    sunoApiKeyEncrypted?: string | null;
  };
  return safe;
}

export async function GET() {
  return handle(async () => {
    const settings = await getSettings();
    const keyInfo = await describeOpenAiKey();
    return {
      settings: stripSecrets(settings),
      openaiKey: keyInfo,
      ttsSecrets: describeTtsSecrets(settings),
    };
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    const body = updateSchema.parse(await request.json());
    if (body.modelSupportMatrix) {
      JSON.parse(body.modelSupportMatrix); // gecerli JSON mu kontrolu
    }
    const { googleTtsApiKey, azureSpeechKey, elevenLabsApiKey, ...plain } = body;
    if (googleTtsApiKey !== undefined) await setTtsSecret("google", googleTtsApiKey);
    if (azureSpeechKey !== undefined) await setTtsSecret("azure", azureSpeechKey);
    if (elevenLabsApiKey !== undefined) await setTtsSecret("elevenlabs", elevenLabsApiKey);

    const settings = await updateSettings(plain);
    return {
      settings: stripSecrets(settings),
      ttsSecrets: describeTtsSecrets(settings),
    };
  });
}

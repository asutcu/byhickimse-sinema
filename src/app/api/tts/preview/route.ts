import { z } from "zod";
import { describeTtsSecrets, getSettings, resolveOpenAiKey, ttsSettingsView } from "@/server/services/settings";
import { previewVoiceSample } from "@/server/services/tts-providers";
import {
  elevenLabsVoice,
  isLegacyVoiceId,
  openaiFallbackVoice,
  readyPaidProviders,
  resolvePreferredTtsVoice,
  ttsPreviewSample,
} from "@/lib/tts-catalog";

export const runtime = "nodejs";

const bodySchema = z.object({
  voiceId: z.string().min(1),
  provider: z.string().optional(),
  language: z.string().optional(),
  speed: z.number().min(0.7).max(1.3).optional(),
  pitchSemitones: z.number().int().min(-6).max(6).optional(),
  text: z.string().max(400).optional(),
});

/** Ayarlar ekranindaki "sesi dinle": secili sesle kisa bir ornek uretir. */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const settings = await getSettings();
    const view = ttsSettingsView(settings);
    const language = body.language || "Turkish";
    const sample = (body.text || ttsPreviewSample(language)).trim();
    const readiness = {
      ...describeTtsSecrets(settings),
      openai: !!(await resolveOpenAiKey()),
    };
    const readyProviders = readyPaidProviders(readiness);
    const provider = (body.provider || readyProviders[0] || view.ttsProvider).trim();

    let voice =
      provider === "elevenlabs" && readiness.elevenlabs && isLegacyVoiceId(body.voiceId)
        ? elevenLabsVoice(view.elevenLabsVoiceId, language)
        : resolvePreferredTtsVoice({
            voiceId: body.voiceId,
            language,
            provider,
            readyProviders,
            elevenLabsReady: readiness.elevenlabs,
            elevenLabsVoiceId: view.elevenLabsVoiceId,
          }).voice;

    if (voice.provider === "elevenlabs") {
      voice = {
        ...voice,
        name: "auto",
      };
    }

    let fallbackNote = "";
    let wav: Buffer;
    try {
      wav = await previewVoiceSample({
        voice,
        text: sample,
        speed: body.speed ?? 1,
        pitchSemitones: body.pitchSemitones ?? 0,
        settings,
        language,
      });
    } catch (err) {
      if (voice.provider === "openai" || !readiness.openai) throw err;
      const fallback = openaiFallbackVoice(language, voice.gender);
      fallbackNote = `${voice.label} calismadi; OpenAI ${fallback.label} ile dinletildi`;
      voice = fallback;
      wav = await previewVoiceSample({
        voice,
        text: sample,
        speed: body.speed ?? 1,
        pitchSemitones: body.pitchSemitones ?? 0,
        settings,
        language,
      });
    }

    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.length),
        "Cache-Control": "no-store",
        "X-Tts-Voice": encodeURIComponent(`${voice.label} · ${voice.name}`),
        ...(fallbackNote ? { "X-Tts-Fallback": encodeURIComponent(fallbackNote) } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ses onizlemesi uretilemedi";
    return Response.json({ error: message }, { status: 400 });
  }
}

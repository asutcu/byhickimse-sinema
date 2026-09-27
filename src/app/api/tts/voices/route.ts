import { handle } from "@/server/lib/api";
import { describeOpenAiKey, describeTtsSecrets, getSettings, ttsSettingsView } from "@/server/services/settings";
import { resolveElevenLabsVoice } from "@/server/services/elevenlabs-voices";
import {
  ELEVENLABS_VOICE_ID,
  elevenLabsVoice,
  languageLabel,
  languageTagFor,
  ttsVoicesForReady,
  TTS_PROVIDER_INFO,
} from "@/lib/tts-catalog";

export const runtime = "nodejs";

/**
 * Secili saglayicinin O DILDEKI sesleri.
 * Dil bilinmiyorsa filtre uygulanmaz; boylece liste hic bos kalmaz.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const language = url.searchParams.get("language") || "";
    const settings = await getSettings();
    const view = ttsSettingsView(settings);
    const secrets = describeTtsSecrets(settings);
    const openaiReady = (await describeOpenAiKey()).present;
    const ready = { ...secrets, openai: openaiReady };
    const requested = url.searchParams.get("provider") || "";
    const genre = url.searchParams.get("genre") || "";

    let elevenVoice = secrets.elevenlabs ? elevenLabsVoice(view.elevenLabsVoiceId || "auto", language) : null;
    if (secrets.elevenlabs) {
      try {
        const picked = await resolveElevenLabsVoice({
          settings,
          hint: { language, genre },
        });
        elevenVoice = {
          ...elevenLabsVoice(picked.voiceId, language),
          label: view.elevenLabsVoiceId
            ? `ElevenLabs · ${picked.name}`
            : `ElevenLabs · ${picked.name} (hikayeye göre)`,
          note: picked.voiceId,
        };
      } catch {
        elevenVoice = elevenLabsVoice("auto", language);
      }
    }

    const voices =
      requested === "elevenlabs"
        ? elevenVoice
          ? [elevenVoice]
          : []
        : requested
          ? ttsVoicesForReady({
              language,
              ready: {
                google: requested === "google" && secrets.google,
                azure: requested === "azure" && secrets.azure,
                elevenlabs: false,
                openai: requested === "openai" && openaiReady,
              },
              includeLocalFree: requested === "piper",
            })
          : [
              ...(elevenVoice ? [elevenVoice] : []),
              ...ttsVoicesForReady({ language, ready, includeLocalFree: false }),
              ...ttsVoicesForReady({
                language,
                ready: { google: false, azure: false, elevenlabs: false, openai: false },
                includeLocalFree: true,
              }),
            ];

    return {
      provider: requested || (openaiReady ? "openai" : view.ttsProvider),
      providers: TTS_PROVIDER_INFO,
      languageTag: languageTagFor(language),
      languageLabel: languageLabel(languageTagFor(language)),
      secrets: { ...secrets, openai: openaiReady },
      elevenLabsVoiceId: view.elevenLabsVoiceId,
      elevenLabsPlaceholderId: ELEVENLABS_VOICE_ID,
      voices,
    };
  });
}

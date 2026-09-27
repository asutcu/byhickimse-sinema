import type { AppSettings } from "@prisma/client";
import {
  normalizeElevenLabsVoice,
  pickElevenLabsVoice,
  preferredNarratorGender,
  voiceSupportsLanguage,
  type ElevenLabsPickHint,
  type ElevenLabsVoiceInfo,
} from "@/lib/elevenlabs-voice-pick";
import { ttsSecret, ttsSettingsView } from "@/server/services/settings";

const listCache = new Map<string, { at: number; voices: ElevenLabsVoiceInfo[] }>();

export async function listElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoiceInfo[]> {
  const cached = listCache.get(apiKey);
  if (cached && Date.now() - cached.at < 120_000) return cached.voices;
  const headers = { "xi-api-key": apiKey, Accept: "application/json" };
  const urls = [
    "https://api.elevenlabs.io/v2/voices?page_size=100",
    "https://api.elevenlabs.io/v1/voices",
  ];
  let lastError = "ElevenLabs ses listesi alinamadi";
  for (const url of urls) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      lastError = `ElevenLabs ses listesi hatasi (${response.status})`;
      continue;
    }
    const payload = (await response.json()) as { voices?: Array<Record<string, unknown>> };
    const voices = (payload.voices || []).map(normalizeElevenLabsVoice).filter((v): v is ElevenLabsVoiceInfo => Boolean(v));
    if (voices.length > 0) {
      listCache.set(apiKey, { at: Date.now(), voices });
      return voices;
    }
  }
  throw new Error(lastError);
}

export async function resolveElevenLabsVoice(input: {
  settings: AppSettings;
  hint?: ElevenLabsPickHint;
  preferVoiceId?: string;
}): Promise<ElevenLabsVoiceInfo> {
  const apiKey = ttsSecret(input.settings, "elevenlabs");
  if (!apiKey) throw new Error("ElevenLabs anahtari yok. Ayarlar > Seslendirme bolumunden girin.");
  const saved = (input.preferVoiceId || ttsSettingsView(input.settings).elevenLabsVoiceId).trim();
  const voices = await listElevenLabsVoices(apiKey);
  if (voices.length === 0) throw new Error("ElevenLabs hesabinda kullanilabilir ses yok.");
  if (saved && saved !== "auto") {
    const match = voices.find((v) => v.voiceId === saved);
    if (match && voiceSupportsLanguage(match, input.hint?.language)) return match;
  }
  const picked =
    pickElevenLabsVoice(voices, {
      language: input.hint?.language,
      genre: input.hint?.genre,
      preferGender: input.hint?.preferGender || preferredNarratorGender(input.hint?.genre),
    }) || voices[0];
  return picked;
}

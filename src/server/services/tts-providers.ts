import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppSettings } from "@prisma/client";
import { getOpenAiClient } from "@/server/services/openai";
import { convertToWav } from "@/server/services/ffmpeg";
import { piperModelUrls, type TtsVoice } from "@/lib/tts-catalog";
import {
  elevenV3Text,
  googleGeminiSpeaker,
  isGoogleGeminiVoice,
  type TtsPerformance,
} from "@/lib/tts-performance";
import { elevenLabsSpeechBodies } from "@/lib/elevenlabs-voice-pick";
import { resolveElevenLabsVoice } from "@/server/services/elevenlabs-voices";
import { ttsSecret, ttsSettingsView } from "@/server/services/settings";

const execFileAsync = promisify(execFile);

export interface SynthesizeChunkInput {
  voice: TtsVoice;
  text: string;
  /** 0.7 - 1.3 */
  speed: number;
  pitchSemitones: number;
  settings: AppSettings;
  /** Gecici dosyalar buraya yazilir. */
  workDir: string;
  fileStem: string;
  /** Sahne duygusu: sinirli/sakin oyunculuk. */
  performance?: TtsPerformance;
  storyGenre?: string;
  language?: string;
}

export interface SynthesizeChunkResult {
  /** Her zaman WAV yol; birlestirme ve sure olcumu bunun uzerinden yapilir. */
  wavPath: string;
  /** Saglayici hizi kendi uyguladi mi? Uygulamadiysa ffmpeg devreye girer. */
  rateApplied: boolean;
  pitchApplied: boolean;
}

function missingKeyError(label: string, where: string): Error {
  return new Error(`${label} anahtari yok. Ayarlar > Seslendirme bolumunden ${where} girin.`);
}

/** SSML/XML icine giden metni kacir. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Azure prosody: hiz yuzde, perde semiton. */
export function buildAzureSsml(input: {
  voiceName: string;
  languageCode: string;
  text: string;
  speed: number;
  pitchSemitones: number;
  style?: string;
  volumePercent?: number;
}): string {
  const ratePercent = Math.round((input.speed - 1) * 100);
  const rate = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`;
  const pitch = `${input.pitchSemitones >= 0 ? "+" : ""}${input.pitchSemitones}st`;
  const volume = input.volumePercent
    ? `${input.volumePercent >= 0 ? "+" : ""}${Math.round(input.volumePercent)}%`
    : "";
  const body = escapeXml(input.text);
  const prosody = volume
    ? `<prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${body}</prosody>`
    : `<prosody rate="${rate}" pitch="${pitch}">${body}</prosody>`;
  const styled = input.style
    ? `<mstts:express-as style="${escapeXml(input.style)}">${prosody}</mstts:express-as>`
    : prosody;
  return [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${input.languageCode}">`,
    `<voice name="${input.voiceName}">`,
    styled,
    "</voice>",
    "</speak>",
  ].join("");
}

async function googleSynthesizeRaw(input: {
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<Buffer> {
  const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Goog-Api-Key": input.apiKey },
    body: JSON.stringify(input.body),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Google TTS hatasi (${response.status}): ${detail}`);
  }
  const payload = (await response.json()) as { audioContent?: string };
  if (!payload.audioContent) throw new Error("Google TTS bos yanit dondurdu");
  return Buffer.from(payload.audioContent, "base64");
}

async function synthesizeGoogle(input: SynthesizeChunkInput, wavPath: string): Promise<SynthesizeChunkResult> {
  const apiKey = ttsSecret(input.settings, "google");
  if (!apiKey) throw missingKeyError("Google Cloud TTS", "Google API anahtarini");

  const speakingRate = Math.min(4, Math.max(0.25, input.speed));
  const audioConfig: Record<string, unknown> = {
    audioEncoding: "LINEAR16",
    sampleRateHertz: 24000,
    speakingRate,
  };
  if (input.voice.supportsPitch && input.pitchSemitones) {
    audioConfig.pitch = Math.min(20, Math.max(-20, input.pitchSemitones));
  }

  if (isGoogleGeminiVoice(input.voice.name)) {
    const speaker = googleGeminiSpeaker(input.voice.name);
    try {
      const buffer = await googleSynthesizeRaw({
        apiKey,
        body: {
          input: {
            text: input.text,
            prompt:
              input.performance?.instruction ||
              "Speak as a first-person narrator. Natural, cinematic, follow the emotion of the lines.",
          },
          voice: {
            languageCode: input.voice.languageCode,
            name: speaker,
            modelName: "gemini-2.5-flash-tts",
          },
          audioConfig,
        },
      });
      fs.writeFileSync(wavPath, buffer);
      return { wavPath, rateApplied: true, pitchApplied: false };
    } catch {
      const fallbackName = `tr-TR-Chirp3-HD-${speaker}`;
      const buffer = await googleSynthesizeRaw({
        apiKey,
        body: {
          input: { text: input.text },
          voice: { languageCode: input.voice.languageCode, name: fallbackName },
          audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, speakingRate },
        },
      });
      fs.writeFileSync(wavPath, buffer);
      return { wavPath, rateApplied: true, pitchApplied: false };
    }
  }

  const buffer = await googleSynthesizeRaw({
    apiKey,
    body: {
      input: { text: input.text },
      voice: { languageCode: input.voice.languageCode, name: input.voice.name },
      audioConfig,
    },
  });
  fs.writeFileSync(wavPath, buffer);
  return {
    wavPath,
    rateApplied: true,
    pitchApplied: Boolean(input.voice.supportsPitch && input.pitchSemitones),
  };
}

async function synthesizeAzure(input: SynthesizeChunkInput, wavPath: string): Promise<SynthesizeChunkResult> {
  const apiKey = ttsSecret(input.settings, "azure");
  if (!apiKey) throw missingKeyError("Azure Speech", "Azure anahtarini ve bolgesini");
  const region = ttsSettingsView(input.settings).azureSpeechRegion;
  const volumePercent = input.performance && input.performance.volume !== 1
    ? Math.round((input.performance.volume - 1) * 100)
    : 0;

  const post = async (style: string) => {
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        "User-Agent": "flow-hikaye-bot",
      },
      body: buildAzureSsml({
        voiceName: input.voice.name,
        languageCode: input.voice.languageCode,
        text: input.text,
        speed: input.speed,
        pitchSemitones: input.pitchSemitones,
        style,
        volumePercent,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`Azure TTS hatasi (${response.status}): ${detail}`);
    }
    return Buffer.from(await response.arrayBuffer());
  };

  const style = input.performance?.azureStyle || "";
  try {
    fs.writeFileSync(wavPath, await post(style));
  } catch (err) {
    if (!style) throw err;
    fs.writeFileSync(wavPath, await post(""));
  }
  return { wavPath, rateApplied: true, pitchApplied: Boolean(input.pitchSemitones) };
}

async function synthesizeElevenLabs(input: SynthesizeChunkInput, wavPath: string): Promise<SynthesizeChunkResult> {
  const apiKey = ttsSecret(input.settings, "elevenlabs");
  if (!apiKey) throw missingKeyError("ElevenLabs", "ElevenLabs anahtarini");
  const prefer = (input.voice.name || "").trim();
  const picked = await resolveElevenLabsVoice({
    settings: input.settings,
    hint: { language: input.language, genre: input.storyGenre },
    preferVoiceId: prefer && prefer !== "auto" ? prefer : undefined,
  });
  const voiceId = picked.voiceId;
  if (!voiceId) throw new Error("ElevenLabs sesi secilemedi. Hesapta en az bir ses olmali.");

  const bodies = elevenLabsSpeechBodies({
    text: input.text,
    language: input.language,
    stability: input.performance?.elevenStability ?? 0.45,
    style: input.performance?.elevenStyle ?? 0.15,
    // Duygu etiketleri sanitize SONRASI burada eklenir — metinden silinmez.
    v3Tags: input.performance?.elevenV3Tags,
    // Etiketler cumle cumle dagitilir: parcanin sert cumlesi sert okunur.
    v3Text: input.performance ? elevenV3Text(input.text, input.performance.mood) : undefined,
  });
  let lastError = "ElevenLabs hatasi";
  let audio: ArrayBuffer | null = null;
  for (const body of bodies) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (response.ok) {
      audio = await response.arrayBuffer();
      break;
    }
    lastError = `ElevenLabs hatasi (${response.status}): ${(await response.text().catch(() => "")).slice(0, 300)}`;
  }
  if (!audio) throw new Error(lastError);

  const mp3Path = path.join(input.workDir, `${input.fileStem}.mp3`);
  fs.writeFileSync(mp3Path, Buffer.from(audio));
  await convertToWav(mp3Path, wavPath);
  fs.rmSync(mp3Path, { force: true });
  return { wavPath, rateApplied: false, pitchApplied: false };
}

/** Piper model dosyalari yerelde yoksa Hugging Face'ten indirilir. */
async function ensurePiperModel(modelName: string, modelDir: string): Promise<string> {
  fs.mkdirSync(modelDir, { recursive: true });
  const onnxPath = path.join(modelDir, `${modelName}.onnx`);
  const configPath = path.join(modelDir, `${modelName}.onnx.json`);
  if (fs.existsSync(onnxPath) && fs.existsSync(configPath)) return onnxPath;

  const urls = piperModelUrls(modelName);
  if (!urls) throw new Error(`Piper modeli taninmiyor: ${modelName}`);

  for (const [url, target] of [
    [urls.onnx, onnxPath],
    [urls.config, configPath],
  ] as const) {
    if (fs.existsSync(target)) continue;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Piper model indirilemedi (${response.status}): ${path.basename(target)}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    // HTML sayfasi indiyse ONNX yukleme hatasi yerine anlasilir hata verilir.
    if (buffer.length < 1_000 || buffer.subarray(0, 14).toString("ascii").includes("<!DOCTYPE")) {
      throw new Error(`Piper model dosyasi bozuk indi: ${path.basename(target)}`);
    }
    fs.writeFileSync(target, buffer);
  }
  return onnxPath;
}

async function synthesizePiper(input: SynthesizeChunkInput, wavPath: string): Promise<SynthesizeChunkResult> {
  const view = ttsSettingsView(input.settings);
  const python = view.piperPython;
  const modelDir = view.piperModelDir || path.join(process.cwd(), "config", "piper-voices");
  const modelPath = await ensurePiperModel(input.voice.name, modelDir);

  try {
    await execFileAsync(python, ["-m", "piper", "-m", modelPath, "-f", wavPath, "--", input.text], {
      timeout: 300_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 32,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found|tanimlanamadi|is not recognized/i.test(message)) {
      throw new Error(
        `Piper bulunamadi ("${python}"). Kurulum: pip install piper-tts. Python yolu Ayarlar > Seslendirme bolumunden degistirilebilir.`
      );
    }
    throw new Error(`Piper seslendirme hatasi: ${message.slice(0, 240)}`);
  }
  if (!fs.existsSync(wavPath)) throw new Error("Piper ses dosyasi olusturmadi");
  return { wavPath, rateApplied: false, pitchApplied: false };
}

async function synthesizeOpenAi(input: SynthesizeChunkInput, wavPath: string): Promise<SynthesizeChunkResult> {
  const client = await getOpenAiClient();
  const speed = Math.min(1.3, Math.max(0.7, input.speed));
  const request = {
    voice: input.voice.name as "nova",
    input: input.text,
    speed,
    response_format: "wav" as const,
    ...(input.performance?.instruction ? { instructions: input.performance.instruction } : {}),
  };
  try {
    const result = await client.audio.speech.create({ model: "gpt-4o-mini-tts", ...request });
    fs.writeFileSync(wavPath, Buffer.from(await result.arrayBuffer()));
  } catch {
    const { instructions: _drop, ...legacy } = request;
    const result = await client.audio.speech.create({ model: "tts-1-hd", ...legacy });
    fs.writeFileSync(wavPath, Buffer.from(await result.arrayBuffer()));
  }
  return { wavPath, rateApplied: true, pitchApplied: false };
}

/** Secili saglayiciyla tek parcayi seslendirir; her zaman WAV dondurur. */
export async function synthesizeChunkWithProvider(input: SynthesizeChunkInput): Promise<SynthesizeChunkResult> {
  fs.mkdirSync(input.workDir, { recursive: true });
  const wavPath = path.join(input.workDir, `${input.fileStem}.wav`);
  switch (input.voice.provider) {
    case "google":
      return synthesizeGoogle(input, wavPath);
    case "azure":
      return synthesizeAzure(input, wavPath);
    case "elevenlabs":
      return synthesizeElevenLabs(input, wavPath);
    case "piper":
      return synthesizePiper(input, wavPath);
    default:
      return synthesizeOpenAi(input, wavPath);
  }
}

/** Ayarlar ekranindaki "sesi dinle" onizlemesi; gecici klasore yazar. */
export async function previewVoiceSample(input: {
  voice: TtsVoice;
  text: string;
  speed: number;
  pitchSemitones: number;
  settings: AppSettings;
  language?: string;
  storyGenre?: string;
}): Promise<Buffer> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-preview-"));
  try {
    const result = await synthesizeChunkWithProvider({
      ...input,
      workDir,
      fileStem: "preview",
    });
    return fs.readFileSync(result.wavPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

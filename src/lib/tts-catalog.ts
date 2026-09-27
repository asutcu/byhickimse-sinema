/**
 * Seslendirme (TTS) katalogu: saglayicilar + DILE GORE sesler.
 *
 * Onceki durum: ses daima OpenAI "nova" / "onyx" ile uretiliyordu. Bunlar
 * Ingilizce ana dilli seslerdir; Turkce metni yabanci aksanla okurlar ve
 * anlatim konu diliyle uyumsuz duyulur. Artik her ses bir DILE baglidir ve
 * projenin konusma diline gore filtrelenir.
 *
 * Fiyat notu (2026): Google WaveNet 4M karakter/ay ucretsiz, sonra $4/1M;
 * Google Chirp3-HD 1M/ay ucretsiz, sonra $30/1M; Azure Neural 500K/ay
 * suresiz ucretsiz, sonra $16/1M; ElevenLabs $100/1M; Piper tamamen yerel
 * ve ucretsiz.
 */

export const TTS_PROVIDERS = ["google", "azure", "piper", "elevenlabs", "openai"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

export type TtsGender = "female" | "male" | "neutral";

export interface TtsVoice {
  /** Ayarlarda saklanan kalici kimlik: "google:tr-TR-Chirp3-HD-Kore". */
  id: string;
  provider: TtsProvider;
  /** Saglayiciya gonderilen ses adi / model dosyasi. */
  name: string;
  label: string;
  /** BCP-47 tam kod: "tr-TR". Piper icin "tr_TR" model adindan bagimsiz tutulur. */
  languageCode: string;
  /** Kisa dil etiketi: "tr", "en"... Filtreleme bununla yapilir. */
  languageTag: string;
  gender: TtsGender;
  /** Kaba maliyet sinifi — arayuzde rozet olarak gosterilir. */
  tier: "ucretsiz" | "ekonomik" | "premium";
  /** Saglayici hiz/perdeyi kendi motorunda uygulayabiliyor mu? */
  supportsRate: boolean;
  supportsPitch: boolean;
  note?: string;
}

export interface TtsProviderInfo {
  id: TtsProvider;
  label: string;
  hint: string;
  /** Anahtar gerekiyorsa Ayarlar'da hangi alan doldurulmali. */
  requires: "google-key" | "azure-key" | "openai-key" | "eleven-key" | "piper-local";
}

export const TTS_PROVIDER_INFO: TtsProviderInfo[] = [
  {
    id: "google",
    label: "Google Cloud TTS",
    hint: "Yerli Turkce sesler. WaveNet ayda 4M karakter, Chirp3-HD 1M karakter ucretsiz.",
    requires: "google-key",
  },
  {
    id: "azure",
    label: "Azure Speech",
    hint: "Emel / Ahmet yerli Turkce sesleri. Ayda 500.000 karakter suresiz ucretsiz.",
    requires: "azure-key",
  },
  {
    id: "piper",
    label: "Piper (yerel)",
    hint: "Tamamen ucretsiz ve cevrimdisi calisir; anahtar gerekmez. Kalite bulut seslerin bir tik altinda.",
    requires: "piper-local",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    hint: "En duygusal anlatim. Karakter basina en pahali secenek ($100/1M).",
    requires: "eleven-key",
  },
  {
    id: "openai",
    label: "OpenAI TTS",
    hint: "Ucretli yedek. Google/Azure/Piper yoksa veya bozulursa burasi calisir. Turkce metni aksanli okuyabilir.",
    requires: "openai-key",
  },
];

export function ttsProviderInfo(provider: string): TtsProviderInfo {
  return TTS_PROVIDER_INFO.find((p) => p.id === provider) ?? TTS_PROVIDER_INFO[0];
}

/* ------------------------------------------------------------------ */
/* Dil normalizasyonu                                                  */
/* ------------------------------------------------------------------ */

/**
 * Uygulamada dil bazen "Turkish", bazen "Türkçe" olarak tutuluyor
 * (Project.speechLanguage varsayilani "Türkçe", form ise "Turkish" yaziyor).
 * Aksan/nokta farklari temizlenip tek bir kisa etikete indirilir.
 */
function foldLanguage(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z-]/g, "")
    .toLowerCase()
    .trim();
}

const LANGUAGE_TAGS: Record<string, string> = {
  turkish: "tr",
  turkce: "tr",
  tr: "tr",
  trtr: "tr",
  "tr-tr": "tr",
  english: "en",
  ingilizce: "en",
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  german: "de",
  almanca: "de",
  deutsch: "de",
  de: "de",
  "de-de": "de",
  french: "fr",
  fransizca: "fr",
  francais: "fr",
  français: "fr",
  fr: "fr",
  "fr-fr": "fr",
  spanish: "es",
  ispanyolca: "es",
  espanol: "es",
  es: "es",
  "es-es": "es",
};

/** Bilinmeyen dilde "" doner; o zaman ses filtresi uygulanmaz. */
export function languageTagFor(value: string | null | undefined): string {
  const folded = foldLanguage(value || "");
  if (!folded) return "";
  return LANGUAGE_TAGS[folded] || LANGUAGE_TAGS[folded.slice(0, 2)] || "";
}

const LANGUAGE_LOCALES: Record<string, string> = {
  tr: "tr-TR",
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
};

export function localeForLanguage(value: string | null | undefined): string {
  const tag = languageTagFor(value);
  return LANGUAGE_LOCALES[tag] || "tr-TR";
}

export function languageLabel(tag: string): string {
  const labels: Record<string, string> = {
    tr: "Turkce",
    en: "Ingilizce",
    de: "Almanca",
    fr: "Fransizca",
    es: "Ispanyolca",
  };
  return labels[tag] || tag;
}

/** Proje / form konusma dili listesi — hikaye ve ElevenLabs bu degerle gider. */
export const SPEECH_LANGUAGES: Array<{ label: string; value: string }> = [
  { label: "Türkçe", value: "Turkish" },
  { label: "İngilizce", value: "English" },
  { label: "Almanca", value: "German" },
  { label: "Fransızca", value: "French" },
  { label: "İspanyolca", value: "Spanish" },
];

export function canonicalizeSpeechLanguage(value: string | null | undefined): string {
  const tag = languageTagFor(value);
  return SPEECH_LANGUAGES.find((item) => languageTagFor(item.value) === tag)?.value || "Turkish";
}

/** ElevenLabs / Gemini yonergesi icin Ingilizce dil adi. */
export function spokenLanguageName(language: string | null | undefined): string {
  const names: Record<string, string> = {
    tr: "Turkish",
    en: "English",
    de: "German",
    fr: "French",
    es: "Spanish",
  };
  return names[languageTagFor(language) || "tr"] || "Turkish";
}

/** ElevenLabs language_code (ISO 639-1). */
export function elevenLabsLanguageCode(language: string | null | undefined): string {
  return languageTagFor(language) || "tr";
}

const PREVIEW_SAMPLES: Record<string, string> = {
  tr: "Mutfaktaki ışık hâlâ yanıyordu. Telefonun ekranı bir kez daha titredi ve gelen ismi görünce elim durdu.",
  en: "The kitchen light was still on. The phone flashed again, and when I saw the name my hand stopped.",
  de: "Das Licht in der Küche brannte noch. Das Telefon blinkte erneut, und als ich den Namen sah, blieb meine Hand stehen.",
  fr: "La lumière de la cuisine était encore allumée. Le téléphone a encore vibré, et en voyant le nom ma main s'est arrêtée.",
  es: "La luz de la cocina seguía encendida. El teléfono volvió a vibrar, y al ver el nombre se me detuvo la mano.",
};

/** Onizleme cumlesi — secilen dilde okunur, Turkce metin Ingilizce seste kalmaz. */
export function ttsPreviewSample(language: string | null | undefined): string {
  return PREVIEW_SAMPLES[languageTagFor(language) || "tr"] || PREVIEW_SAMPLES.tr;
}

/* ------------------------------------------------------------------ */
/* Ses listeleri                                                       */
/* ------------------------------------------------------------------ */

function voice(input: Omit<TtsVoice, "id" | "languageTag"> & { languageTag?: string }): TtsVoice {
  const languageTag = input.languageTag || languageTagFor(input.languageCode) || "tr";
  return { ...input, languageTag, id: `${input.provider}:${input.name}` };
}

/**
 * Chirp3-HD konusmaci adlari TUM dillerde ayni (Google dokumantasyonu);
 * bu yuzden dil koduna gore uretilebilir.
 */
const CHIRP3_FEMALE = ["Kore", "Achernar", "Aoede", "Leda", "Zephyr", "Despina"] as const;
const CHIRP3_MALE = ["Charon", "Puck", "Fenrir", "Orus", "Alnilam", "Iapetus"] as const;

function googleChirp3Voices(languageCode: string): TtsVoice[] {
  const female = CHIRP3_FEMALE.map((speaker) =>
    voice({
      provider: "google",
      name: `${languageCode}-Chirp3-HD-${speaker}`,
      label: `${speaker} — kadin, Chirp3 HD`,
      languageCode,
      gender: "female",
      tier: "premium",
      supportsRate: true,
      // Chirp3-HD perde parametresini kabul etmez; perde ffmpeg ile uygulanir.
      supportsPitch: false,
      note: "En dogal Google sesi (1M karakter/ay ucretsiz, sonra $30/1M)",
    })
  );
  const male = CHIRP3_MALE.map((speaker) =>
    voice({
      provider: "google",
      name: `${languageCode}-Chirp3-HD-${speaker}`,
      label: `${speaker} — erkek, Chirp3 HD`,
      languageCode,
      gender: "male",
      tier: "premium",
      supportsRate: true,
      supportsPitch: false,
      note: "En dogal Google sesi (1M karakter/ay ucretsiz, sonra $30/1M)",
    })
  );
  return [...female, ...male];
}

/** tr-TR WaveNet/Standard cinsiyetleri Google dokumantasyonundan alindi. */
const GOOGLE_TR_CLASSIC: Array<{ name: string; gender: TtsGender; tier: TtsVoice["tier"]; label: string }> = [
  { name: "tr-TR-Wavenet-A", gender: "female", tier: "ekonomik", label: "Wavenet A — kadin" },
  { name: "tr-TR-Wavenet-C", gender: "female", tier: "ekonomik", label: "Wavenet C — kadin" },
  { name: "tr-TR-Wavenet-D", gender: "female", tier: "ekonomik", label: "Wavenet D — kadin" },
  { name: "tr-TR-Wavenet-B", gender: "male", tier: "ekonomik", label: "Wavenet B — erkek" },
  { name: "tr-TR-Wavenet-E", gender: "male", tier: "ekonomik", label: "Wavenet E — erkek" },
  { name: "tr-TR-Standard-A", gender: "female", tier: "ekonomik", label: "Standard A — kadin" },
  { name: "tr-TR-Standard-B", gender: "male", tier: "ekonomik", label: "Standard B — erkek" },
];

/** Gemini-TTS: ayni Google anahtari, duygu promptu ile oynar. Tum konusma dillerinde. */
const GOOGLE_GEMINI_SPEAKERS: Array<{ speaker: string; gender: TtsGender; label: string }> = [
  { speaker: "Kore", gender: "female", label: "Kore — kadin, Gemini duygulu" },
  { speaker: "Aoede", gender: "female", label: "Aoede — kadin, Gemini duygulu" },
  { speaker: "Charon", gender: "male", label: "Charon — erkek, Gemini duygulu" },
  { speaker: "Fenrir", gender: "male", label: "Fenrir — erkek, Gemini duygulu" },
];

const AZURE_VOICES: Array<{ name: string; languageCode: string; gender: TtsGender; label: string }> = [
  { name: "tr-TR-EmelNeural", languageCode: "tr-TR", gender: "female", label: "Emel — kadin, yerli Turkce" },
  { name: "tr-TR-AhmetNeural", languageCode: "tr-TR", gender: "male", label: "Ahmet — erkek, yerli Turkce" },
  { name: "en-US-JennyNeural", languageCode: "en-US", gender: "female", label: "Jenny — kadin" },
  { name: "en-US-GuyNeural", languageCode: "en-US", gender: "male", label: "Guy — erkek" },
  { name: "de-DE-KatjaNeural", languageCode: "de-DE", gender: "female", label: "Katja — kadin" },
  { name: "de-DE-ConradNeural", languageCode: "de-DE", gender: "male", label: "Conrad — erkek" },
  { name: "fr-FR-DeniseNeural", languageCode: "fr-FR", gender: "female", label: "Denise — kadin" },
  { name: "fr-FR-HenriNeural", languageCode: "fr-FR", gender: "male", label: "Henri — erkek" },
  { name: "es-ES-ElviraNeural", languageCode: "es-ES", gender: "female", label: "Elvira — kadin" },
  { name: "es-ES-AlvaroNeural", languageCode: "es-ES", gender: "male", label: "Alvaro — erkek" },
];

/** Piper model adlari; dosyalar Hugging Face uzerinden inip yerel klasorde durur. */
const PIPER_VOICES: Array<{ name: string; gender: TtsGender; label: string; note: string }> = [
  {
    name: "tr_TR-dfki-medium",
    gender: "neutral",
    label: "Dfki — Turkce, notr ton",
    note: "Ucretsiz, cevrimdisi",
  },
  {
    name: "tr_TR-fettah-medium",
    gender: "male",
    label: "Fettah — erkek",
    note: "Ucretsiz, cevrimdisi",
  },
  {
    name: "tr_TR-fahrettin-medium",
    gender: "male",
    label: "Fahrettin — erkek",
    note: "Ucretsiz, cevrimdisi",
  },
];

const OPENAI_VOICES: Array<{ name: string; gender: TtsGender; label: string }> = [
  { name: "nova", gender: "female", label: "Nova — kadin" },
  { name: "shimmer", gender: "female", label: "Shimmer — kadin" },
  { name: "onyx", gender: "male", label: "Onyx — erkek" },
  { name: "echo", gender: "male", label: "Echo — erkek" },
];

/** ElevenLabs sesi kullanicinin hesabindan gelir; kimlik Ayarlar'da tutulur. */
export const ELEVENLABS_VOICE_ID = "elevenlabs:hesaptaki-ses";

function buildCatalog(): TtsVoice[] {
  const list: TtsVoice[] = [];

  for (const languageCode of Object.values(LANGUAGE_LOCALES)) {
    list.push(...googleChirp3Voices(languageCode));
  }
  for (const item of GOOGLE_TR_CLASSIC) {
    list.push(
      voice({
        provider: "google",
        name: item.name,
        label: item.label,
        languageCode: "tr-TR",
        gender: item.gender,
        tier: item.tier,
        supportsRate: true,
        supportsPitch: true,
        note: "4M karakter/ay ucretsiz, sonra $4/1M",
      })
    );
  }
  for (const languageCode of Object.values(LANGUAGE_LOCALES)) {
    for (const item of GOOGLE_GEMINI_SPEAKERS) {
      const tag = languageTagFor(languageCode) || "tr";
      list.push(
        voice({
          provider: "google",
          name: `gemini:${item.speaker}`,
          label: tag === "tr" ? item.label : `${item.label} (${languageLabel(tag)})`,
          languageCode,
          languageTag: tag,
          gender: item.gender,
          tier: "premium",
          supportsRate: true,
          supportsPitch: false,
          note: "Sahne duygusuna gore anlatir (sinirli/sakin). Google anahtari gerekir.",
        })
      );
    }
  }
  for (const item of AZURE_VOICES) {
    list.push(
      voice({
        provider: "azure",
        name: item.name,
        label: item.label,
        languageCode: item.languageCode,
        gender: item.gender,
        tier: "ekonomik",
        supportsRate: true,
        supportsPitch: true,
        note: "500.000 karakter/ay suresiz ucretsiz, sonra $16/1M",
      })
    );
  }
  for (const item of PIPER_VOICES) {
    list.push(
      voice({
        provider: "piper",
        name: item.name,
        label: item.label,
        languageCode: "tr-TR",
        gender: item.gender,
        tier: "ucretsiz",
        supportsRate: false,
        supportsPitch: false,
        note: item.note,
      })
    );
  }
  for (const item of OPENAI_VOICES) {
    // Dil bagimsiz: her dilde okur ama aksani Ingilizcedir.
    for (const tag of Object.keys(LANGUAGE_LOCALES)) {
      list.push(
        voice({
          provider: "openai",
          name: item.name,
          label: `${item.label} (${languageLabel(tag)} — yabanci aksan)`,
          languageCode: LANGUAGE_LOCALES[tag],
          languageTag: tag,
          gender: item.gender,
          tier: "ekonomik",
          supportsRate: true,
          supportsPitch: false,
          note: "Ingilizce ana dilli ses; Turkce metni aksanli okur",
        })
      );
    }
  }
  return list;
}

/** OpenAI sesleri her dil icin tekrarlandigi icin kimlikler dile gore ayrilir. Gemini ayni. */
const CATALOG: TtsVoice[] = buildCatalog().map((v) => {
  if (v.provider === "openai") return { ...v, id: `openai:${v.name}:${v.languageTag}` };
  if (v.provider === "google" && v.name.startsWith("gemini:")) {
    return {
      ...v,
      id: v.languageTag === "tr" ? `google:${v.name}` : `google:${v.name}:${v.languageTag}`,
    };
  }
  return v;
});

export function allTtsVoices(): TtsVoice[] {
  return CATALOG;
}

/** Kullanicinin hesabina tanimli ElevenLabs sesi (kimlik Ayarlar'dan gelir). */
export function elevenLabsVoice(voiceId: string, language: string): TtsVoice {
  const languageCode = localeForLanguage(language);
  return {
    id: ELEVENLABS_VOICE_ID,
    provider: "elevenlabs",
    name: voiceId,
    label: voiceId && voiceId !== "auto" ? "ElevenLabs — profesyonel ses" : "ElevenLabs — hikayeye göre",
    languageCode,
    languageTag: languageTagFor(languageCode) || "tr",
    gender: "neutral",
    tier: "premium",
    supportsRate: false,
    supportsPitch: false,
    note: "Multilingual · dil kodu ile TR/EN/DE/FR/ES",
  };
}

export function ttsVoiceById(id: string): TtsVoice | null {
  return CATALOG.find((v) => v.id === id) ?? null;
}

/** Dile ve (istege bagli) saglayiciya gore sesler. */
export function ttsVoicesFor(options: { language?: string; provider?: string } = {}): TtsVoice[] {
  const tag = languageTagFor(options.language);
  return CATALOG.filter((v) => {
    if (options.provider && v.provider !== options.provider) return false;
    if (tag && v.languageTag !== tag) return false;
    return true;
  });
}

export interface TtsProviderReadiness {
  google: boolean;
  azure: boolean;
  elevenlabs: boolean;
  openai: boolean;
}

const PAID_PROVIDER_ORDER: Array<keyof TtsProviderReadiness> = ["elevenlabs", "google", "azure", "openai"];

/** Anahtari hazir olan ucretli saglayicilar; Piper (yerel/ucretsiz) dahil edilmez. */
export function readyPaidProviders(ready: TtsProviderReadiness): TtsProvider[] {
  return PAID_PROVIDER_ORDER.filter((provider) => ready[provider]);
}

/**
 * Calisan saglayicilarin sesleri. Ucretli (anahtari olan) once,
 * Piper en sonda — boylece bozuk yerel model varsayilan olmaz.
 */
export function ttsVoicesForReady(options: {
  language?: string;
  ready: TtsProviderReadiness;
  includeLocalFree?: boolean;
}): TtsVoice[] {
  const providers: TtsProvider[] = [...readyPaidProviders(options.ready)];
  if (options.includeLocalFree !== false) providers.push("piper");
  return providers.flatMap((provider) => ttsVoicesFor({ language: options.language, provider }));
}

/** Ayni cinsiyette OpenAI yedegi (ucretsiz motor dusunce). */
export function openaiFallbackVoice(language: string, gender: TtsGender): TtsVoice {
  return resolveTtsVoice({
    voiceId: gender === "male" ? "male" : "female",
    language,
    provider: "openai",
  }).voice;
}

/** Eski kayitlar: voiceId "female" / "male" olarak tutuluyordu. */
export function isLegacyVoiceId(id: string): boolean {
  return id === "female" || id === "male";
}

export function isElevenLabsVoiceId(id: string): boolean {
  return id === ELEVENLABS_VOICE_ID || id.startsWith("elevenlabs:");
}

/**
 * ElevenLabs anahtari + ses kimligi varsa sahne konusmasi oradan okunur.
 * Eski female/male kayitlari da ElevenLabs'e tasinir.
 */
export function resolvePreferredTtsVoice(input: {
  voiceId: string;
  language: string;
  provider: string;
  readyProviders?: TtsProvider[];
  elevenLabsReady?: boolean;
  elevenLabsVoiceId?: string;
  preferElevenLabs?: boolean;
}): { voice: TtsVoice; switched: boolean; reason: string } {
  const elId = (input.elevenLabsVoiceId || "").trim() || "auto";
  const elReady = Boolean(input.elevenLabsReady);
  if (elReady) {
    const elVoice = elevenLabsVoice(elId, input.language);
    if (input.preferElevenLabs || isElevenLabsVoiceId(input.voiceId)) {
      return {
        voice: elVoice,
        switched: !isElevenLabsVoiceId(input.voiceId),
        reason: isElevenLabsVoiceId(input.voiceId) ? "" : "Sahne konusmalari ElevenLabs ile okunuyor",
      };
    }
    if (isLegacyVoiceId(input.voiceId) && (input.readyProviders || []).includes("elevenlabs")) {
      return {
        voice: elVoice,
        switched: true,
        reason: "ElevenLabs ayarli; sahne sesi oraya tasindi",
      };
    }
  }
  return resolveTtsVoice({
    voiceId: input.voiceId,
    language: input.language,
    provider: input.provider,
    readyProviders: input.readyProviders,
  });
}

/**
 * Ses cozumleme sirasi:
 * 1) Kayitli kimlik dile uyuyorsa AYNEN kullanilir (Ayarlar'daki saglayici ezmez).
 * 2) Uymuyorsa ayni cinsiyette, dogru dilde ses secilir — once anahtari hazir
 *    ucretli saglayicilar, sonra Ayarlar'daki saglayici.
 * 3) Hicbiri yoksa dilin herhangi bir sesine dusulur.
 */
export function resolveTtsVoice(input: {
  voiceId: string;
  language: string;
  provider: string;
  preferredGender?: TtsGender;
  readyProviders?: TtsProvider[];
}): { voice: TtsVoice; switched: boolean; reason: string } {
  const tag = languageTagFor(input.language) || "tr";
  const saved = ttsVoiceById(input.voiceId);
  const legacy = isLegacyVoiceId(input.voiceId);
  const gender: TtsGender =
    input.preferredGender ?? (legacy ? (input.voiceId as TtsGender) : saved?.gender ?? "female");

  if (saved && saved.languageTag === tag) {
    return { voice: saved, switched: false, reason: "" };
  }

  const tryProviders = uniqueProviders([...(input.readyProviders ?? []), input.provider]);
  for (const provider of tryProviders) {
    const inProviderAndLanguage = CATALOG.filter((v) => v.provider === provider && v.languageTag === tag);
    const byGender = inProviderAndLanguage.filter((v) => v.gender === gender || v.gender === "neutral");
    const pick = byGender[0] ?? inProviderAndLanguage[0];
    if (!pick) continue;
    const reason = saved
      ? saved.languageTag !== tag
        ? `Secili ses ${languageLabel(saved.languageTag)} icindi; ${languageLabel(tag)} sesine gecildi: ${pick.label}`
        : `Ses ${ttsProviderInfo(provider).label} saglayicisina tasindi: ${pick.label}`
      : `${languageLabel(tag)} icin ses secildi: ${pick.label}`;
    return { voice: pick, switched: true, reason };
  }

  const anyForLanguage = CATALOG.filter((v) => v.languageTag === tag);
  const fallback =
    anyForLanguage.find((v) => v.gender === gender && v.provider === "openai") ??
    anyForLanguage.find((v) => v.provider === "openai") ??
    anyForLanguage.find((v) => v.gender === gender) ??
    anyForLanguage[0] ??
    CATALOG[0];
  return {
    voice: fallback,
    switched: true,
    reason: `${ttsProviderInfo(input.provider).label} bu dilde ses sunmuyor; ${fallback.label} kullanildi`,
  };
}

function uniqueProviders(list: string[]): TtsProvider[] {
  const seen = new Set<string>();
  const out: TtsProvider[] = [];
  for (const item of list) {
    const id = item.trim() as TtsProvider;
    if (!TTS_PROVIDERS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Piper model dosyasinin Hugging Face adresi (ilk kullanimda indirilir). */
export function piperModelUrls(modelName: string): { onnx: string; config: string } | null {
  const mirrors: Record<string, string> = {
    "tr_TR-dfki-medium": "https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium",
    "tr_TR-fettah-medium": "https://huggingface.co/speaches-ai/piper-tr_TR-fettah-medium/resolve/main",
    "tr_TR-fahrettin-medium": "https://huggingface.co/speaches-ai/piper-tr_TR-fahrettin-medium/resolve/main",
  };
  const base = mirrors[modelName];
  if (!base) return null;
  return {
    onnx: `${base}/${modelName}.onnx?download=true`,
    config: `${base}/${modelName}.onnx.json?download=true`,
  };
}

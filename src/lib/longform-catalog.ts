import {
  DEFAULT_SUBTITLE_STYLE,
  parseSubtitleStyle,
  type BurnSubtitleStyle,
} from "@/lib/subtitle-style";
import {
  parseLongformEncoder,
  parseLongformFps,
  parseLongformResolution,
  type LongformEncoder,
  type LongformFps,
  type LongformResolution,
} from "@/lib/longform-render";
import { FLOW_IMAGE_MODELS, resolveFlowImageModel } from "@/lib/flow-generation-settings";

export type { BurnSubtitleStyle };

export const LONGFORM_STILL_INTERVALS = [10, 15, 20] as const;
export type LongformStillInterval = (typeof LONGFORM_STILL_INTERVALS)[number];

/** Anlatici bicimleri: gorsel slayt, sinema film veya 3D cizgi film. */
export const NARRATOR_FORMATS = ["stills", "video", "cartoon"] as const;
export type NarratorFormat = (typeof NARRATOR_FORMATS)[number];

export const LONGFORM_STILL_MOTIONS = ["hold", "kenburns"] as const;
export type LongformStillMotion = (typeof LONGFORM_STILL_MOTIONS)[number];

export const LONGFORM_DURATION_PRESETS = [
  { label: "5 dakika", value: 300 },
  { label: "10 dakika", value: 600 },
  { label: "15 dakika", value: 900 },
  { label: "20 dakika", value: 1200 },
  { label: "30 dakika", value: 1800 },
  { label: "40 dakika", value: 2400 },
  { label: "60 dakika", value: 3600 },
  { label: "Ozel sure", value: -1 },
] as const;

export const LONGFORM_GENRE_IDS = [
  "aldatma",
  "yasak-ask",
  "ihanet",
  "kiskanclik",
  "intikam",
  "bosanma",
  "aile-sirri",
  "kayinvalide",
  "hesap-sorma",
  "guclu-donus",
  "yeniden-dogus",
  "kadin-gelisimi",
  "gizli-kimlik",
  "sozlesmeli-evlilik",
  "yildirim-nikahi",
  "zengin-aile",
  "pismanlik",
  "trajik-ask",
  "aile-bagi",
  "ahlaki-ikilem",
  "romantik",
  "dram",
  "gerilim",
  "korku",
  "ozel",
  "mystery",
  "history",
  "investigation",
  "sleep",
  "meditation",
  "documentary",
] as const;

export type LongformGenreId = (typeof LONGFORM_GENRE_IDS)[number];

export const LONGFORM_DRAMA_GENRE_IDS = [
  "aldatma",
  "yasak-ask",
  "ihanet",
  "kiskanclik",
  "intikam",
  "bosanma",
  "aile-sirri",
  "kayinvalide",
  "hesap-sorma",
  "guclu-donus",
  "yeniden-dogus",
  "kadin-gelisimi",
  "gizli-kimlik",
  "sozlesmeli-evlilik",
  "yildirim-nikahi",
  "zengin-aile",
  "pismanlik",
  "trajik-ask",
  "aile-bagi",
  "ahlaki-ikilem",
  "romantik",
  "dram",
  "gerilim",
  "korku",
  "ozel",
] as const;

export function isLongformDramaGenre(id: string): boolean {
  return (LONGFORM_DRAMA_GENRE_IDS as readonly string[]).includes(id);
}

export type LongformVoiceId = "female" | "male";

export interface LongformGenre {
  id: LongformGenreId;
  label: string;
  tagline: string;
  narrationTone: string;
  visualLock: string;
  musicMood: string;
  defaultPace: "slow" | "normal" | "fast";
  defaultSpeed: number;
  pov: "first" | "third";
  topicSuggestions: string[];
}

export interface LongformVoice {
  id: LongformVoiceId;
  label: string;
  openaiVoice: string;
  description: string;
}

const DRAMA_STILL_LOCK =
  "cinematic NetShort short-drama still, luxury car / glass office / boutique exit / wedding flashback vs cold present / penthouse emptiness, kitchen table phone keys, wet street at night, hotel corridor from a distance, humiliation and status-crush readable on faces, shallow depth of field, no text, no letters, no watermark, no logo, no caption, no nudity, no sexual act, no minors";

export const LONGFORM_GENRES: LongformGenre[] = [
  {
    id: "aldatma",
    label: "Aldatma",
    tagline: "Es, sevgili, gizli mesaj, yakalanma",
    narrationTone: "Birinci tekil; NetShort: sakin yikici karar, donus, pismanlik. Bagirma yagmuru yok. Yatak yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "yasak-ask",
    label: "Yasak ask",
    tagline: "Tabu bag, aile ici skandal, sok",
    narrationTone: "Birinci tekil; tabu (18+), sakin yikici secim, aile skandali, donus. Siir dili yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "dark-ambient",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "ihanet",
    label: "Ihanet",
    tagline: "Guvenilen biri arkadan vurur",
    narrationTone: "Birinci tekil; imza/para ihaneti, sakin hesap sorma, status cevirisi.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "dark-ambient",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "kiskanclik",
    label: "Kiskanclik",
    tagline: "Suphe, takip, patlama, asagilama",
    narrationTone: "Birinci tekil; suphe, sakin netlik, status donusu. Bagirma yagmuru yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "pulse-low",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "intikam",
    label: "Intikam",
    tagline: "Sert hesap, ifsa, ezme",
    narrationTone: "Birinci tekil; asagilanma, sessiz guclenme, ifsa, pismanlik. Iskence yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "dark-ambient",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "bosanma",
    label: "Bosanma",
    tagline: "Ayrilik, imza, ustun donus",
    narrationTone: "Birinci tekil; sakin imza, zaman atlamasi, eski esin pismanligi. Sahnede cocuk yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 0.98,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "aile-sirri",
    label: "Aile sirri",
    tagline: "Gizli evlilik, tabu, acilan kutu",
    narrationTone: "Birinci tekil; sir acilir, sakin mesafe, sonra guclu donus.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "dark-ambient",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "kayinvalide",
    label: "Kayinvalide / aile baskisi",
    tagline: "Mudahale, ezme, guclu donus",
    narrationTone: "Birinci tekil; aile ezmesi, sakin ayrilis, status donusu.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "hesap-sorma",
    label: "Hesap sorma",
    tagline: "Iyilik gasbedildi, kalem kalem odenecek",
    narrationTone: "Birinci tekil; iyilik gasbedilir, sessiz delil, herkesin onunde kalem kalem hesap, pismanlik. NetShort ana turu.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "dark-ambient",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "guclu-donus",
    label: "Guclu donus",
    tagline: "Hor gorulen, maskeyi yirtar",
    narrationTone: "Birinci tekil; public asagilanma, sessiz guclenme, gosterisli donus — ayni salon, bu kez herkes ayakta.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "yeniden-dogus",
    label: "Yeniden dogus",
    tagline: "Ikinci sans, bu kez kurallar farkli",
    narrationTone: "Birinci tekil; enkazdan ikinci sans, ayni hatalar yok, sifirdan kurulus, eski hayat karsisina cikinca sakin netlik.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "kadin-gelisimi",
    label: "Kadin gelisimi",
    tagline: "Ezilen kadin kendi ayaklarinda yukselir",
    narrationTone: "Birinci tekil; sistematik ezilme, sakin karar, somut adimlarla yukselis (ilk musteri, ilk dukkan), donuste kucuk kalan ezenler.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "gizli-kimlik",
    label: "Gizli kimlik",
    tagline: "Sofor sanilan patron, dilenci sanilan varis",
    narrationTone: "Birinci tekil; sade gorunen guclu kahraman, ezilme, finale yakin kimlik acilisi, status soku.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "pulse-low",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "sozlesmeli-evlilik",
    label: "Sozlesmeli evlilik",
    tagline: "Kontrat sogugu, beklenmedik bag",
    narrationTone: "Birinci tekil; cikar evliligi, kurallar, eriyen buz, kriz, sozlesme yirtma veya sakin ayrilik. Yatak yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "yildirim-nikahi",
    label: "Yildirim nikahi",
    tagline: "Ani evlilik, sonra gercekler",
    narrationTone: "Birinci tekil; ani nikah, acilan gercekler, cevre baskisi, kendi gozüyle karar.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "zengin-aile",
    label: "Zengin aile drami",
    tagline: "Miras, hissedar oyunu, ask ucgeni",
    narrationTone: "Birinci tekil; holding ailesi, kumpas, sessiz ittifak, hissedar toplantisinda ifsa, taht degisimi.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "dark-ambient",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "pismanlik",
    label: "Pismanlik",
    tagline: "Terk eden yalvarir, geri getiremez",
    narrationTone: "Birinci tekil; terk, parlayan kahraman, batan karsi taraf, uzun pismanlik seyri, soguk 'cok gec'.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 0.98,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "trajik-ask",
    label: "Trajik ask",
    tagline: "Buyuk ask, acimasiz engel",
    narrationTone: "Birinci tekil; buyuk ask, acimasiz engel, korumak icin birakma, yillar sonra acilan gercek, buruk-guclu final.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 0.98,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "aile-bagi",
    label: "Aile bagi",
    tagline: "Kayip aile, gec kavusma, bedel",
    narrationTone: "Birinci tekil; kayip evlat/anne, sahte aile pişkinligi, esya ile acilan bag, sakin hesap. Sahnede cocuk yok; herkes yetiskin.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 0.98,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "ahlaki-ikilem",
    label: "Ahlaki ikilem",
    tagline: "Iki dogru, tek secim, bedel",
    narrationTone: "Birinci tekil; iki dogru arasinda secim, gercek bedel, vicdan tarafi, finalde onurlu ustunluk. Vaaz yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "pulse-low",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "romantik",
    label: "Romantik",
    tagline: "Yakinlasma, ihanet soku, secim",
    narrationTone: "Birinci tekil; yakinlasma + ihanet darbe + sakin secim. Cinsel sahne yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "dram",
    label: "Dram",
    tagline: "Iliski, kayip, status cevirisi",
    narrationTone: "Birinci tekil; tek omurga, sakin karar, donus. Yumusak melodram şiiri yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 0.98,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "gerilim",
    label: "Gerilim",
    tagline: "Tehdit hissi, zaman daralir",
    narrationTone: "Birinci tekil; psikolojik baski, kanli siddet yok.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "pulse-low",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "korku",
    label: "Korku",
    tagline: "Tekinsiz ev, ses, gorunmeyen sey",
    narrationTone: "Birinci tekil; ev sesi, merdiven, lamba. Kanli sok yok.",
    visualLock:
      "photoreal cinematic still, empty house, stairwell, door handle, practical lamp, night interior, no text, no letters, no watermark, no logo, no gore, no minors",
    musicMood: "dark-ambient",
    defaultPace: "slow",
    defaultSpeed: 0.96,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "ozel",
    label: "Ozel",
    tagline: "Kendi turunu yaz; hikaye o kelimeye gore gelir",
    narrationTone: "Birinci tekil; kullanicinin yazdigi ozel tur adina sadik. NetShort tempo: sakin yikici karar, donus, pismanlik.",
    visualLock: DRAMA_STILL_LOCK,
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "first",
    topicSuggestions: [],
  },
  {
    id: "mystery",
    label: "Gizem / kayip uygarlik",
    tagline: "Kayip sehirler, gomulu isaretler, cevaplanmamis haritalar",
    narrationTone: "Ucuncu tekil, sakin ama meraklı belgesel sesi; ipucunu erken acma.",
    visualLock:
      "photoreal documentary still, archaeological sites, weathered stone, dusk haze, 35mm film grain, muted earth palette, no text, no letters, no watermark, no logo, no caption",
    musicMood: "dark-ambient",
    defaultPace: "normal",
    defaultSpeed: 0.98,
    pov: "third",
    topicSuggestions: [
      "17. yuzyil Paris'inde La Voisin ve zehir davasi: kimler dahil oldu, mahkeme ne gizledi, hikaye nasil kapandi?",
      "Kayip bir sahil kentinin haritasinda isaretlenen kuyu: kazı notlari yarim, taniklar susuyor, son mektup bir isimle bitiyor.",
    ],
  },
  {
    id: "history",
    label: "Tarih / skandal",
    tagline: "Saray entrikasi, mahkeme, zehir, gizli yazisma",
    narrationTone: "Tarihci belgesel tonu; somut tarih, isim ve yer; abarti yok.",
    visualLock:
      "photoreal historical documentary still, period interiors, candlelight, oil-painting texture without painted look, archival museum lighting, no text, no letters, no watermark, no logo",
    musicMood: "period-strings",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "third",
    topicSuggestions: [
      "Bir saray skandali: zehir, gizli yazisma, mahkeme tutanagi. Kim susuyor, hangi isim dosyadan cikarildi?",
      "Tarihe gomulmus bir itiraf mektubu: tarihci tonu, somut yer ve yil, abarti yok.",
    ],
  },
  {
    id: "investigation",
    label: "Arastirma / bilinmeyenler",
    tagline: "Dosya, tanik, eksik sayfa, henuz kapanmamis soru",
    narrationTone: "Sorusturma belgeseli: kanit, celişki, ertelenen cevap.",
    visualLock:
      "photoreal investigative documentary still, dim archives, maps without readable labels, rain-soaked streets, cool tungsten, no text, no letters, no watermark, no logo",
    musicMood: "pulse-low",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "third",
    topicSuggestions: [
      "Kapanmamis bir dosya: eksik sayfa, celisen tanik, yagmurda bir arsiv odasi. Cevabi erken verme.",
      "Bir harita, bir numara, uc kez calan suskun telefon. Sorusturma belgeseli gibi ilerle.",
    ],
  },
  {
    id: "sleep",
    label: "Uyku oncesi hikaye",
    tagline: "Yavas, yumusak, loş; uykuya götüren uzun anlatı",
    narrationTone: "Cok yavas, sicak, fısıltıya yakin; gerilimi dusuk tut, kapanisi yumusat.",
    visualLock:
      "photoreal soft nocturnal still, candle glow, misty forests, quiet bedrooms from a distance, warm low contrast, no text, no letters, no watermark, no logo",
    musicMood: "sleep-drone",
    defaultPace: "slow",
    defaultSpeed: 0.88,
    pov: "third",
    topicSuggestions: [
      "Sisli bir ormanda yavas ilerleyen bir gece: isiklar uzak, sesler yumusak, kapanis uykuya götürür.",
      "Loş bir ev, mum, yagmur camda. Gerilim yok; uzun, sicak, yavas bir anlati.",
    ],
  },
  {
    id: "meditation",
    label: "Meditasyon / sakin anlati",
    tagline: "Nefes, doga, tekrar eden imgeler, yargisiz ses",
    narrationTone: "Kisa cumleler, bol nefes, yargisiz gozlem; vaaz etme.",
    visualLock:
      "photoreal calm nature still, water, fog, stone, slow light, desaturated greens, no text, no letters, no watermark, no logo, no people facing camera",
    musicMood: "meditation",
    defaultPace: "slow",
    defaultSpeed: 0.9,
    pov: "third",
    topicSuggestions: [
      "Nefes, su, tas, sis. Yargisiz gozlem; vaaz yok. Ayni imgeler yavasca doner.",
      "Sakin bir sahil ve tekrar eden dalga. Kisa cumleler, bol durak, kameraya konusma yok.",
    ],
  },
  {
    id: "documentary",
    label: "Belgesel genel",
    tagline: "Klasik dis ses belgeseli; konu neyse onu derinlestir",
    narrationTone: "Net, olculu, ucuncu tekil belgesel anlatimi.",
    visualLock:
      "photoreal cinematic documentary still, natural light, shallow depth, editorial photography, no text, no letters, no watermark, no logo, no caption",
    musicMood: "cinematic-soft",
    defaultPace: "normal",
    defaultSpeed: 1,
    pov: "third",
    topicSuggestions: [
      "Klasik dis ses belgeseli: konuyu sec, somut yer ve tanikla derinlestir, yeni mini-hikaye acma.",
      "Bir meslek, bir sehir, bir karar. Net, olculu, ucuncu tekil anlatim.",
    ],
  },
];

export const LONGFORM_VOICES: LongformVoice[] = [
  {
    id: "female",
    label: "Kadin ses",
    openaiVoice: "nova",
    description: "Sicak, net kadin belgesel sesi",
  },
  {
    id: "male",
    label: "Erkek ses",
    openaiVoice: "onyx",
    description: "Dusuk, sakin erkek belgesel sesi",
  },
];

/** Tek resim kaynagi: Flow. Site genelinde baska gorsel motoru yoktur. */
export const LONGFORM_IMAGE_PROVIDERS = ["flow"] as const;
export type LongformImageProvider = (typeof LONGFORM_IMAGE_PROVIDERS)[number];

/**
 * Flow fotograf modelleri — proje.flowImageModel ile ayni liste.
 * Ilk sirada olan VARSAYILAN secilir (bkz. defaultLongformImageModel).
 */
export const LONGFORM_FLOW_IMAGE_MODELS = FLOW_IMAGE_MODELS;

export function isLongformImageProvider(value: string): value is LongformImageProvider {
  return (LONGFORM_IMAGE_PROVIDERS as readonly string[]).includes(value);
}

export function defaultLongformImageModel(_provider?: LongformImageProvider): string {
  return LONGFORM_FLOW_IMAGE_MODELS[0];
}

/** Kayitli/istenen model gecerliyse AYNEN korunur; degilse varsayilana duser. */
export function resolveLongformImageModel(_provider: string, model: string): string {
  return resolveFlowImageModel(model);
}

export function longformImageSourceLabel(_provider: string, model: string): string {
  return `Flow · ${resolveLongformImageModel("flow", model)}`;
}

/**
 * Anlatim %10 daha hizli olsun: tur bazli temel tempo korunur (uyku/meditasyon
 * yine daha sakin), uzerine tek bir carpan uygulanir.
 */
export const SPEECH_SPEED_BOOST = 1.1;

/** Turun onerilen TTS hizi (%10 artis uygulanmis). */
export function longformDefaultSpeed(genre: Pick<LongformGenre, "defaultSpeed">): number {
  return clampLongformSpeed(genre.defaultSpeed * SPEECH_SPEED_BOOST);
}

/** Hiz secilmemis eski kayitlar: bu degerler "varsayilan" sayilir ve yeni varsayilana tasinir. */
const LEGACY_DEFAULT_SPEEDS = new Set([0.88, 0.9, 0.96, 0.98, 1]);

export const DEFAULT_LONGFORM_SETTINGS = {
  genreId: "mystery" as LongformGenreId,
  /** Ozel tur secilince kullanicinin yazdigi ad; hikaye bu kelimeye gore yazilir. */
  customGenre: "",
  /** TTS katalogu kimligi veya eski "female" / "male". */
  voiceId: "female" as string,
  ttsSpeed: 1.1,
  ttsPitch: 0,
  /** Klip duygusuna gore ses sertlesir / yavaslar (sinir, pismanlik...). */
  ttsExpressive: true,
  stillIntervalSeconds: 15 as LongformStillInterval,
  visualFormat: "stills" as NarratorFormat,
  stillMotion: "hold" as LongformStillMotion,
  musicEnabled: true,
  musicFileName: "",
  imageProvider: "flow" as LongformImageProvider,
  imageModel: LONGFORM_FLOW_IMAGE_MODELS[0] as string,
  outputResolution: "1080" as LongformResolution,
  renderFps: 24 as LongformFps,
  renderEncoder: "balanced" as LongformEncoder,
  subtitles: { ...DEFAULT_SUBTITLE_STYLE },
};

/**
 * voiceId artik TTS katalogu kimligi tutar ("google:tr-TR-Chirp3-HD-Kore").
 * Eski kayitlardaki "female" / "male" degerleri de gecerlidir; seslendirme
 * cozumleyicisi bunlari projenin diline uygun sese eslestirir.
 */

export type LongformSettings = typeof DEFAULT_LONGFORM_SETTINGS;

export function longformGenreById(id: string): LongformGenre {
  return (
    LONGFORM_GENRES.find((g) => g.id === id) ??
    LONGFORM_GENRES.find((g) => g.id === "mystery") ??
    LONGFORM_GENRES[0]
  );
}

export function normalizeCustomGenreName(raw: string | null | undefined): string {
  return (raw || "").replace(/\s+/g, " ").trim();
}

export function longformStoredGenreName(settings: Pick<LongformSettings, "genreId" | "customGenre">): string {
  if (settings.genreId === "ozel") {
    return normalizeCustomGenreName(settings.customGenre) || "ozel";
  }
  return settings.genreId;
}

/** Ozel turde etiket = kullanicinin yazdigi kelime; senaryo ve UI bunu kullanir. */
export function resolveLongformGenre(
  settings: Pick<LongformSettings, "genreId" | "customGenre">,
  projectGenre?: string | null
): LongformGenre {
  const base = longformGenreById(settings.genreId);
  if (base.id !== "ozel") return base;
  const fromSettings = normalizeCustomGenreName(settings.customGenre);
  const fromProject = normalizeCustomGenreName(projectGenre);
  const label =
    fromSettings ||
    (fromProject && !/^(ozel|özel)$/i.test(fromProject) ? fromProject : "") ||
    "Ozel";
  return {
    ...base,
    label,
    tagline: `Ozel tur: ${label}`,
    narrationTone: `Birinci tekil; hikaye "${label}" turune sadik kalsin. Konu bu kelimenin etrafinda. NetShort tempo: sakin yikici karar, donus, pismanlik.`,
  };
}

export function longformTopicSuggestions(id: string): string[] {
  return longformGenreById(id).topicSuggestions.filter((t) => t.trim().length > 0);
}

export function longformVoiceById(id: string): LongformVoice {
  return LONGFORM_VOICES.find((v) => v.id === id) ?? LONGFORM_VOICES[0];
}

export function isLongformStillInterval(value: number): value is LongformStillInterval {
  return (LONGFORM_STILL_INTERVALS as readonly number[]).includes(value);
}

export function isNarratorFormat(value: string): value is NarratorFormat {
  return (NARRATOR_FORMATS as readonly string[]).includes(value);
}

export function isLongformStillMotion(value: string): value is LongformStillMotion {
  return (LONGFORM_STILL_MOTIONS as readonly string[]).includes(value);
}

export function clampLongformSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1.3, Math.max(0.7, Math.round(value * 100) / 100));
}

export function clampLongformPitch(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(6, Math.max(-6, Math.round(value)));
}

/** Uzun form JSON: once longformSettings, yoksa seriesHook. */
export function longformSettingsSource(project: { longformSettings?: string | null; seriesHook?: string | null }): string {
  if (project.longformSettings && project.longformSettings.trim() && project.longformSettings.trim() !== "{}") {
    return project.longformSettings;
  }
  return project.seriesHook || project.longformSettings || "{}";
}

export function parseLongformSettings(raw: string | null | undefined): LongformSettings {
  const defaults = { ...DEFAULT_LONGFORM_SETTINGS, subtitles: parseSubtitleStyle(DEFAULT_SUBTITLE_STYLE) };
  if (!raw || !raw.trim() || raw.trim() === "{}") return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<LongformSettings>;
    const genre = longformGenreById(String(parsed.genreId || defaults.genreId));
    const customGenre = normalizeCustomGenreName(
      typeof parsed.customGenre === "string" ? parsed.customGenre : ""
    );
    const voiceId = String(parsed.voiceId || defaults.voiceId).trim() || defaults.voiceId;
    const intervalRaw = Number(parsed.stillIntervalSeconds);
    const motionRaw = String(parsed.stillMotion || "");
    const imageProvider = isLongformImageProvider(String(parsed.imageProvider || ""))
      ? (parsed.imageProvider as LongformImageProvider)
      : defaults.imageProvider;
    const storedSpeed = clampLongformSpeed(Number(parsed.ttsSpeed ?? defaults.ttsSpeed));
    return {
      genreId: genre.id,
      customGenre,
      voiceId,
      ttsSpeed: LEGACY_DEFAULT_SPEEDS.has(storedSpeed) ? longformDefaultSpeed(genre) : storedSpeed,
      ttsPitch: clampLongformPitch(Number(parsed.ttsPitch ?? defaults.ttsPitch)),
      ttsExpressive: parsed.ttsExpressive !== false,
      stillIntervalSeconds: isLongformStillInterval(intervalRaw) ? intervalRaw : defaults.stillIntervalSeconds,
      visualFormat: parsed.visualFormat === "video" ? "video" : "stills",
      stillMotion: isLongformStillMotion(motionRaw) ? motionRaw : defaults.stillMotion,
      musicEnabled: parsed.musicEnabled !== false,
      musicFileName: typeof parsed.musicFileName === "string" ? parsed.musicFileName : "",
      imageProvider,
      imageModel: resolveLongformImageModel(imageProvider, String(parsed.imageModel || "")),
      outputResolution: parseLongformResolution(parsed.outputResolution),
      renderFps: parseLongformFps(parsed.renderFps),
      renderEncoder: parseLongformEncoder(parsed.renderEncoder),
      subtitles: parseSubtitleStyle(parsed.subtitles),
    };
  } catch {
    return defaults;
  }
}

export function serializeLongformSettings(settings: LongformSettings): string {
  return JSON.stringify({
    genreId: settings.genreId,
    customGenre: normalizeCustomGenreName(settings.customGenre),
    voiceId: settings.voiceId,
    ttsSpeed: clampLongformSpeed(settings.ttsSpeed),
    ttsPitch: clampLongformPitch(settings.ttsPitch),
    ttsExpressive: settings.ttsExpressive !== false,
    stillIntervalSeconds: isLongformStillInterval(settings.stillIntervalSeconds)
      ? settings.stillIntervalSeconds
      : DEFAULT_LONGFORM_SETTINGS.stillIntervalSeconds,
    visualFormat: settings.visualFormat === "video" ? "video" : "stills",
    stillMotion: isLongformStillMotion(settings.stillMotion) ? settings.stillMotion : DEFAULT_LONGFORM_SETTINGS.stillMotion,
    musicEnabled: settings.musicEnabled !== false,
    musicFileName: settings.musicFileName || "",
    imageProvider: isLongformImageProvider(settings.imageProvider) ? settings.imageProvider : DEFAULT_LONGFORM_SETTINGS.imageProvider,
    imageModel: resolveLongformImageModel(
      isLongformImageProvider(settings.imageProvider) ? settings.imageProvider : DEFAULT_LONGFORM_SETTINGS.imageProvider,
      settings.imageModel || ""
    ),
    outputResolution: parseLongformResolution(settings.outputResolution),
    renderFps: parseLongformFps(settings.renderFps),
    renderEncoder: parseLongformEncoder(settings.renderEncoder),
    subtitles: parseSubtitleStyle(settings.subtitles),
  });
}

export function estimateLongformStillCount(durationSeconds: number, intervalSeconds: number): number {
  const duration = Math.max(20, durationSeconds);
  const interval = Math.max(10, intervalSeconds);
  return Math.max(1, Math.round(duration / interval));
}

/**
 * Gorsel anlati kadrosu — sureye gore isimli yuz sayisi.
 * 10 dk'da 2-3 kisi bos kalir; 5-7 isim (anlatici "ben" haric) sahne cevrisi icin yeter.
 * Tek karede hepsi durmaz; kadro hikaye boyunca doner.
 */
export function longformNamedCastBudget(durationSeconds: number): { min: number; max: number } {
  const minutes = Math.max(1, durationSeconds / 60);
  if (minutes < 8) return { min: 3, max: 4 };
  if (minutes < 13) return { min: 5, max: 7 };
  if (minutes < 22) return { min: 6, max: 8 };
  if (minutes < 35) return { min: 7, max: 9 };
  return { min: 8, max: 10 };
}

export function formatLongformCastBudget(budget: { min: number; max: number }): string {
  return budget.min === budget.max ? `${budget.min}` : `${budget.min}-${budget.max}`;
}

export function narratorFormatLabel(format: string): string {
  return format === "video" ? "Video" : "Gorsel slayt";
}

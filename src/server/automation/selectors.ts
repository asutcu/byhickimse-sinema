import { z } from "zod";
import type { Locator, Page } from "playwright";
import { prisma } from "@/server/db";
import { recordEvent } from "@/server/lib/logger";

/**
 * Flow secici sistemi — dayanikli surum.
 *
 * Tasarim ilkeleri:
 * 1. Her anahtar icin TEK secici degil, SIRALI YEDEK ZINCIRI tutulur.
 *    Kalibrasyonda uretilen tum dogrulanmis adaylar kaydedilir.
 * 2. Zincirin sonuna, kalibrasyon hic yapilmasa bile calisabilen
 *    YERLESIK ANLAMSAL TARIFLER eklenir (rol + cok dilli ad kaliplari).
 * 3. Calisma aninda zincir sirayla denenir; calisan aday one alinir
 *    (kendini onarma). Boylece arayuz degistiginde otomasyon durmaz.
 *
 * Oncelik sirasi (kalibrasyonda): role > label > placeholder > text > testid > css.
 */

export const SELECTOR_STRATEGIES = ["role", "label", "placeholder", "text", "testid", "css"] as const;
export type SelectorStrategy = (typeof SELECTOR_STRATEGIES)[number];

export const selectorCandidateSchema = z.object({
  strategy: z.enum(SELECTOR_STRATEGIES),
  value: z.string(),
  roleName: z.string().default(""),
});
export type SelectorCandidate = z.infer<typeof selectorCandidateSchema>;

export const flowSelectorSchema = z.object({
  key: z.string().min(1),
  strategy: z.enum(SELECTOR_STRATEGIES),
  value: z.string(),
  roleName: z.string().default(""),
  description: z.string().default(""),
  required: z.boolean().default(true),
});

export type FlowSelectorConfig = z.infer<typeof flowSelectorSchema>;

/** Kalibrasyon gerektiren tum secici anahtarlari. */
export const DEFAULT_SELECTORS: FlowSelectorConfig[] = [
  { key: "promptInput", strategy: "css", value: "", roleName: "", description: "Prompt metin kutusu", required: true },
  { key: "generateButton", strategy: "css", value: "", roleName: "", description: "Generate dugmesi", required: true },
  {
    key: "generationSettingsButton",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Uretim ayarlari paneli acma dugmesi (prompt cubugunun yanindaki 'Video · 16:9 · x1' ozeti)",
    required: false,
  },
  { key: "modelMenu", strategy: "css", value: "", roleName: "", description: "Model secim menusu (ayarlar paneli icinde)", required: false },
  { key: "modelOption", strategy: "css", value: "", roleName: "", description: "Model secenegi (metinle bulunur, kalibrasyon istege bagli)", required: false },
  { key: "durationMenu", strategy: "css", value: "", roleName: "", description: "Sure secim menusu", required: false },
  { key: "aspectRatioMenu", strategy: "css", value: "", roleName: "", description: "En-boy orani menusu", required: false },
  { key: "audioToggle", strategy: "css", value: "", roleName: "", description: "Ses acma/kapama anahtari", required: false },
  { key: "uploadReferenceButton", strategy: "css", value: "", roleName: "", description: "Referans gorsel yukleme dugmesi", required: false },
  {
    key: "referenceConfirmButton",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Medya penceresindeki onay dugmesi ('Isteme ekle')",
    required: false,
  },
  { key: "generationProgress", strategy: "css", value: "", roleName: "", description: "Uretim ilerleme gostergesi", required: false },
  { key: "generationComplete", strategy: "css", value: "", roleName: "", description: "Uretim tamamlandi gostergesi (video karti vb.)", required: false },
  { key: "errorBanner", strategy: "css", value: "", roleName: "", description: "Hata banner'i", required: false },
  {
    key: "assetMenuButton",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Video kartinin uc nokta/menu dugmesi (yedek; kartin kendi 'Indir' dugmesi once denenir)",
    required: false,
  },
  {
    key: "downloadMenuItem",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Indirme menu ogesi (yedek; 'Projeyi indir' SECILMEMELI)",
    required: false,
  },
  { key: "downloadVideoItem", strategy: "css", value: "", roleName: "", description: "Indirilecek video kalitesi ogesi", required: false },
  { key: "newProjectButton", strategy: "css", value: "", roleName: "", description: "Yeni proje dugmesi", required: false },
  { key: "projectListItem", strategy: "css", value: "", roleName: "", description: "Proje listesinde proje karti (metinle bulunur)", required: false },
  {
    key: "outputTypeMenu",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Cikti turu menusu (prompt cubugunda video/gorsel modu secen dugme)",
    required: false,
  },
  {
    key: "imageModeOption",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Gorsel uretim modu secenegi (Metinden goruntuye / Nano Banana)",
    required: false,
  },
  {
    key: "videoModeOption",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Video uretim modu secenegi (Metinden videoya / Veo)",
    required: false,
  },
  {
    key: "characterNewButton",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Karakterler sayfasinda 'Yeni karakter' dugmesi",
    required: false,
  },
  {
    key: "characterDescriptionInput",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Karakter olusturma penceresindeki tarif kutusu",
    required: false,
  },
  {
    key: "characterGenerateButton",
    strategy: "css",
    value: "",
    roleName: "",
    description: "Karakter olusturma penceresindeki olustur dugmesi",
    required: false,
  },
];

/**
 * Yerleşik anlamsal tarifler: kalibrasyon olmadan da calisabilmesi icin
 * her anahtarin sonuna eklenen, arayuz diline ve ikon fontlarina dayanikli
 * aday listesi. Erisilebilirlik rolu + cok dilli ad kaliplari kullanilir;
 * adsiz rol adaylari en sona konur (ilk eslesen ogeyi secerler).
 */
/*
 * TURKCE UYARISI: JavaScript'in "i" bayragi, Turkce buyuk I (U+0130) ile
 * kucuk "i" harfini ESLESTIRMEZ. Bu yuzden Turkce'de buyuk I ile baslayan
 * kelimelerde ("Isteme ekle", "Indir") acikca [iİ] karakter sinifi yazilir.
 */
export const SEMANTIC_FALLBACKS: Record<string, SelectorCandidate[]> = {
  // Prompt cubugunun yanindaki ozet dugme: kapaliyken ikon+"x{n}" adet
  // etiketini bir arada gosterir (or. "Videocrop_16_9x1"). Panel acikken bu
  // metin kaybolur (yerini sekmeler alir), o yuzden yalnizca panel kapaliyken
  // aranir (bkz. openGenerationSettingsPanel).
  generationSettingsButton: [
    { strategy: "text", value: "crop_(16_9|9_16)[\\s\\S]{0,15}x[1-4]\\b", roleName: "" },
    { strategy: "css", value: "button[aria-haspopup='menu']:has-text('crop_16_9'), button[aria-haspopup='menu']:has-text('crop_9_16')", roleName: "" },
  ],
  // Ayarlar paneli icindeki model dugmesi: model adi + acilir ok ikonu
  // ("Veo 3.1 - Fastarrow_drop_down" gibi tek dugme metni). Gorsel modda
  // etiket "Nano Banana Pro" / "Nano Banana 2" olur — bu kalip eksikti ve
  // menu hep "bulunamadi" dusup Flow'da o an secili (kotasi bitmis) modelde
  // takili birakiyordu.
  modelMenu: [{ strategy: "text", value: "(veo|omni|gemini|nano ?banana)[\\s\\S]{0,25}arrow_drop_down", roleName: "" }],
  promptInput: [
    // Bos video promptunun yer tutucu metni — gizli z-index:-1 kutulardan once
    { strategy: "text", value: "ne olu[sş]turmak istiyorsun|what do you want to create", roleName: "" },
    { strategy: "css", value: "textarea", roleName: "" },
    { strategy: "role", value: "textbox", roleName: "ne olu|create|prompt" },
    // Son care: genel contenteditable (findPromptInput isVideoPromptBox ile elenir)
    { strategy: "css", value: "[contenteditable='true']", roleName: "" },
  ],
  generateButton: [
    // Gonderme dugmesi ileri-ok ikonu tasir. Bu aday BASTA olmali: prompt
    // cubugundaki "+" dugmesinin adi da "Olustur"dur (add_2Olustur) ve genel
    // "olustur" kalibi once ona takilirsa uretim yerine medya penceresi acilir.
    { strategy: "text", value: "^\\s*arrow_forward", roleName: "" },
    { strategy: "role", value: "button", roleName: "^(?!add_2).*(generate|olu[sş]tur|[uü]ret|g[oö]nder|send|submit|create)" },
    { strategy: "css", value: "button[type='submit']", roleName: "" },
    { strategy: "css", value: "[aria-label*='oluştur' i], [aria-label*='generate' i], [aria-label*='gönder' i]", roleName: "" },
  ],
  assetMenuButton: [
    { strategy: "css", value: "[aria-haspopup='menu']", roleName: "" },
    { strategy: "role", value: "button", roleName: "more|menu|option|se[cç]enek|di[gğ]er|daha" },
  ],
  downloadMenuItem: [
    { strategy: "role", value: "menuitem", roleName: "download|[iİ]ndir" },
    { strategy: "text", value: "^\\s*(download|[iİ]ndir)\\s*$", roleName: "" },
  ],
  downloadVideoItem: [
    { strategy: "role", value: "menuitem", roleName: "720|1080|4k|original|orijinal|y[uü]ksek|high|standart|mp4" },
    { strategy: "text", value: "720|1080|4k|original|orijinal boyut|mp4", roleName: "" },
  ],
  // Prompt cubugundaki "+" dugmesi: medya PENCERESI acar. Ust seritteki
  // "Medya ekle" MENUSU (aria-haspopup='menu') dosyayi yalnizca kitapliga
  // yukler, isteme eklemez — bu yuzden once pencere acan dugme aranir.
  uploadReferenceButton: [
    { strategy: "css", value: "button[aria-haspopup='dialog']", roleName: "" },
    { strategy: "text", value: "^\\s*add_2", roleName: "" },
    { strategy: "role", value: "button", roleName: "add image|g[oö]rsel ekle|ingredient|malzeme" },
    { strategy: "css", value: "input[type='file']", roleName: "" },
  ],
  referenceConfirmButton: [
    { strategy: "role", value: "button", roleName: "[iİ][sş][tl]eme ekle|add to (prompt|request|scene)|sahneye ekle" },
    { strategy: "text", value: "^\\s*([iİ][sş][tl]eme ekle|add to (prompt|request))\\s*$", roleName: "" },
    { strategy: "role", value: "button", roleName: "^\\s*(ekle|add|kullan|use|done|bitti|se[cç]|select)\\s*$" },
  ],
  generationProgress: [
    { strategy: "css", value: "[role='progressbar']", roleName: "" },
    { strategy: "css", value: "[aria-busy='true']", roleName: "" },
    // Flow uretim kartindaki durum yazilari
    { strategy: "text", value: "(olu[sş]turuluyor|generating|i[sş]leniyor|processing)", roleName: "" },
    // Yalnizca yuzde iceren rozet (or. "%57" / "57%") — tum metni yuzdeden ibaret oge
    { strategy: "text", value: "^\\s*%\\s*\\d{1,3}\\s*$|^\\s*\\d{1,3}\\s*%\\s*$", roleName: "" },
  ],
  // Adsiz "role=alert" bilincli olarak yok: zararsiz bildirimleri hata sanabilir.
  // Tek kelime "hata/error" da KULLANILMAZ: Flow'un sayfa altindaki kalici
  // "Flow hata yapabileceginden..." uyarisina takilir. Yalnizca gercek hata cumleleri:
  errorBanner: [
    {
      strategy: "text",
      value:
        "(bir hata olu[sş]tu|hata olu[sş]tu|hay aksi|olu[sş]turulamad[iı]|[uü]retilemedi|generation failed|failed to generate|couldn'?t (generate|create)|something went wrong|bir [sş]eyler ters gitti|quota|kredi yetersiz|limit a[sş][iı]ld)",
      roleName: "",
    },
    // Icerik politikasi engeli: "Bu istem ... politikalarimizi ihlal ediyor olabilir"
    {
      strategy: "text",
      value: "(politikalar[iı]m[iı]z[iı] ihlal|ihlal ediyor olabilir|tan[iı]nm[iı][sş] ki[sş]iler|may violate|violates? (our|the) polic|content polic)",
      roleName: "",
    },
    // Flow'un "uretim basarisiz" karti: "Olusturma islemi basarisiz oldugunda
    // ucret alinmaz" cumlesi ve "Basarisiz" durum etiketi yalnizca bu kartta gecer
    {
      strategy: "text",
      value:
        "(olu[sş]turma i[sş]lemi ba[sş]ar[iı]s[iı]z|[uü]cret al[iı]nmaz|won'?t be charged|you will not be charged)",
      roleName: "",
    },
    { strategy: "text", value: "^\\s*(ba[sş]ar[iı]s[iı]z|failed)\\s*$", roleName: "" },
  ],
  newProjectButton: [
    { strategy: "role", value: "button", roleName: "new project|yeni proje" },
    { strategy: "text", value: "new project|yeni proje", roleName: "" },
  ],
  audioToggle: [{ strategy: "role", value: "switch", roleName: "" }],
  // Tamamlanmis video kartinin kesin izi: Flow her medyayi sabit kimlikli bir
  // adresle gosterir. Hash'li CSS siniflari surumle degisir, bu adres degismez.
  generationComplete: [
    { strategy: "css", value: "video[src*='media.getMediaUrlRedirect']", roleName: "" },
    { strategy: "css", value: "video", roleName: "" },
  ],
  // Cikti turu menusu: prompt cubugunda o anki modu gosteren dugme
  // (or. "Metinden videoya" / "Text to video" / "Malzemelerden video").
  outputTypeMenu: [
    {
      strategy: "role",
      value: "button",
      roleName:
        "(metinden (videoya|g[oö]r[uü]nt[uü]ye)|text to (video|image)|g[oö]r[uü]nt[uü]den videoya|frames to video|malzemelerden|ingredients to (video|image))",
    },
    {
      strategy: "role",
      value: "combobox",
      roleName: "(metinden|text to|cikti|[cç][iı]kt[iı]|output|t[uü]r|type|malzemelerden|ingredients)",
    },
    {
      strategy: "text",
      value:
        "^\\s*(metinden (videoya|g[oö]r[uü]nt[uü]ye)|text to (video|image)|g[oö]r[uü]nt[uü]den videoya|frames to video|malzemelerden (video|g[oö]r[uü]nt[uü])|ingredients to (video|image))\\s*$",
      roleName: "",
    },
  ],
  imageModeOption: [
    { strategy: "role", value: "menuitem", roleName: "(metinden g[oö]r[uü]nt[uü]|text to image|nano ?banana|g[oö]rsel olu[sş]tur|ingredients to image|malzemelerden g[oö]r[uü]nt[uü])" },
    { strategy: "role", value: "option", roleName: "(metinden g[oö]r[uü]nt[uü]|text to image|nano ?banana|ingredients to image)" },
    { strategy: "text", value: "^\\s*(metinden g[oö]r[uü]nt[uü]ye|text to image|nano ?banana( pro)?|ingredients to image|malzemelerden g[oö]r[uü]nt[uü])\\s*$", roleName: "" },
  ],
  videoModeOption: [
    // Referans ekliyken "Malzemelerden video / Ingredients to video" secilmeli;
    // yalnizca "Metinden video" aramak gorsel modda kalmaya yol acar.
    { strategy: "role", value: "menuitem", roleName: "(metinden video|text to video|video olu[sş]tur|ingredients to video|malzemelerden video|frames to video|g[oö]r[uü]nt[uü]den video)" },
    { strategy: "role", value: "option", roleName: "(metinden video|text to video|ingredients to video|malzemelerden video)" },
    { strategy: "text", value: "^\\s*(metinden videoya|text to video|ingredients to video|malzemelerden video|frames to video|g[oö]r[uü]nt[uü]den videoya)\\s*$", roleName: "" },
  ],
  // Flow'un proje ici KARAKTERLER sayfasi (.../project/<id>/characters)
  characterNewButton: [
    { strategy: "role", value: "button", roleName: "(yeni karakter|new character|karakter olu[sş]tur|create character|karakter ekle|add character)" },
    { strategy: "text", value: "^\\s*(yeni karakter|new character|karakter olu[sş]tur|create character)\\s*$", roleName: "" },
    { strategy: "text", value: "person_add|add_2", roleName: "" },
    { strategy: "role", value: "button", roleName: "person_add|add_2|karakter|character" },
    { strategy: "role", value: "button", roleName: "^\\s*(yeni|new|olu[sş]tur|create|\\+)\\s*$" },
  ],
  characterDescriptionInput: [
    { strategy: "placeholder", value: "karakter|character|tarif|describe|tan[iı]mla", roleName: "" },
    { strategy: "css", value: "[role='dialog'] textarea, [aria-modal='true'] textarea", roleName: "" },
    { strategy: "css", value: "textarea", roleName: "" },
    { strategy: "css", value: "[contenteditable='true']", roleName: "" },
  ],
  characterGenerateButton: [
    { strategy: "css", value: "[role='dialog'] button[type='submit'], [aria-modal='true'] button[type='submit']", roleName: "" },
    { strategy: "role", value: "button", roleName: "(olu[sş]tur|generate|create|[uü]ret)" },
  ],
};

/**
 * DB'de eksik olan varsayilan secicileri olusturur.
 * Aciklama ve zorunluluk bilgisi her acilista guncellenir; kullanicinin
 * kalibre ettigi degerlere dokunulmaz.
 */
export async function ensureDefaultSelectors(): Promise<void> {
  for (const def of DEFAULT_SELECTORS) {
    await prisma.flowSelector.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        strategy: def.strategy,
        value: def.value,
        roleName: def.roleName,
        description: def.description,
        required: def.required,
      },
      update: { description: def.description, required: def.required },
    });
  }
  await clearBrokenSelectors();
}

/**
 * Yapisal olarak hicbir zaman eslesemeyecek kalibrasyonlari temizler.
 * Bunlar erken surumlerin urettigi bozuk kayitlardir:
 *  - "html" / "body" gibi tum sayfayi kapsayan CSS seciciler
 *  - adsiz role secicileri (sayfadaki ilk rastgele dugmeye denk gelir)
 *  - ikon fontu metniyle birlesmis adlar (or. "arrow_forwardOlustur")
 *  - cok derin ve kirilgan nth-of-type zincirleri
 */
/**
 * PROJE GENELI indirme ogeleri ("Projeyi indir", "Download project", "Tumunu
 * indir"). Bunlar tek bir klibi degil, projenin tamamini iceren AYNI arsivi
 * verir: kalibrasyonda buraya denk gelinirse her klip icin ayni (eski) video
 * inip klipler yanlisca "tamamlandi" sayilir. Bu yuzden aday listesinden
 * ayiklanirlar.
 */
const PROJECT_LEVEL_DOWNLOAD = /projeyi indir|download project|t[uü]m[uü]n[uü] indir|download all|sahneyi indir/i;

/**
 * Klip indirme adaylari arasindaki proje geneli ogeleri temizler.
 * Kaydin tamami silinmez; yalnizca zararli adaylar ayiklanir, saglam adaylar
 * (or. "^(download|indir)$") korunur.
 */
/** Bir aday listesinden zararli adaylari ayiklar; saglam olanlar korunur. */
async function dropHarmfulCandidates(key: string, isBad: (candidate: SelectorCandidate) => boolean, reason: string): Promise<string[]> {
  const record = await prisma.flowSelector.findUnique({ where: { key } });
  if (!record) return [];

  const stored = parseCandidates(record.candidates);
  const goodStored = stored.filter((candidate) => !isBad(candidate));
  const primaryBad =
    !!record.value && isBad({ strategy: record.strategy as SelectorStrategy, value: record.value, roleName: record.roleName });
  if (goodStored.length === stored.length && !primaryBad) return [];

  const fallback = goodStored[0] ?? SEMANTIC_FALLBACKS[key]?.[0];
  await prisma.flowSelector.update({
    where: { key },
    data: {
      candidates: JSON.stringify(goodStored),
      ...(primaryBad && fallback
        ? { strategy: fallback.strategy, value: fallback.value, roleName: fallback.roleName, lastTestOk: null, lastTestAt: null }
        : {}),
    },
  });
  return [`${key} (${reason})`];
}

async function dropProjectLevelDownloadCandidates(): Promise<string[]> {
  const isBadDownload = (candidate: SelectorCandidate): boolean =>
    PROJECT_LEVEL_DOWNLOAD.test(candidate.roleName) || PROJECT_LEVEL_DOWNLOAD.test(candidate.value);

  // Not: Referans yukleme dugmesi burada AYIKLANMAZ. Yanlis dugme (kitaplik
  // menusu) ile dogrusu (pencere acan +) metinden ayirt edilemez; bunun yerine
  // openMediaDialog adaylari SONUCA gore dener ve calisani kalici yapar.
  return dropHarmfulCandidates("downloadMenuItem", isBadDownload, "proje geneli indirme adayi ayiklandi");
}

/** promptInput icin asiri genis CSS — ilk (gizli z-index:-1) kutuya takilir. */
const BROAD_PROMPT_INPUT_CSS = /^(div)?\s*\[contenteditable\s*=\s*['"]?true['"]?\s*\]$|^\[contenteditable\]$/i;

export async function clearBrokenSelectors(): Promise<string[]> {
  const records = await prisma.flowSelector.findMany();
  const cleared: string[] = [...(await dropProjectLevelDownloadCandidates())];

  for (const record of records) {
    const reasons: string[] = [];
    if (record.value) {
      reasons.push(...brokenSelectorReasons({ strategy: record.strategy, value: record.value, roleName: record.roleName }));
      // Eski surumlerin genis hata kalibi: tek kelime "hata/error" kalici sayfa
      // uyarilarina ("Flow hata yapabileceginden...") takilip her klibi hatali sayar
      if (record.key === "errorBanner" && /(\(|\|)(error|hata|failed)(\||\))/.test(record.value)) {
        reasons.push("asiri genis hata kalibi (kalici uyarilara takilir)");
      }
      if (record.key === "promptInput" && record.strategy === "css" && BROAD_PROMPT_INPUT_CSS.test(record.value.trim())) {
        reasons.push("asiri genis prompt CSS (gizli contenteditable'a takilir; yerlesik bulucu kullanilacak)");
      }
    }

    if (record.key === "promptInput") {
      const stored = parseCandidates(record.candidates);
      const filtered = stored.filter(
        (c) => !(c.strategy === "css" && BROAD_PROMPT_INPUT_CSS.test(c.value.trim()))
      );
      if (filtered.length !== stored.length && reasons.length === 0) {
        await prisma.flowSelector.update({
          where: { key: record.key },
          data: { candidates: JSON.stringify(filtered) },
        });
        cleared.push("promptInput (aday zincirinden genis CSS ayiklandi)");
      }
    }

    if (reasons.length > 0) {
      await prisma.flowSelector.update({
        where: { key: record.key },
        data: { value: "", roleName: "", candidates: "[]", lastTestOk: null, lastTestAt: null },
      });
      cleared.push(`${record.key} (${reasons.join(", ")})`);
    }
  }

  if (cleared.length > 0) {
    await recordEvent({
      step: "calibration",
      level: "warning",
      message: `${cleared.length} bozuk secici temizlendi; yerlesik yedekler devreye girecek. Kalibrasyon ekranindan yeniden tanitabilirsiniz: ${cleared.join(" | ")}`,
    });
  }
  return cleared;
}

/** Bir adayin yapisal olarak kullanilamaz olup olmadigini belirler. */
export function brokenSelectorReasons(candidate: { strategy: string; value: string; roleName: string }): string[] {
  const reasons: string[] = [];
  if (candidate.strategy === "css" && ["html", "body", "*", "div", ":root"].includes(candidate.value.trim())) {
    reasons.push("tum sayfayi kapsayan CSS secici");
  }
  // Erken surumler, kardes ogelerin metinlerini bosluksuz birlestirerek
  // hicbir zaman eslesmeyen adlar uretiyordu (or. roleName "arrow_forwardOlustur").
  // Yalnizca role adlarinda bakilir: text stratejisi bilerek ikon-font kaliplari
  // (arrow_forward, add_2) veya regex kullanabilir — bunlari "bozuk" sayma.
  if (candidate.strategy === "role") {
    const nameLike = candidate.roleName;
    if (nameLike && !nameLike.startsWith("(") && !nameLike.includes("|")) {
      if (nameLike.includes("_")) reasons.push("ikon fontu metniyle birlesmis ad");
      else if (nameLike.length > 12 && /[a-zçğıöşü][A-ZÇĞİÖŞÜ]/.test(nameLike)) reasons.push("bosluksuz birlesmis etiket");
      else if (/\d[a-zçğıöşü]\d/.test(nameLike)) reasons.push("birlesmis liste etiketi");
    }
  }
  if (candidate.strategy === "css" && candidate.value.includes("nth-of-type") && candidate.value.length > 60) {
    reasons.push("kirilgan konum zinciri");
  }
  // Radix/React'in her acilista yeniden urettigi otomatik kimlikler
  // (#radix-:re:, #\:r3\: gibi) bir sonraki sayfa yuklemesinde gecersiz olur.
  if (candidate.strategy === "css" && /#(radix-)?\\?:r/i.test(candidate.value)) {
    reasons.push("her acilista degisen otomatik kimlik");
  }
  return reasons;
}

export async function getSelectorConfig(key: string): Promise<FlowSelectorConfig | null> {
  const record = await prisma.flowSelector.findUnique({ where: { key } });
  if (!record) return null;
  const parsed = flowSelectorSchema.safeParse({
    key: record.key,
    strategy: record.strategy,
    value: record.value,
    roleName: record.roleName,
    description: record.description,
    required: record.required,
  });
  return parsed.success ? parsed.data : null;
}

/** Kayitli JSON aday listesini guvenli okur. */
export function parseCandidates(json: string): SelectorCandidate[] {
  try {
    const parsed = z.array(selectorCandidateSchema).safeParse(JSON.parse(json || "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function candidateSignature(candidate: SelectorCandidate): string {
  return `${candidate.strategy}|${candidate.value}|${candidate.roleName}`;
}

/** Aday listelerini sirayi koruyarak birlestirir ve tekrarlari atar. */
export function mergeCandidates(...lists: SelectorCandidate[][]): SelectorCandidate[] {
  const seen = new Set<string>();
  const merged: SelectorCandidate[] = [];
  for (const list of lists) {
    for (const candidate of list) {
      if (!candidate.value) continue;
      const signature = candidateSignature(candidate);
      if (seen.has(signature)) continue;
      seen.add(signature);
      merged.push(candidate);
    }
  }
  return merged;
}

/**
 * Bir anahtarin tam aday zincirini dondurur:
 * kayitli adaylar -> birincil kayit -> yerlesik anlamsal yedekler.
 */
export async function getCandidatesFor(key: string): Promise<SelectorCandidate[]> {
  const record = await prisma.flowSelector.findUnique({ where: { key } });
  const stored = record ? parseCandidates(record.candidates) : [];
  const primary: SelectorCandidate[] =
    record && record.value ? [{ strategy: record.strategy as SelectorStrategy, value: record.value, roleName: record.roleName }] : [];
  return mergeCandidates(stored, primary, SEMANTIC_FALLBACKS[key] ?? []);
}

/** Aday yapilandirmasindan Playwright locator uretir. */
export function buildLocator(page: Page, candidate: SelectorCandidate | FlowSelectorConfig): Locator {
  switch (candidate.strategy) {
    case "role": {
      const options = candidate.roleName ? { name: new RegExp(candidate.roleName, "i") } : undefined;
      return page.getByRole(candidate.value as Parameters<Page["getByRole"]>[0], options).first();
    }
    case "label":
      return page.getByLabel(new RegExp(candidate.value, "i")).first();
    case "placeholder":
      return page.getByPlaceholder(new RegExp(candidate.value, "i")).first();
    case "text":
      return page.getByText(new RegExp(candidate.value, "i")).first();
    case "testid":
      return page.getByTestId(candidate.value).first();
    case "css":
      return page.locator(candidate.value).first();
  }
}

export interface ResolveOptions {
  /** true: yalnizca gorunur oge kabul edilir (varsayilan). false: DOM'da olmasi yeter. */
  requireVisible?: boolean;
  /** Her aday icin bekleme suresi (ms) */
  timeoutMs?: number;
  /** Calisan adayi zincirin basina alip kaydet (kendini onarma) */
  selfHeal?: boolean;
}

export interface ResolvedSelector {
  locator: Locator;
  candidate: SelectorCandidate;
  index: number;
}

/**
 * Aday zincirini sirayla dener; calisan ilk adayi dondurur.
 * Zincirde ilerideki bir aday calistiysa onu basa alip kaydeder, boylece
 * sonraki cagrilar hizlanir ve secici kendini onarmis olur.
 */
export async function resolveSelector(page: Page, key: string, options: ResolveOptions = {}): Promise<ResolvedSelector | null> {
  const { requireVisible = true, timeoutMs = 1_000, selfHeal = true } = options;
  const candidates = await getCandidatesFor(key);

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    try {
      const locator = buildLocator(page, candidate);
      if ((await locator.count()) === 0) continue;
      if (requireVisible && !(await locator.isVisible({ timeout: timeoutMs }))) continue;

      if (index > 0 && selfHeal) {
        await promoteCandidate(key, candidate, candidates);
      }
      return { locator, candidate, index };
    } catch {
      // Bu aday kullanilamiyor (gecersiz regex, ayrilmis oge vb.) — sonrakine gec
    }
  }
  return null;
}

/** Anahtar icin dogrulanmis locator dondurur (bulunamazsa null). */
export async function locatorFor(page: Page, key: string, options?: ResolveOptions): Promise<Locator | null> {
  const resolved = await resolveSelector(page, key, options);
  return resolved?.locator ?? null;
}

/** Calisan adayi zincirin basina tasir ve kalici hale getirir. */
async function promoteCandidate(key: string, winner: SelectorCandidate, chain: SelectorCandidate[]): Promise<void> {
  const record = await prisma.flowSelector.findUnique({ where: { key } });
  if (!record) return;
  const stored = parseCandidates(record.candidates);
  if (stored.length > 0 && candidateSignature(stored[0]) === candidateSignature(winner)) return;

  const reordered = mergeCandidates([winner], stored, chain).slice(0, 8);
  await prisma.flowSelector.update({
    where: { key },
    data: {
      candidates: JSON.stringify(reordered),
      strategy: winner.strategy,
      value: winner.value,
      roleName: winner.roleName,
      lastTestOk: true,
      lastTestAt: new Date(),
    },
  });
  await recordEvent({
    step: "calibration",
    level: "warning",
    message: `Secici kendini onardi: "${key}" icin yedek aday devreye girdi (${winner.strategy}${winner.roleName ? `:${winner.roleName}` : ""}). Birincil secici artik bu.`,
  });
}

/** Kalibrasyon sonucunda dogrulanmis aday zincirini kaydeder. */
export async function saveCandidates(key: string, verified: SelectorCandidate[]): Promise<void> {
  if (verified.length === 0) return;
  const [primary] = verified;
  await prisma.flowSelector.update({
    where: { key },
    data: {
      candidates: JSON.stringify(verified.slice(0, 8)),
      strategy: primary.strategy,
      value: primary.value,
      roleName: primary.roleName,
      lastTestOk: true,
      lastTestAt: new Date(),
    },
  });
}

export interface AutoCalibrationResult {
  key: string;
  found: boolean;
  /** Bu calistirmada birincil secici olarak kaydedildi mi */
  saved: boolean;
  strategy?: SelectorStrategy;
  value?: string;
  roleName?: string;
}

/**
 * Otomatik kalibrasyon: acik sayfada her anahtari aday zinciriyle cozumler.
 * - Calisan aday bulunursa ve kayitli kalibrasyon yoksa, o aday birincil
 *   secici olarak kaydedilir (panelde "Tanitildi" gorunur).
 * - Kayitli kalibrasyon varsa kendini onarma mekanizmasi zaten calisir.
 * Sinyal ogeleri (ilerleme, hata banner'i) o an ekranda olmayabilir; bunlarin
 * bulunamamasi hata degildir.
 */
export async function autoCalibrateAll(page: Page): Promise<AutoCalibrationResult[]> {
  const records = await prisma.flowSelector.findMany({ orderBy: { key: "asc" } });
  const results: AutoCalibrationResult[] = [];

  for (const record of records) {
    const hadStored = parseCandidates(record.candidates).length > 0 || record.value.trim().length > 0;
    let resolved: ResolvedSelector | null = null;
    try {
      resolved = await resolveSelector(page, record.key, { selfHeal: true, timeoutMs: 1_200 });
    } catch {
      resolved = null;
    }

    let saved = false;
    if (resolved && !hadStored) {
      await saveCandidates(record.key, [resolved.candidate]);
      saved = true;
    }
    await prisma.flowSelector.update({
      where: { key: record.key },
      data: { lastTestOk: resolved !== null, lastTestAt: new Date() },
    });

    results.push({
      key: record.key,
      found: resolved !== null,
      saved,
      strategy: resolved?.candidate.strategy,
      value: resolved?.candidate.value,
      roleName: resolved?.candidate.roleName,
    });
  }

  const foundCount = results.filter((r) => r.found).length;
  const savedCount = results.filter((r) => r.saved).length;
  await recordEvent({
    step: "calibration",
    message: `Otomatik kalibrasyon: ${foundCount}/${results.length} oge bulundu, ${savedCount} yeni secici kaydedildi`,
  });
  return results;
}

export interface SelectorTestResult {
  key: string;
  configured: boolean;
  found: boolean;
  required: boolean;
  count: number;
  /** Eslesen adayin zincirdeki sirasi (0 = birincil, >0 = yedek devrede) */
  matchedIndex: number | null;
  /** Eslesen aday yerlesik yedek mi, kullanici kalibrasyonu mu */
  matchedSource: "kalibrasyon" | "yerlesik" | null;
  error?: string;
}

/** Tum secicileri acik sayfada test eder ve sonuclari DB'ye isler. */
export async function testAllSelectors(page: Page): Promise<SelectorTestResult[]> {
  const records = await prisma.flowSelector.findMany({ orderBy: { key: "asc" } });
  const results: SelectorTestResult[] = [];

  for (const record of records) {
    const storedCount = parseCandidates(record.candidates).length + (record.value ? 1 : 0);
    try {
      // Test sirasinda kendini onarma yapilmaz: sonuc raporu gercek durumu gostersin
      const resolved = await resolveSelector(page, record.key, { selfHeal: false, timeoutMs: 800 });
      const found = resolved !== null;
      const count = resolved ? await resolved.locator.count().catch(() => 0) : 0;
      const semanticStart = storedCount;
      results.push({
        key: record.key,
        configured: storedCount > 0,
        found,
        required: record.required,
        count,
        matchedIndex: resolved?.index ?? null,
        matchedSource: resolved === null ? null : resolved.index < semanticStart ? "kalibrasyon" : "yerlesik",
      });
      await prisma.flowSelector.update({ where: { key: record.key }, data: { lastTestOk: found, lastTestAt: new Date() } });
    } catch (err) {
      results.push({
        key: record.key,
        configured: storedCount > 0,
        found: false,
        required: record.required,
        count: 0,
        matchedIndex: null,
        matchedSource: null,
        error: err instanceof Error ? err.message : String(err),
      });
      await prisma.flowSelector.update({ where: { key: record.key }, data: { lastTestOk: false, lastTestAt: new Date() } });
    }
  }
  return results;
}

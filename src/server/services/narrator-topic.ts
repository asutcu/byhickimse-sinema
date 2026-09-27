import { z } from "zod";
import { structuredCall } from "@/server/services/openai";
import {
  narratorGenreLabel,
  narratorGenreStoryBlock,
  narratorNetShortStorySystemLock,
  resolveNarratorGenre,
  type NarratorGenre,
} from "@/lib/narrator-genres";
import { speechCastStoryLock, speechOutputLanguageLock } from "@/lib/speech-cast-locale";

export const SUGGEST_MAX_WORDS = 1800;
export const SUGGEST_DEFAULT_WPM = 120;

export const suggestNarratorTopicInputSchema = z.object({
  genreId: z.string().min(1),
  customGenre: z.string().optional().default(""),
  topic: z.string().optional().default(""),
  title: z.string().optional().default(""),
  speechLanguage: z.string().optional().default("Turkish"),
  storyLanguage: z.string().optional().default("Turkish"),
  audience: z.string().optional().default(""),
  narrationStyle: z.string().optional().default(""),
  openingHook: z.string().optional().default(""),
  avoidList: z.string().optional().default(""),
  targetDurationSeconds: z.number().int().min(20).max(3600).optional().default(180),
  targetWordCount: z.number().int().min(0).max(3000).optional().default(0),
  wpm: z.number().int().min(60).max(220).optional().default(SUGGEST_DEFAULT_WPM),
  kind: z.enum(["brief", "full", "cartoon"]).optional().default("full"),
});

export type SuggestNarratorTopicInput = z.infer<typeof suggestNarratorTopicInputSchema>;

export const suggestNarratorTopicResultSchema = z.object({
  topic: z.string().min(1),
  title: z.string().min(1),
  hook: z.string().min(1),
});

export type SuggestNarratorTopicResult = z.infer<typeof suggestNarratorTopicResultSchema>;

const RESULT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Kisa video basligi (secilen dilde, 4-10 kelime, spoiler'siz)" },
    hook: { type: "string", description: "Hikayenin ilk cumlesi / acilis kancasi" },
    topic: {
      type: "string",
      description: "Hedef sureye gore TAM birinci tekil hikaye; baslangic, gelisme ve kapanmis sonuc",
    },
  },
  required: ["title", "hook", "topic"],
};

export function resolveSuggestNarratorGenre(input: SuggestNarratorTopicInput): NarratorGenre {
  const custom = input.customGenre.replace(/\s+/g, " ").trim();
  if (input.genreId === "ozel") {
    if (!custom) throw new Error("Ozel tur icin bir ad yazin");
    return resolveNarratorGenre(custom);
  }
  return resolveNarratorGenre(narratorGenreLabel(input.genreId, custom));
}

/** Hedef sure + konusma hizindan kelime butcesi. */
export function suggestTargetWordCount(
  input: Pick<SuggestNarratorTopicInput, "targetDurationSeconds" | "targetWordCount" | "wpm" | "kind">
): number {
  if (input.kind === "cartoon") return 180;
  if (input.kind === "brief") {
    return Math.max(80, Math.min(180, input.targetWordCount && input.targetWordCount > 0 ? input.targetWordCount : 140));
  }
  if (input.targetWordCount && input.targetWordCount > 0) {
    return Math.max(80, Math.min(SUGGEST_MAX_WORDS, input.targetWordCount));
  }
  const wpm = input.wpm && input.wpm > 0 ? input.wpm : SUGGEST_DEFAULT_WPM;
  const seconds = Math.max(20, input.targetDurationSeconds || 180);
  return Math.max(80, Math.min(SUGGEST_MAX_WORDS, Math.round((seconds / 60) * wpm)));
}

export function suggestOutputBudget(words: number): number {
  return Math.min(16_000, Math.max(4_000, Math.round(words * 8) + 2_500));
}

const SYSTEM_RULES = `
Sen NetShort tarzı KISA dikey dram icin TAM HIKAYE yazarsin. topic = anlatıcının okuyacagi bitmis metin — ozet/teaser YASAK.

SURE VE SONUC:
- Hedef kelimeye +-%10 uy. Yapi: ihanet/asagilanma → sakin yikici karar → dusus/zaman atlamasi → guclu donus → pismanlik.
- Son %15-%20 kapansin (sonuca bagla). Ortada cliffhanger serbest; YARIDA BIRAKMA YASAK — final "devam edecek" olmasin.

DIGER:
- Ture sadik kal. Yatak/soyunuk/18 yas alti YASAK.
- Tur kilidindeki CORPUS trop bankasindan 1 ANA + 1 YARDIMCI sec; baslik/isim CALMA.
- NETSHORT: sakin yikici cumleler ("bosanmak istiyorum", "bu bebek senin degil") bagirma yagmurundan gucludur.
- Pişkin ihanet eden + donuste soguk zafer. Status cevirisi, flashback tezatı, ucuncu kisi (sekreter/aile) kullan.
- Birinci tekil, dogal konusma, somut kanit (mesaj, otel, ofis, imza).
- hook = topic'in ilk cumlesi. title kisa, spoiler'siz.
- Sahne notu / madde isareti YOK.
`.trim();

/** Test ve cagri icin ayni prompt. */
const KIDS_TOPIC_SYSTEM = `
Sen cocuklar icin cizgi film konusu yazarsin. Gorunum kullanicinin sectigi gibi: 3D Pixar veya 2D anime. Canli cekim ve yetiskin dram YASAK.
topic = kisa ama kapali bir film omurgasi: ozgun karakterler, dunya, her birinin kilitli kostum renkleri, olay, cozum.
Birinci tekil itiraf, ihanet, asagilanma, unlu kisi, siddet, kan, silah YOK.
2-4 tek kelimelik uydurma isim. Konu kullanicinin fikrine uyar; hazir bir filme kopyalama.
hook = ilk cumle. title kisa. Sonu cozumle kapanir.
`.trim();

export function buildNarratorTopicSuggestPrompts(input: SuggestNarratorTopicInput): {
  system: string;
  user: string;
  genre: NarratorGenre;
  targetWords: number;
} {
  if (input.kind === "cartoon") {
    const targetWords = suggestTargetWordCount(input);
    const language = input.speechLanguage || input.storyLanguage || "Turkish";
    const minutes = Math.max(1, Math.round((input.targetDurationSeconds || 300) / 60));
    const anime = /anime|2d/i.test(`${input.narrationStyle} ${input.customGenre}`);
    const system = `${KIDS_TOPIC_SYSTEM}\n\n${speechOutputLanguageLock(language)}`;
    const user = [
      `Konusma dili: ${language}`,
      speechOutputLanguageLock(language),
      `Gorunum: ${anime ? "2D anime" : "3D Pixar / DreamWorks"}.`,
      input.audience.trim() ? `Yas araligi: ${input.audience.trim()}. Dil bu yasa gore.` : "",
      input.openingHook.trim() ? `Ders, vaaz etmeden olayin icine girsin: ${input.openingHook.trim()}` : "",
      `Hedef sure: yaklasik ${minutes} dakika`,
      `topic yaklasik ${targetWords} kelime olsun: karakterler, mekan, kostum renkleri, baslangic, engel, cozum.`,
      input.topic.trim()
        ? `Onceki konu (BUNU TEKRARLAMA): ${input.topic.trim().slice(0, 800)}`
        : "Mevcut konu yok — sifirdan ozgun bir cizgi film yaz.",
    ]
      .filter(Boolean)
      .join("\n");
    return { system, user, genre: resolveNarratorGenre("macera"), targetWords };
  }
  const genre = resolveSuggestNarratorGenre(input);
  const lock = narratorGenreStoryBlock(genre.label) || narratorGenreStoryBlock(input.customGenre);
  const targetWords = suggestTargetWordCount(input);
  const minutes = Math.max(1, Math.round((input.targetDurationSeconds || 180) / 60));
  const brief = input.kind === "brief";
  const baseSystem = brief
    ? SYSTEM_RULES.replace("TAM HIKAYE yazarsin. topic alani, anlatıcının agzından okunacak bitmis metindir — kisa ozet / teaser / \"konu fikri\" YASAK.", "KISA ama KAPALI bir hikaye omurgasi yaz. Tam 30 dk transkript YASAK — 4-8 cumle, baslangic-gelisme-SONUC.")
    : SYSTEM_RULES;
  const language = input.speechLanguage || input.storyLanguage;
  const system = `${baseSystem}\n\n${narratorNetShortStorySystemLock(genre.label)}\n\n${speechCastStoryLock(language)}\n\n${speechOutputLanguageLock(language)}`;
  const lines = [
    `Hikaye turu: ${genre.label} (id: ${genre.id})`,
    genre.id === "ozel"
      ? `ZORUNLU OZEL TUR: Hikaye kullanicinin yazdigi "${genre.label}" kelimesine gore gelsin. Bu kelime baslikta, cakismada ve sonda hissedilsin. Katalog turune kayma.`
      : "",
    genre.tagline ? `Tur ozeti: ${genre.tagline}` : "",
    lock,
    `Konusma / hikaye dili: ${language || "Turkish"}`,
    speechCastStoryLock(language),
    speechOutputLanguageLock(language),
    `Hedef sure: ${input.targetDurationSeconds} saniye (~${minutes} dakika)`,
    brief
      ? `Mod: KISA BRIEF. Hedef ~${targetWords} kelime. Tam film metni DEGIL; sonuca bagli omurga. Uzun slayt senaryosu stüdyoda yazilir.`
      : `Hedef kelime sayisi: ${targetWords} kelime (+-%10). topic bu uzunlukta TAM hikaye olsun.`,
    `ZORUNLU YAPI: baslangic + gelisme + SONUC. Metin yarıda kalmasin; son cumleler cakismayi kapatsin.`,
  ];
  if (input.audience.trim()) lines.push(`Hedef kitle: ${input.audience.trim()}`);
  if (input.narrationStyle.trim()) lines.push(`Anlatim tarzi: ${input.narrationStyle.trim()}`);
  if (input.openingHook.trim()) {
    lines.push(`Kullanicinin kanca fikri (istersen kullan, kopyalama): ${input.openingHook.trim()}`);
  }
  if (input.avoidList.trim()) lines.push(`ISTENMEYEN: ${input.avoidList.trim()}`);
  if (input.title.trim()) lines.push(`Mevcut baslik (tekrarlama, yeni yaz): ${input.title.trim()}`);
  if (input.topic.trim()) {
    lines.push(`Onceki / mevcut metin (BUNU TEKRARLAMA, tamamen farkli olay yaz): ${input.topic.trim().slice(0, 1200)}`);
  } else {
    lines.push("Mevcut metin yok — sifirdan yaz.");
  }
  lines.push(
    brief
      ? `Simdi ~${targetWords} kelimelik, ${genre.label} turunde, sonuca bagli KISA omurga + baslik + kanca uret.`
      : `Simdi ${targetWords} kelimelik, ${genre.label} turunde, sonuca baglanmis TAM bir hikaye + baslik + kanca uret.`
  );
  return { system, user: lines.filter(Boolean).join("\n"), genre, targetWords };
}

export async function suggestNarratorTopic(raw: unknown): Promise<SuggestNarratorTopicResult> {
  const input = suggestNarratorTopicInputSchema.parse(raw);
  const { system, user, targetWords } = buildNarratorTopicSuggestPrompts(input);
  return structuredCall<SuggestNarratorTopicResult>({
    system,
    user,
    schemaName: "narrator_topic_suggestion",
    jsonSchema: RESULT_JSON_SCHEMA,
    zodSchema: suggestNarratorTopicResultSchema,
    reasoningEffort: "low",
    maxOutputTokens: suggestOutputBudget(targetWords),
    timeoutMs: input.kind === "brief" || input.kind === "cartoon" ? 60_000 : Math.min(180_000, 60_000 + targetWords * 50),
  });
}

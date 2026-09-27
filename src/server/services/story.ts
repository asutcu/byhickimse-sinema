import { z } from "zod";
import type { AppSettings, Project, Story } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/server/db";
import { structuredCall } from "@/server/services/openai";
import { wpmForPace } from "@/server/services/settings";
import { ensureProjectDirs } from "@/server/lib/paths";
import { recordEvent } from "@/server/lib/logger";
import { uniqueLookForIndex } from "@/server/services/cast";
import { flowHandleFromName } from "@/server/services/character";
import { isLikelyPersonName, stripTurkishPossessive } from "@/lib/longform-netshort-stills";
import { CURIOSITY_CORE_RULES, curiosityRulesFor, curiosityRulesForNarrator } from "@/server/services/curiosity";
import { narratorGenreStoryBlock, narratorNetShortStorySystemLock } from "@/lib/narrator-genres";
import { appendFlowLocaleCast, localeNationalityLook, speechCastStoryLock, speechOutputLanguageLock } from "@/lib/speech-cast-locale";

/**
 * Hikaye uretimi ve duzenleme servisi.
 * Cikti daima yapilandirilmis JSON'dur ve Merak Mimarisi kurallari
 * sistem talimatina gomulur.
 */

const namedPersonSchema = z.object({
  name: z.string().min(2),
  storyRole: z.string().min(2),
  gender: z.enum(["male", "female"]),
  /** Ingilizce gorsel tarif. Cizgi filmde tur + renkler; sinemada kisa yuz. */
  look: z.string().default(""),
  /** Ingilizce kiyafet. Cizgi filmde film boyunca kilitli kostum. */
  costume: z.string().default(""),
});

export const storyPayloadSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  hook: z.string(),
  fullStory: z.string().min(1),
  estimatedWords: z.number().int().nonnegative(),
  estimatedDurationSeconds: z.number().int().nonnegative(),
  language: z.string(),
  contentWarnings: z.array(z.string()),
  characterVoiceNotes: z.string(),
  /** Hikayedeki isimli yuzler (anlatici "ben" haric) — klip atamasi icin. */
  namedPeople: z.array(namedPersonSchema).default([]),
});

export type StoryPayload = z.infer<typeof storyPayloadSchema>;

export const STORY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Videonun basligi (secilen hikaye dilinde)" },
    summary: { type: "string", description: "2-3 cumlelik ozet" },
    hook: { type: "string", description: "Acilis kancasi cumlesi (hikayenin ilk cumleleriyle ayni)" },
    fullStory: { type: "string", description: "Yalnizca konusulacak metin" },
    estimatedWords: { type: "integer" },
    estimatedDurationSeconds: { type: "integer" },
    language: { type: "string" },
    contentWarnings: { type: "array", items: { type: "string" } },
    characterVoiceNotes: { type: "string", description: "Anlatim tonu ve ses notlari" },
    namedPeople: {
      type: "array",
      description: "Hikayedeki isimli kisiler (anlatici ben haric). fullStory'deki ozel isimlerle birebir ayni.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Ozel isim, or. Emre" },
          storyRole: { type: "string", description: "or. koca, sekreter, kayinvalide" },
          gender: { type: "string", enum: ["male", "female"] },
          look: {
            type: "string",
            description: "English visual look. Cartoons: species and colors. Live-action: a short face line.",
          },
          costume: {
            type: "string",
            description: "English costume. Cartoons: one locked outfit with colors for the whole film.",
          },
        },
        required: ["name", "storyRole", "gender", "look", "costume"],
      },
    },
  },
  required: [
    "title",
    "summary",
    "hook",
    "fullStory",
    "estimatedWords",
    "estimatedDurationSeconds",
    "language",
    "contentWarnings",
    "characterVoiceNotes",
    "namedPeople",
  ],
};

/** Hedef sure + konusma hizina gore yaklasik kelime sayisi. */
export function computeTargetWords(targetDurationSeconds: number, wpm: number): number {
  if (targetDurationSeconds <= 0 || wpm <= 0) return 0;
  return Math.round((targetDurationSeconds / 60) * wpm);
}

/** Kelime sayisindan tahmini konusma suresi (saniye). */
export function estimateSpeechSeconds(wordCount: number, wpm: number): number {
  if (wordCount <= 0 || wpm <= 0) return 0;
  return Math.round((wordCount / wpm) * 60);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Merak Mimarisi kurallari artik tek merkezde (curiosity.ts) tutulur. */
export const CURIOSITY_ARCHITECTURE_RULES = CURIOSITY_CORE_RULES;

const NARRATOR_SYSTEM_RULES = `
Sen, NetShort tarzı KISA DIKEY DRAM icin anlatici-senaristsin.
DNA: ENTRIKA — ihanet, aldatma, gizem, aile sirri, ikinci hayat, hesap sorma, status donusu.
Ornek omurga: asagilanma/ihanet → sakin yikici karar → zaman atlamasi → guclu donus → pismanlik.
Metin TEK kadinin agzindan, BIRINCI TEKIL, akici itiraf olarak okunur.

ZORUNLU KURALLAR:
- Hikaye BIRINCI TEKIL. "Isim:" coklu konusmaci YASAK.
- Dogal konusma; sahne betimlemesi / yonetmen notu / parantez YASAK. fullStory yalnizca agizdan cikacak metin.
- ENTRIKA ZORUNLU (tur ne olursa olsun): duz gunluk hayat / yavas duygu guncesi YASAK. En az 2 "nasil yani?" / bilgi cevirisi.
- NETSHORT OMURGA: asagilanma/ihanet/gizli darbe → SAKIN ama YIKICI karar veya soz → dusus → zaman atlamasi veya gizli guclenme → status/gorsel donus → karsi tarafin pismanligi.
- CORPUS: tur kilidindeki trop bankasindan 1 ANA + 1 YARDIMCI sec; ayni iki tropu her filmde tekrarlama. Baslik/isim CALMA, ruhu yaz.
- SAKIN YIKICILIK: En guclu anlar bagiris olmak zorunda degil. Ornek ruh: "Bosanmak istiyorum." / "Bu bebek senin degil." / "Bir daha arama."
- PISKIN ihanet eden / sakli taraf erken gelsin; ama hikaye SADECE bagirma/kufur yagmuru olmasin — duygusal darbe + donus asil silah.
- GOZ DETAYI konusmanin icinde: ofis, luks araba, magaza cikis, dugun flashback, luks vs bosluk, yeni askin kolu — her 1-2 cumlede izlenebilir bir kare olsun.
- ETKI→TEPKI: bir cumlede eylem (kagit, gulus, tercih, tokat/itme), hemen sonraki cumlede karsi yuzun anlik tepkisi. Kalabalik 'herkes' sahnesi YASAK — o anda kim varsa adıyla yaz.
- GUÇ: ezme + ustunluk + kontrollu siddet (tokat, omuz itmesi, kapi carpma, nesne firlatma) EN AZ 1-2 kez; kamusal asagılama; donuste status intikami. Kan/silah/oldurme YASAK.
- Her paragraf TEK NetShort darbe tasisin (tercih / sakin karar / zaman atlami / donus / pismanlik / yeni kanit / ezme). Soyut duygu ozeti YASAK.
- TEMPO: acilis sonrasi 2-4. paragraflar HIZLI kalsin — uzun ic monolog / "oturup dusundum" / tekrar sikayet YASAK. Kisa darbeli cumleler. Izleyici uykuya dusmesin.
- Yatak/porno tarif YOK. 18 yas alti YOK. Ergen/okul romantizmi YOK.
- Guclu acilis kancasi; hook = hikayenin ilk cumleleri.
- Son %15-%20: pismanlik + karar / soguk zafer. Cliffhanger final YASAK; ortada cliffhanger SERBEST.
- Kelime hedefine +-%10 uy. Klip bolunmeye uygun dogal cumleler.
- characterVoiceNotes: or. "sakin ama yikici, donuste soguk zafer, flashbackte kirik ses".
- ISIMLI KADRO ZORUNLU: 3-5 tekrar eden OZEL ISIM — konusma diline uygun uydurma yetiskin adlar. "kocam / o / annem" YETMEZ. Ilk geciste rol+isim, sonra hep o isim.
- UNLU ADI YASAK: gercek oyuncu, sarkici, fenomen, siyasetci, sporcu ismi kullanma (Flow reddeder).
- namedPeople: hikayedeki TUM isimli yuzler (anlatici "ben" HARIC). Adlar fullStory ile BIREBIR ayni olsun.
- namedPeople.look: kisa Ingilizce yuz tarifi. namedPeople.costume: kisa Ingilizce kiyafet. Canli cekim yetiskin.
- Her klip diliminde (her 2-4 cumle) o karede kim varsa ADI gecsin — 1 kisiyse 1, 2 ise 2, 3 ise 3. Zamirle isim silme; kliplere bolununce ad kaybolmasin.
`.trim();

const KIDS_ANIMATION_SYSTEM = `
Sen cocuklar icin cizgi film yazan senaristsin. Gorunum ya 3D (Pixar / DreamWorks) ya da 2D anime — kullanicinin sectigi gorunume uy. Canli cekim, gercek insan, unlu kisi YOK.

ZORUNLU:
- Kahramanlar OZGUN 3D karakterdir: hayvan, masal yaratigi veya stilize cocuk. 2 ile 4 kisi. Isim TEK KELIME, bosluksuz, uydurma (Kirpik, Tona). Gercek unlu, siyasetci, tarihi kisi YASAK.
- Her karakterin SABIT gorunumu ve SABIT kiyafeti vardir. Film boyunca tur, renk ve kostum degismez.
- Konu kullanicinin verdigi fikirdir. Baska bir filme, Everest'e veya hazir bir markaya zorlama.
- fullStory yalnizca konusulacak cumlelerdir. Sade dil. Her 2-3 cumlede sahnedeki karakterlerin ADI gecsin.
- Konusma soyle yazilsin: Isim: "cumle"
- Siddet, kan, silah, korku, olum YOK. Kisa bir engel olur, takim cozer. Son cozumle kapanir.
- namedPeople: sahnede gorunen HER karakter. look = Ingilizce gorsel tarif (tur, renkler, yuz, boy). costume = Ingilizce kilitli kiyafet ve aksesuar, renkleriyle. gender yalnizca ses icin male veya female.
- Kelime hedefine yaklas.
`.trim();

/** Sinema anlatici dram turlerinde iliski dramasi surukleyicilik kurallari eklenir. */
function storyCuriosityRules(project: Project): string {
  return project.templateType === "narrator"
    ? curiosityRulesForNarrator(project.genre)
    : curiosityRulesFor(project.templateType);
}

function storySystemPrompt(project: Project): string {
  if (project.templateType === "kids_animation") {
    return [
      KIDS_ANIMATION_SYSTEM,
      speechOutputLanguageLock(project.speechLanguage),
      "Merak: her sahne kucuk bir engel veya soru acar, sonraki sahne ilerletir. Son %15 cozum ve sevincli kapanis. Cliffhanger final yok. Ihanet, asagilanma, yetiskin dram YASAK.",
    ].join("\n\n");
  }
  if (project.templateType !== "narrator") {
    return `${NARRATOR_SYSTEM_RULES}\n\n${speechCastStoryLock(project.speechLanguage)}\n\n${speechOutputLanguageLock(project.speechLanguage)}\n\n${storyCuriosityRules(project)}`;
  }
  return `${NARRATOR_SYSTEM_RULES}\n\n${narratorNetShortStorySystemLock(project.genre)}\n\n${speechCastStoryLock(project.speechLanguage)}\n\n${speechOutputLanguageLock(project.speechLanguage)}\n\n${storyCuriosityRules(project)}`;
}

function buildStoryUserPrompt(project: Project, targetWords: number): string {
  const lines = [
    `Video basligi onerisi/konusu: ${project.title || project.name}`,
    `Hikaye konusu: ${project.topic}`,
    `Hikaye turu: ${project.genre}`,
    project.templateType === "narrator" ? narratorGenreStoryBlock(project.genre) : "",
    `Hikaye dili: ${project.storyLanguage}`,
    `Konusma dili (fullStory bu dilde olsun): ${project.speechLanguage}`,
    speechOutputLanguageLock(project.speechLanguage),
    `Hedef sure: ${project.targetDurationSeconds} saniye`,
    project.templateType === "narrator"
      ? `Klip suresi: ${project.clipSeconds} sn. Her klip dilimi konusmayla dolsun — ama TEMPO NetShort: 2-4 cumle VEYA kisa darbeli ritm (uzun-uzun-KISA). Tek kelimelik bos klip YASAK; uzun duygu ozeti de YASAK. Acilis sonrasi 2-4. dilimler HIZLI darbe tasisin.`
      : project.templateType === "kids_animation"
        ? [
            `Klip suresi: ${project.clipSeconds} sn. Her klip 1-2 kisa konusma cumlesi; karakter hareket eder ve konusur. Bos klip YASAK.`,
            project.visualStyle === "anime"
              ? "GORUNUM: 2D anime. 3D Pixar veya canli cekim YAZMA."
              : "GORUNUM: 3D Pixar / DreamWorks. Canli cekim veya 2D anime YAZMA.",
            project.ageBand.trim()
              ? `YAS ARALIGI: ${project.ageBand}. Cumleler bu yasa gore. 1-3 cok kisa ve sade; 6-8 biraz daha macera kurabilir. Korku ve siddet yok.`
              : "",
            project.moralLesson.trim()
              ? `DERS: ${project.moralLesson.trim()}. Vaaz etme; ders olayin icinde dogal cozulsun.`
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        : "",
    `Hedef kelime sayisi: yaklasik ${targetWords} kelime (+-%10)`,
    "SON: fullStory MUTLAKA sonuca baglansin. Ana cakisma kapanmadan bitirme. Cliffhanger / kesik final YASAK.",
    project.templateType === "narrator"
      ? `ISIMLER: fullStory'de kisileri ozel isimle yaz. namedPeople listesini doldur (3-5 kisi). ${speechCastStoryLock(project.speechLanguage)}`
      : project.templateType === "kids_animation"
        ? "ISIMLER: 2-4 ozgun karakter. namedPeople.look ve namedPeople.costume dolu olsun. Kostum renkleri film boyunca ayni."
        : "",
  ];
  if (project.audience) lines.push(`Hedef kitle: ${project.audience}`);
  if (project.narrationStyle) lines.push(`Anlatim tarzi: ${project.narrationStyle}`);
  if (project.openingHook) lines.push(`Kullanicinin istedigi acilis kancasi fikri: ${project.openingHook}`);
  if (project.avoidList) lines.push(`ISTENMEYEN unsurlar (hikayede KESINLIKLE olmasin): ${project.avoidList}`);
  return lines.filter(Boolean).join("\n");
}

/** Yeni hikaye uretir ve veritabanina kaydeder. */
export async function generateStory(projectId: string): Promise<Story> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.templateType === "longform") {
    const { generateLongformStory } = await import("@/server/services/longform");
    return generateLongformStory(projectId);
  }
  if (project.templateType === "time_travel") {
    const { generateTimeTravelStory } = await import("@/server/services/time-travel");
    return generateTimeTravelStory(projectId);
  }
  const settings = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  const wpm = wpmForPace(settings, project.speechPace);
  const targetWords = project.targetWordCount > 0 ? project.targetWordCount : computeTargetWords(project.targetDurationSeconds, wpm);

  await recordEvent({ projectId, step: "story", message: "Hikaye uretimi baslatildi", detail: { targetWords } });

  const payload = await structuredCall<StoryPayload>({
    system: storySystemPrompt(project),
    user: buildStoryUserPrompt(project, targetWords),
    schemaName: "story_output",
    jsonSchema: STORY_JSON_SCHEMA,
    zodSchema: storyPayloadSchema,
  });

  const story = await saveStory(project, payload, wpm);
  await recordEvent({
    projectId,
    step: "story",
    message: `Hikaye uretildi: "${payload.title}" (${story.estimatedWords} kelime, ~${story.estimatedDurationSeconds} sn)`,
  });
  return story;
}

export type RefineAction =
  | "regenerate"
  | "scarier"
  | "more_mysterious"
  | "shorten"
  | "lengthen"
  | "stronger_opening"
  | "change_ending";

const REFINE_INSTRUCTIONS: Record<RefineAction, string> = {
  regenerate: "Ayni brief ile tamamen yeni ve farkli bir hikaye yaz. Onceki hikayenin olay orgusunu tekrarlama.",
  scarier:
    "Mevcut hikayeyi daha korkutucu yap: tekinsiz detaylari guclendir, tehdit hissini artir, ama olay orgusunu ve karakteri koru. Ucuz jump-scare kaliplari yerine psikolojik gerilim kullan.",
  more_mysterious:
    "Mevcut hikayeyi daha gizemli yap: aciklamalari azalt, cevapsiz sorulari artir, ipuclarini incelt ve entrikayi derinlestir. Olay orgusunu ve karakteri koru.",
  shorten: "Mevcut hikayeyi yaklasik %30 kisalt: tekrarlari ve zayif bolumleri cikar, kanca ve twist noktalarini koru.",
  lengthen:
    "Mevcut hikayeyi yaklasik %30 uzat: yeni detay, gerilim ani ve bir ara twist ekle. Su anda var olan kanca yapisini bozma, tekrar uretme.",
  stronger_opening:
    "Hikayenin acilisini cok daha guclu bir kancayla yeniden yaz. Ilk 3 cumle izleyiciyi kitlemeli. Geri kalan hikayeyi acilisla tutarli olacak sekilde minimal duzeyde uyarlayabilirsin.",
  change_ending:
    "Hikayenin sonunu tamamen farkli, beklenmedik ama mantikli bir sonla degistir. Onceden ekilmis ipuclariyla desteklenen yeni bir twist kullan. Hikayenin geri kalanini koru, yalnizca gereken kucuk uyumlari yap.",
};

/** Mevcut hikaye uzerinde duzenleme eylemi calistirir. */
export async function refineStory(projectId: string, action: RefineAction): Promise<Story> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const settings = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  const existing = await prisma.story.findUnique({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
  });
  if (!existing && action !== "regenerate") throw new Error("Duzenlenecek hikaye bulunamadi. Once hikaye olusturun.");
  if (action === "regenerate" || !existing) return generateStory(projectId);
  if (project.templateType === "time_travel") {
    const { generateTimeTravelStory } = await import("@/server/services/time-travel");
    return generateTimeTravelStory(projectId, { instruction: REFINE_INSTRUCTIONS[action] });
  }

  const wpm = wpmForPace(settings, project.speechPace);
  const targetWords = project.targetWordCount > 0 ? project.targetWordCount : computeTargetWords(project.targetDurationSeconds, wpm);

  await recordEvent({ projectId, step: "story", message: `Hikaye duzenleme: ${action}` });

  const payload = await structuredCall<StoryPayload>({
    system: `${storySystemPrompt(project)}\n\nGOREV: ${REFINE_INSTRUCTIONS[action]}${
      project.templateType === "kids_animation"
        ? " Cocuk filmi kal: siddet, kan, silah, korku ve unlu kisi yok. 3D karakterler ile kilitli kostum ayni kalsin."
        : ""
    }`,
    user: `${buildStoryUserPrompt(project, targetWords)}\n\nMEVCUT HIKAYE:\nBaslik: ${existing.title}\n\n${existing.fullStory}`,
    schemaName: "story_output",
    jsonSchema: STORY_JSON_SCHEMA,
    zodSchema: storyPayloadSchema,
  });

  const story = await saveStory(project, payload, wpm);
  await recordEvent({ projectId, step: "story", message: `Hikaye guncellendi (${action}): ${story.estimatedWords} kelime` });
  return story;
}

/** Kullanicinin panelde duzenledigi metni kaydeder. */
export async function saveEditedStory(projectId: string, input: { title?: string; fullStory: string }): Promise<Story> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const settings = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  const wpm = wpmForPace(settings, project.speechPace);
  const words = countWords(input.fullStory);
  const story = await prisma.story.upsert({
    where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
    create: {
      projectId,
      languageVariant: "primary",
      title: input.title ?? project.title ?? project.name,
      fullStory: input.fullStory,
      estimatedWords: words,
      estimatedDurationSeconds: estimateSpeechSeconds(words, wpm),
      language: project.speechLanguage,
    },
    update: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      fullStory: input.fullStory,
      estimatedWords: words,
      estimatedDurationSeconds: estimateSpeechSeconds(words, wpm),
    },
  });
  await persistStoryFiles(project, story);
  await prisma.project.update({ where: { id: projectId }, data: { status: "story_ready", title: story.title } });
  try {
    const { invalidateNarratorWorldCache } = await import("@/server/services/narrator-film");
    invalidateNarratorWorldCache(project.slug);
  } catch {
    /* anlatici degilse / dosya yok */
  }
  return story;
}

export async function saveStory(project: Project, payload: StoryPayload, wpm: number): Promise<Story> {
  const words = countWords(payload.fullStory);
  const story = await prisma.story.upsert({
    where: { projectId_languageVariant: { projectId: project.id, languageVariant: "primary" } },
    create: {
      projectId: project.id,
      languageVariant: "primary",
      title: payload.title,
      summary: payload.summary,
      hook: payload.hook,
      fullStory: payload.fullStory,
      estimatedWords: words,
      estimatedDurationSeconds: estimateSpeechSeconds(words, wpm),
      language: payload.language || project.speechLanguage,
      contentWarnings: JSON.stringify(payload.contentWarnings),
      characterVoiceNotes: payload.characterVoiceNotes,
    },
    update: {
      title: payload.title,
      summary: payload.summary,
      hook: payload.hook,
      fullStory: payload.fullStory,
      estimatedWords: words,
      estimatedDurationSeconds: estimateSpeechSeconds(words, wpm),
      language: payload.language || project.speechLanguage,
      contentWarnings: JSON.stringify(payload.contentWarnings),
      characterVoiceNotes: payload.characterVoiceNotes,
    },
  });
  await persistStoryFiles(project, story);
  await prisma.project.update({ where: { id: project.id }, data: { status: "story_ready", title: story.title } });
  if (project.templateType === "narrator" || project.templateType === "longform") {
    try {
      const { invalidateNarratorWorldCache } = await import("@/server/services/narrator-film");
      invalidateNarratorWorldCache(project.slug);
    } catch {
      /* ignore */
    }
  }
  if (
    project.templateType === "narrator" ||
    project.templateType === "longform" ||
    project.templateType === "kids_animation"
  ) {
    const kids = project.templateType === "kids_animation";
    await seedNamedPeopleAsCast(project.id, payload.namedPeople ?? [], kids ? 4 : 10, { kids });
  }
  return story;
}

/** Hikayedeki ozel isimleri kadro kaydina cevirir — kliplere bolununce eslesme hazir olsun. */
export async function seedNamedPeopleAsCast(
  projectId: string,
  people: Array<{ name: string; storyRole: string; gender: "male" | "female"; look?: string; costume?: string }>,
  maxCast = 10,
  options?: { kids?: boolean }
): Promise<void> {
  const seen = new Set<string>();
  const unique = people.filter((p) => {
    const name = stripTurkishPossessive(p.name.replace(/\s+/g, " ").trim());
    const key = name.toLowerCase();
    if (!isLikelyPersonName(name) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.max(1, Math.min(12, maxCast)));
  if (unique.length === 0) return;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { speechLanguage: true, visualStyle: true },
  });
  const speechLanguage = project?.speechLanguage;
  const nationalityLook = localeNationalityLook(speechLanguage);
  const existing = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  const firstName = (value: string) => value.trim().split(/\s+/)[0]?.toLowerCase() || "";
  let lookIndex = existing.length;
  const kids = options?.kids === true;
  const kidsDesign = (person: { storyRole: string; look?: string; costume?: string }) => {
    const look = (person.look || "").replace(/\s+/g, " ").trim();
    const costume = (person.costume || "").replace(/\s+/g, " ").trim();
    return {
      appearance: `${project?.visualStyle === "anime" ? "2D anime" : "3D animated"} original character. ${look || `${person.storyRole.trim() || "hero"}, consistent colors for the whole film.`}`,
      wardrobe: costume || "One locked costume with the same colors in every shot.",
    };
  };

  for (const person of unique) {
    const name = stripTurkishPossessive(person.name.replace(/\s+/g, " ").trim());
    if (kids) {
      const designed = kidsDesign(person);
      const match =
        existing.find((c) => stripTurkishPossessive(c.name).trim().toLowerCase() === name.toLowerCase()) ||
        existing.find((c) => firstName(c.name) && firstName(c.name) === firstName(name));
      const changed =
        !match ||
        match.baseAppearancePrompt !== designed.appearance ||
        match.baseWardrobePrompt !== designed.wardrobe;
      const data = {
        name,
        storyRole: person.storyRole.trim() || match?.storyRole || "",
        gender: person.gender,
        age: 8,
        adult: false,
        nationalityLook: "",
        hair: "as described",
        faceFeatures: "",
        wardrobe: designed.wardrobe,
        baseAppearancePrompt: designed.appearance,
        baseWardrobePrompt: designed.wardrobe,
        imagePrompt: designed.appearance,
        flowCharacterReference: match?.flowCharacterReference?.trim() || flowHandleFromName(name),
        ...(changed ? { referenceImagePath: null, imageApproved: false } : {}),
      };
      if (match) {
        await prisma.characterProfile.update({ where: { id: match.id }, data });
      } else {
        const created = await prisma.characterProfile.create({
          data: { projectId, role: "side", ...data },
        });
        existing.push(created);
      }
      continue;
    }
    const match =
      existing.find((c) => stripTurkishPossessive(c.name).trim().toLowerCase() === name.toLowerCase()) ||
      existing.find((c) => firstName(c.name) && firstName(c.name) === firstName(name));
    if (match) {
      const genderChanged = match.gender !== person.gender;
      if (genderChanged && match.referenceImagePath && fs.existsSync(match.referenceImagePath)) {
        fs.rmSync(match.referenceImagePath, { force: true });
      }
      const look = genderChanged ? uniqueLookForIndex(lookIndex, person.gender, 0) : null;
      const appearance = look
        ? appendFlowLocaleCast(look.appearance, speechLanguage, person.gender, name)
        : null;
      await prisma.characterProfile.update({
        where: { id: match.id },
        data: {
          name,
          storyRole: person.storyRole.trim() || match.storyRole,
          gender: person.gender,
          flowCharacterReference: match.flowCharacterReference?.trim() || flowHandleFromName(name),
          ...(nationalityLook ? { nationalityLook } : {}),
          ...(look && appearance
            ? {
                age: look.age,
                hair: look.hair,
                faceFeatures: look.faceFeatures,
                wardrobe: look.wardrobe,
                baseAppearancePrompt: appearance,
                baseWardrobePrompt: look.wardrobe,
                imagePrompt: appearance,
                referenceImagePath: null,
                imageApproved: false,
                flowCharacterReference: flowHandleFromName(name),
              }
            : {}),
        },
      });
      if (look) lookIndex += 1;
      continue;
    }
    const look = uniqueLookForIndex(lookIndex, person.gender, 0);
    lookIndex += 1;
    const appearance = appendFlowLocaleCast(look.appearance, speechLanguage, person.gender, name);
    const created = await prisma.characterProfile.create({
      data: {
        projectId,
        role: "side",
        name,
        storyRole: person.storyRole.trim(),
        gender: person.gender,
        age: look.age,
        adult: true,
        nationalityLook,
        hair: look.hair,
        faceFeatures: look.faceFeatures,
        wardrobe: look.wardrobe,
        baseAppearancePrompt: appearance,
        baseWardrobePrompt: look.wardrobe,
        imagePrompt: appearance,
        flowCharacterReference: flowHandleFromName(name),
      },
    });
    existing.push(created);
  }
}

/** Hikayeyi proje klasorune story.txt ve story.json olarak yazar. */
async function persistStoryFiles(project: Project, story: Story): Promise<void> {
  const root = ensureProjectDirs(project.slug);
  const storyDir = path.join(root, "story");
  fs.writeFileSync(path.join(storyDir, "story.txt"), story.fullStory, "utf8");
  fs.writeFileSync(
    path.join(storyDir, "story.json"),
    JSON.stringify(
      {
        title: story.title,
        summary: story.summary,
        hook: story.hook,
        fullStory: story.fullStory,
        estimatedWords: story.estimatedWords,
        estimatedDurationSeconds: story.estimatedDurationSeconds,
        language: story.language,
        contentWarnings: JSON.parse(story.contentWarnings || "[]"),
        characterVoiceNotes: story.characterVoiceNotes,
      },
      null,
      2
    ),
    "utf8"
  );
}

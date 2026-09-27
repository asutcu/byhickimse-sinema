import fs from "node:fs";
import { z } from "zod";
import type { CharacterProfile, Clip, Project, Story } from "@prisma/client";
import { prisma } from "@/server/db";
import { structuredCall } from "@/server/services/openai";
import { getSettings, wpmForPace } from "@/server/services/settings";
import { computeTargetWords, saveStory } from "@/server/services/story";
import { buildCharacterLock, flowHandleFromName, getOrCreateMainCharacter } from "@/server/services/character";
import { recordEvent } from "@/server/lib/logger";
import { relocateStoredProjectFile } from "@/server/lib/paths";
import { speechOutputLanguageLock } from "@/lib/speech-cast-locale";
import { clampPromptForFlowBox, FLOW_HARD_CHAR_LIMIT, FLOW_PROMPT_MAX } from "@/lib/flow-prompt-compact";
import { sanitizeCelebrityLikenessForFlow, softenFamousNamesInSpeech } from "@/lib/flow-prompt-safety";
import { realityLockBlock } from "@/lib/reality-lock";
import {
  companionSpeciesForFlow,
  isOnCameraShot,
  isTimeTravelShot,
  parseTimeTravelSettings,
  resolveCompanionLook,
  resolveHostPresets,
  serializeTimeTravelSettings,
  softenFamousFiguresForFlow,
  timeTravelLocalLimit,
  timeTravelShotLabel,
  timeTravelWorldForFlow,
  type TimeTravelResearch,
  type TimeTravelSettings,
  type TimeTravelShot,
} from "@/lib/time-travel";
import { researchTimeTravelTopic } from "@/server/services/time-travel-research";

/**
 * Zaman Yolcusu: birinci tekil tarih vlogu.
 * Sunucu kameraya konusur, yol arkadasi hayvan her klipte aynidir,
 * cevredeki herkes secilen donemden. Sinema klip hatti (Flow + render) aynen kullanilir.
 */

type TimeTravelRole = "companion" | "local";

function readRole(profile: Pick<CharacterProfile, "dnaCard">): TimeTravelRole | null {
  try {
    const card = JSON.parse(profile.dnaCard || "{}") as { timeTravelRole?: string };
    return card.timeTravelRole === "companion" || card.timeTravelRole === "local" ? card.timeTravelRole : null;
  } catch {
    return null;
  }
}

export function isTimeTravelCompanion(profile: Pick<CharacterProfile, "dnaCard">): boolean {
  return readRole(profile) === "companion";
}

export function isTimeTravelLocal(profile: Pick<CharacterProfile, "dnaCard">): boolean {
  return readRole(profile) === "local";
}

export function timeTravelSettingsOf(project: Pick<Project, "timeTravelSettings">): TimeTravelSettings {
  return parseTimeTravelSettings(project.timeTravelSettings);
}

function short(text: string | null | undefined, max: number): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function dropSheet(profile: Pick<CharacterProfile, "referenceImagePath">): void {
  const sheet = relocateStoredProjectFile(profile.referenceImagePath);
  if (sheet) fs.rmSync(sheet, { force: true });
}

/** Sunucu (ana karakter) ve yol arkadasini proje ayarlarindan kurar / gunceller. */
export async function seedTimeTravelCast(projectId: string): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const stored = timeTravelSettingsOf(project);
  // Celiskili hazir metinleri duzelt: papagan secili ama gorunum "kitten" (Flow kedi cizer),
  // erkek secili ama kadin hazir gorunumu. Duzeltilen ayar geri yazilir — prompt da ayni metni kullanir.
  const s: TimeTravelSettings = {
    ...stored,
    ...resolveHostPresets(stored),
    companionLook: resolveCompanionLook(stored.companionSpecies || "kedi", stored.companionLook),
  };
  if (s.hostLook !== stored.hostLook || s.hostWardrobe !== stored.hostWardrobe || s.hostVoice !== stored.hostVoice || s.companionLook !== stored.companionLook) {
    await prisma.project.update({ where: { id: projectId }, data: { timeTravelSettings: serializeTimeTravelSettings(s) } });
  }

  const main = await getOrCreateMainCharacter(projectId);
  const hostChanged =
    main.faceFeatures !== s.hostLook || main.wardrobe !== s.hostWardrobe || main.gender !== s.hostGender || main.age !== s.hostAge;
  if (hostChanged && main.referenceImagePath) dropSheet(main);
  const updatedMain = await prisma.characterProfile.update({
    where: { id: main.id },
    data: {
      name: s.hostName.trim() || "Sunucu",
      gender: s.hostGender,
      age: s.hostAge,
      adult: true,
      nationalityLook: "",
      hair: "",
      makeup: "",
      faceFeatures: s.hostLook,
      wardrobe: s.hostWardrobe,
      voiceCharacter: s.hostVoice,
      storyRole: "sunucu (zaman yolcusu)",
      flowCharacterReference: flowHandleFromName(s.hostName || "Sunucu"),
      ...(hostChanged ? { referenceImagePath: null, imageApproved: false } : {}),
    },
  });
  await prisma.characterProfile.update({ where: { id: updatedMain.id }, data: buildCharacterLock(updatedMain) });

  const sides = await prisma.characterProfile.findMany({ where: { projectId, role: "side" } });
  const companion = sides.find(isTimeTravelCompanion);
  if (!s.companionEnabled) {
    if (companion) {
      dropSheet(companion);
      await prisma.characterProfile.delete({ where: { id: companion.id } });
    }
    return;
  }
  const species = s.companionSpecies.trim() || "kedi";
  const name = s.companionName.trim() || species;
  const look = s.companionLook.trim();
  const dnaCard = JSON.stringify({ timeTravelRole: "companion", species });
  if (companion) {
    const lookChanged = companion.baseAppearancePrompt !== look || companion.dnaCard !== dnaCard;
    if (lookChanged) dropSheet(companion);
    await prisma.characterProfile.update({
      where: { id: companion.id },
      data: {
        name,
        storyRole: `yol arkadaşı · ${species}`,
        baseAppearancePrompt: look,
        imagePrompt: look,
        baseWardrobePrompt: "",
        wardrobe: "",
        dnaCard,
        flowCharacterReference: flowHandleFromName(name),
        ...(lookChanged ? { referenceImagePath: null, imageApproved: false } : {}),
      },
    });
    return;
  }
  await prisma.characterProfile.create({
    data: {
      projectId,
      role: "side",
      name,
      storyRole: `yol arkadaşı · ${species}`,
      gender: "female",
      adult: true,
      baseAppearancePrompt: look,
      imagePrompt: look,
      dnaCard,
      flowCharacterReference: flowHandleFromName(name),
    },
  });
}

// ---------------------------------------------------------------------------
// Senaryo
// ---------------------------------------------------------------------------

const localSchema = z.object({
  name: z.string().min(1),
  role: z.string(),
  gender: z.enum(["male", "female"]),
  look: z.string(),
});

const storySchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  hook: z.string(),
  fullStory: z.string().min(1),
  estimatedWords: z.number().int().nonnegative(),
  estimatedDurationSeconds: z.number().int().nonnegative(),
  language: z.string(),
  contentWarnings: z.array(z.string()),
  characterVoiceNotes: z.string(),
  locals: z.array(localSchema),
  thumbnailText: z.string(),
});

type TimeTravelStoryPayload = z.infer<typeof storySchema>;

const STORY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "YouTube basligi, birinci tekil (or. 'Keops Piramidi Insa Edilirken Misir'a Zaman Yolculugu Yaptim!')" },
    summary: { type: "string", description: "2-3 cumlelik bolum ozeti" },
    hook: { type: "string", description: "Acilis cumlesi (fullStory'nin ilk cumlesiyle ayni)" },
    fullStory: { type: "string", description: "Sunucunun kameraya ve dis seste soyledigi TAM metin; yalnizca konusulacak cumleler" },
    estimatedWords: { type: "integer" },
    estimatedDurationSeconds: { type: "integer" },
    language: { type: "string" },
    contentWarnings: { type: "array", items: { type: "string" } },
    characterVoiceNotes: { type: "string", description: "Sunucunun ses ve tavir notlari" },
    locals: {
      type: "array",
      description: "Sunucunun tanistigi donem yerlileri (sayi siniri kullanici mesajinda). fullStory'deki isimlerle birebir ayni.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Doneme uygun ozel isim (or. Henu, Merit)" },
          role: { type: "string", description: "or. tas ustasi, ekmekci" },
          gender: { type: "string", enum: ["male", "female"] },
          look: {
            type: "string",
            description: "ENGLISH visual description: age, face, hair, era-accurate clothing and accessories. No names of real people.",
          },
        },
        required: ["name", "role", "gender", "look"],
      },
    },
    thumbnailText: { type: "string", description: "Kapak icin 2-4 kelimelik dev yazi (or. '4500 YIL ÖNCE')" },
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
    "locals",
    "thumbnailText",
  ],
};

function storySystemPrompt(s: TimeTravelSettings, language: string): string {
  const companion = s.companionEnabled
    ? `Yol arkadasi: ${s.companionName} adli ${s.companionSpecies}. Her bolumde yaninda; sevimli tepkileri anlatiya renk katar ama konusmaz.`
    : "Sunucu yalniz yolculuk yapar; yol arkadasi hayvan yok.";
  return [
    "Sen 'Zaman Yolcusu' formatinda YouTube tarih vlogu yazan senaristsin.",
    `Sunucu ${s.hostName}: gecmise giden modern bir gezgin. Metin TAMAMEN onun agzindan, BIRINCI TEKIL, kameraya ve izleyiciye konusur gibi.`,
    companion,
    "YAPI:",
    "- Acilis (ilk 2-3 cumle): nereye, hangi yila geldigini soyleyen carpici kanca + ilk duyusal izlenim.",
    "- Govde: ARASTIRMA DOSYASINDAKI duraklari sirayla izle (dosya yoksa gunun akisi: sabah → oglen → aksam). Her durak somut bir mekan ve olay.",
    "- Dosyadaki yerlilerle tanis (baska isim uydurma); her birinin isi ve gunluk hayati uzerinden donemi ogret.",
    "- Dosyadaki bilgileri (tarih, sayi, teknik) dogal konusmaya yedir; dosyada olmayan kesin bilgi uydurma.",
    "- Unlu kisiler yalnizca uzaktan gorulur; sunucu onlarla sohbet etmez, tanik olur.",
    "- Gunluk hayat ayrintilari: yemek, para/takas, kiyafet, aletler, inanclar, is bolumu.",
    "- Dogru tarih bilgisini dogal konusmanin icine yedir (olcu, sayi, teknik). Emin olunmayan konuda 'tahminlere gore' de; uydurma kesinlik YASAK.",
    "- Doruk: bolumun en buyuk 'vay' ani (anit, tören, onemli kisi gecisi).",
    "- Kapanis: kisa degerlendirme + izleyiciye tek soru + kisa begen/abone cagrisi.",
    "SES (en onemli kural — bu bir VLOG, belgesel notu degil):",
    "- Simdiki zamanda, o anin icinde yasayarak konus: gordugunu, duydugunu, kokladigini, hissettigini anlat ('Burnuma taze ekmek kokusu geliyor', 'Yer hafifce titredi, kalbim duracakti').",
    "- Tam, akici, samimi cumleler. Telgraf/liste uslubu YASAK (or. 'Marcus hamuru kesip damgaliyor, kurekle suruyor' gibi kuru eylem siralamasi degil; 'Marcus bana goz kirpti, hamura muhru basip firina surdu — bakin, her ekmegin uzerinde sahibinin adi var!').",
    "- Yerlilerle kisa etkilesim kur: selam, bir soru, bir ikram, tek kelimelik yerel ifade (or. 'Salve!'). Sunucu onlarla konusur ama tarihi degistirmez.",
    "- Duygu inisi cikisi: merak, saskinlik, heyecan, hafif endise; her durakta bir 'vay' ani.",
    "- Bugunun bilgisi (kazi, muze, arkeolog, 'bulundu') en fazla 1-2 kez ve yalnizca sunucunun heyecanli yan notu olarak: 'Dusunsenize, bu ekmeklerin bir benzeri yuzyillar sonra kulun altinda bulunacak!' Kuru arsiv cumlesi YASAK.",
    "- Ayni hareketi/tepkiyi tekrarlama (or. yol arkadasini iki kez kucaklamak). Yol arkadasinin her gorunusu farkli olsun (kokluyor, saklaniyor, merakla bakiyor, kucaga atliyor).",
    "- Yabanci/teknik terimi kullanirsan hemen gunluk dille acikla ('fullonica, yani donemin camasirhanesi').",
    "- ILK CUMLE: izleyiciye selam + yil + yer, heyecanla (or. 'Arkadaslar, su an MS 79 yilindayim, Pompeii'deyim!').",
    "- Paragrafa ya da cumleye saat damgasiyla BASLAMA ('06:30, pistrinum.' YASAK). Gecisleri yururken anlat: 'Gunes yukseldi, simdi cesmeye dogru yuruyoruz.' Saat gerekiyorsa cumlenin icinde soyle.",
    "- 'derler', 'bulundu', 'kazilarda', 'arkeologlar' ifadeleri yalnizca 'Dusunsenize...' yan notunda ve toplam en fazla 1 kez.",
    "- Bilgi yogunlugu: her durakta EN FAZLA 1 sayi/teknik bilgi; gerisi yasanan an, tepki ve etkilesim.",
    "USLUP ORNEGI (baska bir bolumden; icerigi KOPYALAMA, yalnizca sesi ve ritmi al):",
    "\"Arkadaslar, inanamayacaksiniz, su an 1550 yilindayim, Istanbul'dayim! Burnuma baharat kokusu geliyor, her yer insan dolu. Minnos kucagimda, o da benim kadar saskin.",
    "Bakin, su genc Hasan; sirtindaki tablada simit satiyor. 'Buyur abla!' deyip bir tane uzatti. Para yerine ne verecegim simdi, hic bilmiyorum!",
    "Dusunsenize, bu carsi yuzyillar sonra bile ayni yerde olacak. Hadi, kalabaligin aktigi yere, limana dogru gidiyoruz.\"",
    "KURALLAR:",
    "- Izleyiciye hitap et ('bakin', 'dusunsenize', 'inanamayacaksiniz').",
    "- Her 2-3 cumle ayri bir sahne/klip olabilecek kadar gorsel ve somut olsun.",
    "- Modern kisi, marka, argo YOK. Siddet ve kan gosterme; tarihsel zorlugu saygiyla anlat.",
    "- Gercek unlu tarihi kisilerin adi (or. firavun) en fazla 2-3 kez; cogunlukla unvaniyla an.",
    "- Yerlilerin isimleri doneme uygun; konusma dilinin yerel isimleri DEGIL.",
    speechOutputLanguageLock(language),
  ].join("\n");
}

function researchDossier(research: TimeTravelResearch | null): string {
  if (!research) return "";
  const stops = research.stops
    .map((stop, i) => `${i + 1}) ${stop.time} — ${stop.location}: ${stop.happening}${stop.facts.length ? ` [Bilgi: ${stop.facts.join("; ")}]` : ""}`)
    .join("\n");
  return [
    "ARASTIRMA DOSYASI (tek dogru kaynak — tarih, yer, sayi ve adlari buradan al):",
    `Ozet: ${research.summary}`,
    research.hostAngle ? `Sunucunun kancasi: ${research.hostAngle}` : "",
    `Duraklar (bu sirayla ilerle):\n${stops}`,
    research.locals.length ? `Yerliler (YALNIZCA bu isimler): ${research.locals.map((l) => `${l.name} (${l.role})`).join(", ")}` : "",
    research.famousFigures.length
      ? `Unlu kisiler (uzaktan gorulur, sunucuyla konusmaz): ${research.famousFigures.map((f) => f.name).join(", ")}`
      : "",
    research.cautions.length ? `Dikkat: ${research.cautions.join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

interface StoryPart {
  index: number;
  count: number;
  stops: TimeTravelResearch["stops"];
  previousTail: string;
  introducedLocals: string[];
  localLimit: number;
}

function storyPartNote(part: StoryPart, words: number): string {
  const role =
    part.index === 0
      ? "ACILIS PARCASI: ilk cumle izleyiciye selam + yil + yer (kanca). Bu parcada kapanis, soru veya begen/abone cagrisi YAZMA."
      : part.index === part.count - 1
        ? "KAPANIS PARCASI: kaldigin yerden dogal gecisle devam et; yeniden selam VERME. En sonda kisa degerlendirme + izleyiciye tek soru + kisa begen/abone cagrisi."
        : "ARA PARCA: kaldigin yerden dogal gecisle devam et; selam verme, kapanis yapma.";
  const stops = part.stops
    .map((stop) => `- ${stop.time} — ${stop.location}: ${stop.happening}${stop.facts.length ? ` [Bilgi: ${stop.facts.join("; ")}]` : ""}`)
    .join("\n");
  const newLocalBudget = Math.max(0, part.localLimit - part.introducedLocals.length);
  return [
    `PARCA ${part.index + 1}/${part.count} — bu cagrida YALNIZCA bu parcayi yaz (tum bolum degil). Bu parca talimati, sistem mesajindaki acilis/kapanis kurallarindan ONCE gelir.`,
    role,
    `Tum bolumde en fazla ${part.localLimit} yerli olur; bu parcada en fazla ${newLocalBudget} YENI yerli tanistirabilirsin${newLocalBudget === 0 ? " (yeni yerli YOK; yalnizca tanistirilanlar veya isimsiz kalabalik)" : ""}.`,
    `Bu parcanin duraklari (sirayla, yalnizca bunlar):\n${stops}`,
    `Bu parcanin hedefi: ~${words} kelime (+-%10). Kisa kesme; her durakta yasanan an, tepki ve etkilesim olsun.`,
    part.introducedLocals.length
      ? `Daha once tanistirilan yerliler (yeniden tanistirma; donerse kisaca hatirlat): ${part.introducedLocals.join(", ")}`
      : "",
    part.previousTail
      ? `ONCEKI PARCANIN SONU (ayni cumleleri TEKRAR ETME; buradan devam et):\n…${part.previousTail}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function storyUserPrompt(project: Project, s: TimeTravelSettings, targetWords: number, part?: StoryPart): string {
  return [
    `Donem: ${s.era}`,
    `Yer: ${s.place}`,
    researchDossier(s.research),
    project.topic.trim() ? `Bolum fikri / olmazsa olmazlar: ${project.topic.trim()}` : "",
    `Konusma dili: ${project.speechLanguage}`,
    part
      ? `Tum bolumun suresi: ${project.targetDurationSeconds} saniye; bu parca ~${targetWords} kelime.`
      : `Hedef sure: ${project.targetDurationSeconds} saniye (~${targetWords} kelime, +-%10)`,
    part ? storyPartNote(part, targetWords) : "",
    `Klip suresi ${project.clipSeconds} sn; her klip 2-3 kisa cumle alir.`,
    `Yerli sayisi: en fazla ${timeTravelLocalLimit(project.targetDurationSeconds)} (her yerli ayri gorsel ister; kisa videoda az ama akilda kalan yerli). Dosyada daha fazlasi varsa en ilginclerini sec; locals alanina yalnizca metinde adi gecenleri yaz.`,
    project.avoidList.trim() ? `Istenmeyen unsurlar: ${project.avoidList.trim()}` : "",
    "locals alaninda her yerlinin gorunumunu INGILIZCE ve doneme birebir uygun yaz.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Bu sureyi asan bolumler parca parca yazilir: tek cagrida model 10-20 dk'lik
 * (3000+ kelime) hedefin cok altinda kalir ve zaman asimina yaklasir.
 */
const STORY_SINGLE_CALL_MAX_MINUTES = 4;
const STORY_PART_MINUTES = 2.5;

async function writeTimeTravelStoryInParts(
  project: Project,
  s: TimeTravelSettings,
  targetWords: number,
  stops: TimeTravelResearch["stops"]
): Promise<TimeTravelStoryPayload> {
  const minutes = project.targetDurationSeconds / 60;
  const count = Math.min(stops.length, Math.max(2, Math.ceil(minutes / STORY_PART_MINUTES)));
  const groups: Array<TimeTravelResearch["stops"]> = Array.from({ length: count }, () => []);
  stops.forEach((stop, i) => groups[Math.floor((i * count) / stops.length)].push(stop));
  const wordsPer = Math.max(60, Math.round(targetWords / count));

  let fullStory = "";
  let first: TimeTravelStoryPayload | null = null;
  const locals = new Map<string, TimeTravelStoryPayload["locals"][number]>();
  const warnings = new Set<string>();
  for (let index = 0; index < count; index++) {
    await recordEvent({
      projectId: project.id,
      step: "story",
      message: `Yolculuk senaryosu parca ${index + 1}/${count} yaziliyor (~${wordsPer} kelime)`,
    });
    const part: StoryPart = {
      index,
      count,
      stops: groups[index],
      previousTail: fullStory.slice(-900),
      introducedLocals: [...locals.values()].map((l) => l.name),
      localLimit: timeTravelLocalLimit(project.targetDurationSeconds),
    };
    const payload = await structuredCall<TimeTravelStoryPayload>({
      system: storySystemPrompt(s, project.speechLanguage),
      user: storyUserPrompt(project, s, wordsPer, part),
      schemaName: "time_travel_story",
      jsonSchema: STORY_JSON_SCHEMA,
      zodSchema: storySchema,
      reasoningEffort: "medium",
      timeoutMs: 5 * 60_000,
    });
    first ??= payload;
    fullStory = fullStory ? `${fullStory}\n\n${payload.fullStory.trim()}` : payload.fullStory.trim();
    for (const local of payload.locals) {
      const key = local.name.trim().toLocaleLowerCase("tr-TR");
      if (key && !locals.has(key)) locals.set(key, local);
    }
    for (const w of payload.contentWarnings) warnings.add(w);
  }
  const base = first as TimeTravelStoryPayload;
  const words = fullStory.split(/\s+/).filter(Boolean).length;
  return {
    ...base,
    fullStory,
    estimatedWords: words,
    estimatedDurationSeconds: project.targetDurationSeconds,
    contentWarnings: [...warnings],
    locals: [...locals.values()],
  };
}

/** Yolculuk senaryosunu uretir (veya instruction ile mevcut senaryoyu duzenler). */
/** Projenin konusu icin arastirma yapar ve ayarlara yazar (donem/yer de guncellenir). */
export async function researchProjectTopic(projectId: string): Promise<TimeTravelResearch> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const s = timeTravelSettingsOf(project);
  const topic = project.topic.trim() || `${s.era}, ${s.place}`;
  const research = await researchTimeTravelTopic({
    topic,
    speechLanguage: project.speechLanguage,
    targetDurationSeconds: project.targetDurationSeconds,
    hostName: s.hostName,
    companion: s.companionEnabled ? `${s.companionName} (${s.companionSpecies})` : "",
    projectId,
  });
  await prisma.project.update({
    where: { id: projectId },
    data: {
      timeTravelSettings: serializeTimeTravelSettings({
        ...s,
        era: research.era || s.era,
        place: research.place || s.place,
        thumbnailText: s.thumbnailText || research.thumbnailText,
        research,
      }),
    },
  });
  return research;
}

export async function generateTimeTravelStory(projectId: string, options?: { instruction?: string }): Promise<Story> {
  let project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!timeTravelSettingsOf(project).research) {
    // Arastirmasiz senaryo yazilmaz: tarih/yer/bilgi dogrulugu buna dayanir.
    await researchProjectTopic(projectId);
    project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  }
  const s = timeTravelSettingsOf(project);
  const appSettings = await getSettings();
  const wpm = wpmForPace(appSettings, project.speechPace);
  const targetWords =
    project.targetWordCount > 0 ? project.targetWordCount : computeTargetWords(project.targetDurationSeconds, wpm);
  const existing = options?.instruction
    ? await prisma.story.findUnique({
        where: { projectId_languageVariant: { projectId, languageVariant: "primary" } },
      })
    : null;

  await recordEvent({
    projectId,
    step: "story",
    message: options?.instruction ? "Yolculuk senaryosu duzenleniyor" : `Yolculuk senaryosu yaziliyor: ${s.era} · ${s.place}`,
    detail: { targetWords },
  });

  const stops = s.research?.stops ?? [];
  const minutes = project.targetDurationSeconds / 60;
  const payload =
    !options?.instruction && minutes > STORY_SINGLE_CALL_MAX_MINUTES && stops.length >= 2
      ? await writeTimeTravelStoryInParts(project, s, targetWords, stops)
      : await structuredCall<TimeTravelStoryPayload>({
          system: `${storySystemPrompt(s, project.speechLanguage)}${options?.instruction ? `\n\nGOREV: ${options.instruction}` : ""}`,
          user: `${storyUserPrompt(project, s, targetWords)}${existing ? `\n\nMEVCUT SENARYO:\nBaslik: ${existing.title}\n\n${existing.fullStory}` : ""}`,
          schemaName: "time_travel_story",
          jsonSchema: STORY_JSON_SCHEMA,
          zodSchema: storySchema,
          reasoningEffort: "medium",
          timeoutMs: 6 * 60_000,
        });

  const story = await saveStory(project, { ...payload, namedPeople: [] }, wpm);
  // Arastirmadaki yerlinin gorunumu esastir; senaryo yeni isim uydurursa o da eklenir.
  const researched = new Map((s.research?.locals ?? []).map((l) => [l.name.toLocaleLowerCase("tr-TR"), l]));
  const spoken = payload.fullStory.toLocaleLowerCase("tr-TR");
  const merged = payload.locals
    .map((l) => {
      const hit = researched.get(l.name.trim().toLocaleLowerCase("tr-TR"));
      return hit ? { ...l, gender: hit.gender, look: hit.look || l.look, role: l.role || hit.role } : l;
    })
    .filter((l) => {
      const first = l.name.trim().split(/\s+/)[0]?.toLocaleLowerCase("tr-TR") || "";
      return first.length > 0 && spoken.includes(first);
    })
    .slice(0, timeTravelLocalLimit(project.targetDurationSeconds));
  await seedTimeTravelLocals(projectId, merged);
  if (payload.thumbnailText.trim() && !s.thumbnailText.trim()) {
    await prisma.project.update({
      where: { id: projectId },
      data: { timeTravelSettings: serializeTimeTravelSettings({ ...s, thumbnailText: payload.thumbnailText.trim() }) },
    });
  }
  await recordEvent({
    projectId,
    step: "story",
    message: `Yolculuk senaryosu hazir: "${payload.title}" (${story.estimatedWords} kelime, ${payload.locals.length} yerli)`,
  });
  return story;
}

async function seedTimeTravelLocals(projectId: string, locals: TimeTravelStoryPayload["locals"]): Promise<void> {
  const existing = (await prisma.characterProfile.findMany({ where: { projectId, role: "side" } })).filter(isTimeTravelLocal);
  const wanted = new Map<string, TimeTravelStoryPayload["locals"][number]>();
  for (const local of locals.slice(0, 8)) {
    const name = local.name.replace(/\s+/g, " ").trim();
    if (name) wanted.set(name.toLocaleLowerCase("tr-TR"), { ...local, name });
  }
  for (const old of existing) {
    if (!wanted.has(old.name.toLocaleLowerCase("tr-TR"))) {
      dropSheet(old);
      await prisma.characterProfile.delete({ where: { id: old.id } });
    }
  }
  for (const local of wanted.values()) {
    const look = short(softenFamousFiguresForFlow(local.look), 420);
    const match = existing.find((c) => c.name.toLocaleLowerCase("tr-TR") === local.name.toLocaleLowerCase("tr-TR"));
    const data = {
      name: local.name,
      storyRole: local.role.trim(),
      gender: local.gender,
      adult: true,
      baseAppearancePrompt: look,
      imagePrompt: look,
      wardrobe: "",
      baseWardrobePrompt: "",
      dnaCard: JSON.stringify({ timeTravelRole: "local" }),
      flowCharacterReference: flowHandleFromName(local.name),
    };
    if (match) {
      const changed = match.baseAppearancePrompt !== look || match.gender !== local.gender;
      if (changed) dropSheet(match);
      await prisma.characterProfile.update({
        where: { id: match.id },
        data: { ...data, ...(changed ? { referenceImagePath: null, imageApproved: false } : {}) },
      });
    } else {
      await prisma.characterProfile.create({ data: { projectId, role: "side", ...data } });
    }
  }
}

// ---------------------------------------------------------------------------
// Cekim plani
// ---------------------------------------------------------------------------

const planSchema = z.object({
  shots: z.array(
    z.object({
      index: z.number().int(),
      shot: z.enum(["tt_selfie", "tt_local", "tt_pov", "tt_wide"]),
      setting: z.string(),
      action: z.string(),
      localName: z.string(),
      companion: z.boolean(),
      famousFigure: z.string(),
      emotion: z.string(),
    })
  ),
  eraEnglish: z.string(),
  placeEnglish: z.string(),
});

const PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer" },
          shot: { type: "string", enum: ["tt_selfie", "tt_local", "tt_pov", "tt_wide"] },
          setting: { type: "string", description: "ENGLISH: exact place and moment in the era (what is behind/around the host)" },
          action: { type: "string", description: "ENGLISH: what visibly happens in this clip (host, companion, locals)" },
          localName: { type: "string", description: "tt_local ise yerlinin adi, degilse bos" },
          companion: { type: "boolean", description: "Yol arkadasi hayvan bu klipte gorunuyor mu" },
          famousFigure: {
            type: "string",
            description: "Bu klipte gorunen gercek unlu kisinin adi (arastirmadaki famousFigures'tan), yoksa bos",
          },
          emotion: { type: "string", description: "ENGLISH single word for the host's feeling (awe, curiosity, surprise, joy, unease)" },
        },
        required: ["index", "shot", "setting", "action", "localName", "companion", "famousFigure", "emotion"],
      },
    },
    eraEnglish: { type: "string", description: "The era in plain English with AD/BC written out (e.g. 'AD 79, the morning before Mount Vesuvius erupted')" },
    placeEnglish: { type: "string", description: "The place in plain English (e.g. 'Pompeii, Roman Campania, Italy')" },
  },
  required: ["shots", "eraEnglish", "placeEnglish"],
};

export interface TimeTravelClipPlan {
  setting: string;
  action: string;
  companion: boolean;
  /** Unlu kisi: yalnizca unvan + sahneleme (ad yazilmaz). */
  famous: string;
}

export function parseTimeTravelClipPlan(imagePrompt: string | null | undefined): TimeTravelClipPlan {
  const text = imagePrompt || "";
  const pick = (tag: string) => text.match(new RegExp(`\\[TT ${tag}\\]\\s*([^\\n]*)`, "i"))?.[1]?.trim() || "";
  return {
    setting: pick("SETTING"),
    action: pick("ACTION"),
    companion: !/\[TT COMPANION\]\s*no/i.test(text),
    famous: pick("FAMOUS"),
  };
}

function planImagePrompt(plan: TimeTravelClipPlan, research: TimeTravelResearch | null): string {
  const figures = research?.famousFigures ?? [];
  return [
    `[TT SETTING] ${short(softenFamousFiguresForFlow(plan.setting, figures), 360)}`,
    `[TT ACTION] ${short(softenFamousFiguresForFlow(plan.action, figures), 420)}`,
    `[TT COMPANION] ${plan.companion ? "yes" : "no"}`,
    plan.famous ? `[TT FAMOUS] ${short(softenFamousFiguresForFlow(plan.famous, figures), 260)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Plan ciktisindaki unlu kisi adini arastirmadaki unvan + sahnelemeye cevirir. */
function famousStaging(name: string, research: TimeTravelResearch | null): string {
  const key = name.trim().toLocaleLowerCase("tr-TR");
  if (!key) return "";
  const hit = research?.famousFigures.find(
    (f) => f.name.toLocaleLowerCase("tr-TR") === key || key.includes(f.name.toLocaleLowerCase("tr-TR"))
  );
  const role = hit?.role?.trim() ? hit.role.trim() : "the historical figure";
  const staging = hit?.staging?.trim() || "seen only from far away or from behind, in a crowd";
  return `${role.replace(/^the\s+/i, "the ")} — ${staging}`;
}

function fallbackShot(index: number, dialogue: string, locals: CharacterProfile[]): { shot: TimeTravelShot; local: CharacterProfile | null } {
  const lower = dialogue.toLocaleLowerCase("tr-TR");
  const local = locals.find((l) => l.name && lower.includes(l.name.toLocaleLowerCase("tr-TR"))) ?? null;
  if (local) return { shot: "tt_local", local };
  if (index === 1) return { shot: "tt_selfie", local: null };
  const cycle: TimeTravelShot[] = ["tt_selfie", "tt_wide", "tt_selfie", "tt_pov"];
  return { shot: cycle[(index - 1) % cycle.length], local: null };
}

/** Kliplere bolunmus metin icin cekim plani (selfie / yerli / goz hizasi / genis) yazar. */
export async function planTimeTravelClips(projectId: string): Promise<Clip[]> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const s = timeTravelSettingsOf(project);
  const clips = await prisma.clip.findMany({ where: { projectId, languageVariant: "primary" }, orderBy: { index: "asc" } });
  const locals = (await prisma.characterProfile.findMany({ where: { projectId, role: "side" } })).filter(isTimeTravelLocal);
  const open = clips.filter((c) => c.status !== "completed");
  if (open.length === 0) return clips;

  const planned = new Map<number, z.infer<typeof planSchema>["shots"][number]>();
  const lastClipIndex = clips[clips.length - 1]?.index ?? 0;
  const systemText = [
        "You are the director of a live-action time-travel history vlog.",
        `Host: ${s.hostName}, a modern visitor filming herself/himself on a phone. Era and place: ${timeTravelWorldForFlow(s)}.`,
        s.companionEnabled
          ? `Companion animal: ${s.companionName}, a ${companionSpeciesForFlow(s.companionSpecies)} (${s.companionLook}). Usually visible with the host.`
          : "No companion animal.",
        `Locals: ${locals.map((l) => `${l.name} (${l.storyRole})`).join(", ") || "none named"}.`,
        s.research?.visualWorld ? `Visual world of this exact moment: ${s.research.visualWorld}` : "",
        s.research?.allowedTech ? `Technology that existed: ${s.research.allowedTech}` : "",
        s.research?.anachronisms.length ? `Must NOT appear: ${s.research.anachronisms.join(", ")}.` : "",
        s.research?.famousFigures.length
          ? `Real famous people (set famousFigure to their name when visible; they are only seen far away / from behind, never face to face): ${s.research.famousFigures.map((f) => f.name).join(", ")}.`
          : "No real famous people are shown.",
        "For EVERY clip pick one shot type:",
        "tt_selfie = host talks to camera at arm's length (the backbone of the vlog: opening, reactions, facts, closing).",
        "tt_local = host with a named local in frame (use whenever the line names or talks about that local).",
        "tt_pov = first-person view of what the host sees or holds (objects, food, tools, details).",
        "tt_wide = wide establishing shot of the place and scale (new location, monuments, crowds).",
        "Clip 1 and the last clip are tt_selfie. At least half of all clips are tt_selfie or tt_local.",
        "Never more than 2 tt_pov/tt_wide clips in a row and never more than 3 tt_selfie clips in a row.",
        "setting/action are ENGLISH, concrete, visual, historically accurate for the era, one or two sentences each.",
        `Write action in the THIRD person with names (${s.hostName}, locals) — never "I", "me" or "we".`,
        "Never write names of real historical figures in setting/action; use titles (the pharaoh, the king).",
        "Keep continuity: the day moves forward in time; places follow the spoken line.",
        "A clip with a famous figure is tt_wide or tt_pov (never tt_local, never a close-up of that person).",
        `The film has ${clips.length} clips; the last clip is #${lastClipIndex}. You may receive only a part of them; plan exactly the clips you receive.`,
  ]
    .filter(Boolean)
    .join("\n");

  // 10-20 dk = 60-150 klip: tek cagri cevabi yarim kalir / zaman asimina ugrar. 20'lik partiler,
  // ayni anda en fazla 4 cagri (sirali 8 parti 15+ dk suruyordu). Sureklilik: her parti bir
  // onceki partinin son iki repligini bilir; mekan/saat kurallari asagidaki dongude uygulanir.
  const PLAN_BATCH = 20;
  const PLAN_CONCURRENCY = 4;
  const batches: Clip[][] = [];
  for (let start = 0; start < open.length; start += PLAN_BATCH) batches.push(open.slice(start, start + PLAN_BATCH));
  let english: { era: string; place: string } | null = null;
  const planBatch = async (batch: Clip[]): Promise<void> => {
    const firstPos = open.indexOf(batch[0]);
    const before = open.slice(Math.max(0, firstPos - 2), firstPos);
    const context = before.length
      ? `The clips just before this part say (continue from here, do not restart the day):\n${before
          .map((c) => `#${c.index}: ${c.dialogue.replace(/\s+/g, " ").trim()}`)
          .join("\n")}\n\nPlan these clips:\n`
      : "";
    try {
      const result = await structuredCall<z.infer<typeof planSchema>>({
        system: systemText,
        user: `${context}${batch.map((c) => `#${c.index}: ${c.dialogue.replace(/\s+/g, " ").trim()}`).join("\n")}`,
        schemaName: "time_travel_shot_plan",
        jsonSchema: PLAN_JSON_SCHEMA,
        zodSchema: planSchema,
        reasoningEffort: "low",
        timeoutMs: 4 * 60_000,
      });
      for (const shot of result.shots) {
        if (batch.some((c) => c.index === shot.index)) planned.set(shot.index, shot);
      }
      if (!english && result.eraEnglish.trim()) english = { era: result.eraEnglish.trim(), place: result.placeEnglish.trim() };
    } catch (err) {
      await recordEvent({
        projectId,
        step: "clips",
        level: "warning",
        message: `Cekim plani klip ${batch[0].index}-${batch[batch.length - 1].index} icin OpenAI ile yazilamadi, bu kisim yerel planla gidiyor: ${err instanceof Error ? err.message : String(err)}`.slice(0, 280),
      });
    }
  };
  for (let i = 0; i < batches.length; i += PLAN_CONCURRENCY) {
    await Promise.all(batches.slice(i, i + PLAN_CONCURRENCY).map(planBatch));
  }
  const found = english as { era: string; place: string } | null;
  if (s.research && !s.research.eraEnglish && found) {
    s.research = { ...s.research, eraEnglish: found.era, placeEnglish: found.place };
    await prisma.project.update({ where: { id: projectId }, data: { timeTravelSettings: serializeTimeTravelSettings(s) } });
  }

  const lastIndex = clips[clips.length - 1]?.index ?? 0;
  let offCameraRun = 0;
  let fromModel = 0;
  for (const clip of open) {
    const hit = planned.get(clip.index);
    let shot: TimeTravelShot;
    let local: CharacterProfile | null = null;
    let plan: TimeTravelClipPlan;
    let emotion = clip.emotionLabel || "curiosity";
    if (hit) {
      fromModel += 1;
      shot = hit.shot;
      local = hit.localName.trim()
        ? locals.find((l) => l.name.toLocaleLowerCase("tr-TR") === hit.localName.trim().toLocaleLowerCase("tr-TR")) ?? null
        : null;
      // Metinde adi gecen yerli kadraja girer; model kacirsa bile.
      const named = fallbackShot(clip.index, clip.dialogue, locals).local;
      if (named && shot !== "tt_local") {
        shot = "tt_local";
        local = named;
      }
      if (shot === "tt_local" && !local) shot = "tt_selfie";
      // Vlog omurgasi: acilis/kapanis kameraya; sunucu 2 klipten uzun kaybolmaz.
      if (clip.index === 1 || clip.index === lastIndex) shot = shot === "tt_local" ? shot : "tt_selfie";
      if (!isOnCameraShot(shot) && offCameraRun >= 2) shot = "tt_selfie";
      const famous = famousStaging(hit.famousFigure, s.research);
      // Unlu kisi yerli gibi sunucunun yanina alinmaz; uzaktan kalir.
      if (famous && shot === "tt_local") {
        shot = "tt_selfie";
        local = null;
      }
      plan = { setting: hit.setting, action: hit.action, companion: s.companionEnabled && hit.companion, famous };
      emotion = hit.emotion.trim() || emotion;
    } else {
      const fb = fallbackShot(clip.index, clip.dialogue, locals);
      shot = fb.shot;
      local = fb.local;
      plan = {
        setting: timeTravelWorldForFlow(s),
        action:
          shot === "tt_wide"
            ? "wide view of daily life in the era; the host is small in frame, looking around"
            : shot === "tt_pov"
              ? "the host's hands and what the host looks at up close"
              : "the host talks to camera and reacts to the surroundings",
        companion: s.companionEnabled && shot !== "tt_pov",
        famous: "",
      };
    }
    offCameraRun = isOnCameraShot(shot) ? 0 : offCameraRun + 1;
    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        shotType: shot,
        characterId: shot === "tt_local" ? local?.id ?? null : null,
        sceneDescription: short(`${timeTravelShotLabel(shot)} — ${plan.setting}. ${plan.action}`, 400),
        imagePrompt: planImagePrompt(plan, s.research),
        emotionLabel: short(emotion, 40),
        prompt: "",
      },
    });
  }
  await recordEvent({
    projectId,
    step: "clips",
    message: `Cekim plani hazir: ${open.length} klip (${fromModel} OpenAI, ${open.length - fromModel} yerel)`,
  });
  return prisma.clip.findMany({ where: { projectId, languageVariant: "primary" }, orderBy: { index: "asc" } });
}

// ---------------------------------------------------------------------------
// Flow promptu
// ---------------------------------------------------------------------------

export interface TimeTravelPromptInput {
  project: Project;
  host: CharacterProfile | null;
  companion: CharacterProfile | null;
  local: CharacterProfile | null;
  clip: Clip;
  previousClip: Clip | null;
}

function hostLine(s: TimeTravelSettings, host: CharacterProfile | null): string {
  const name = host?.name?.trim() || s.hostName || "the host";
  const person = s.hostGender === "male" ? "man" : "woman";
  const look = short(host?.faceFeatures || s.hostLook, 320);
  const outfit = short(host?.wardrobe || s.hostWardrobe, 260);
  return `Host ${name}: a ${s.hostAge}-year-old ${person}, ${look}. Modern outfit that never changes: ${outfit}.`;
}

function companionLine(s: TimeTravelSettings, companion: CharacterProfile | null): string {
  if (!s.companionEnabled || !companion) return "";
  const species = companionSpeciesForFlow(s.companionSpecies);
  const look = resolveCompanionLook(s.companionSpecies, companion.baseAppearancePrompt || s.companionLook);
  return `Companion ${companion.name}: a real ${species}, ${short(look, 260)} — the same animal in every clip, natural animal behavior, never talks.`;
}

function shotBlocks(
  shot: TimeTravelShot,
  hostName: string,
  his: "his" | "her",
  plan: TimeTravelClipPlan,
  companionName: string | null,
  local: CharacterProfile | null
): { shot: string; who: string; camera: string } {
  const where = (plan.setting || "the era's daily life around the host").replace(/[.\s]+$/, "");
  const action = plan.action.replace(/[.\s]+$/, "");
  const doing = action ? ` ${action}.` : "";
  const withPet = companionName ? ` ${companionName} is with the host (on ${his} shoulder, in ${his} arms or at ${his} feet).` : "";
  switch (shot) {
    case "tt_local":
      return {
        shot: `Vlog shot with a local: ${hostName} stands next to ${local?.name ?? "a local"} and talks to the camera, turning toward them.${doing} Behind them: ${where}.`,
        who: `${hostName} and ${local?.name ?? "one local"} in frame${local ? ` (${short(local.storyRole, 60)})` : ""}. The local reacts and gestures naturally but does not speak.${withPet} Other locals stay in the background.`,
        camera: "Arm's-length selfie two-shot or close two-shot, eye level, gentle handheld sway, both faces sharp.",
      };
    case "tt_pov":
      return {
        shot: `Point-of-view shot through ${hostName}'s eyes: ${where}.${doing}`,
        who: `${hostName} is not seen except ${his} hands and forearms; ${his} voice is heard off-screen.${companionName ? ` ${companionName} may appear at ${his} feet or next to ${his} hands.` : ""}`,
        camera: "First-person handheld, eye height, natural walking movement, close details in focus.",
      };
    case "tt_wide":
      return {
        shot: `Wide establishing shot: ${where}.${doing} A strong sense of scale and real life happening.`,
        who: `${hostName} is small in the frame, seen from behind or from the side, looking around.${companionName ? ` ${companionName} is right beside the host.` : ""} The host's voice is heard off-screen. Locals go about their work.`,
        camera: "Wide lens, slow cinematic pan or push-in, stable horizon.",
      };
    default:
      return {
        shot: `Selfie vlog shot: ${hostName} holds the phone at arm's length and talks straight into the lens; face and upper body fill the foreground.${doing} Behind the host: ${where}.`,
        who: `${hostName} in the foreground.${withPet} Locals in the background belong to the era and mostly ignore the camera.`,
        camera: "Arm's-length phone selfie, slightly wide lens, eye level, natural handheld sway, face sharp, background detailed.",
      };
  }
}

/** Zaman Yolcusu klibi icin Flow promptu (yazi yasagi damgasini cagiran ekler). */
export function buildTimeTravelClipPrompt(input: TimeTravelPromptInput): string {
  const { project, host, companion, local, clip, previousClip } = input;
  const s = timeTravelSettingsOf(project);
  const lang = project.speechLanguage?.trim() || "Turkish";
  const shot: TimeTravelShot = isTimeTravelShot(clip.shotType) ? clip.shotType : "tt_selfie";
  const plan = parseTimeTravelClipPlan(clip.imagePrompt);
  const hostName = host?.name?.trim() || s.hostName || "the host";
  const companionName = s.companionEnabled && companion && plan.companion ? companion.name : null;
  const blocks = shotBlocks(shot, hostName, s.hostGender === "male" ? "his" : "her", plan, companionName, local);
  const onCamera = isOnCameraShot(shot);
  // Soylenen cumledeki tarihi ad Flow'un "taninmis kisi" filtresini tetikler; unvanla soylenir.
  const quote = softenFamousNamesInSpeech(clip.dialogue.replace(/\s+/g, " ").replace(/"/g, "'").trim());
  const prevPlan = previousClip ? parseTimeTravelClipPlan(previousClip.imagePrompt) : null;
  const research = s.research;
  const figures = research?.famousFigures ?? [];
  const soften = (text: string) => softenFamousFiguresForFlow(text, figures);
  const era = soften(timeTravelWorldForFlow(s));
  const sentence = (value: string) => `${value.replace(/[.\s]+$/, "")}.`;
  const world = research?.visualWorld
    ? [
        sentence(`Historically accurate ${era}. ${short(soften(research.visualWorld), 700)}`),
        research.allowedTech ? sentence(`Technology that existed then: ${short(soften(research.allowedTech), 260)}`) : "",
        research.anachronisms.length
          ? sentence(`Must NOT appear (did not exist yet or wrong for this place): ${short(soften(research.anachronisms.join(", ")), 420)}`)
          : "",
        "No tourists, no modern signs.",
      ]
        .filter(Boolean)
        .join(" ")
    : `Historically accurate ${era}: period architecture, tools, clothing, vehicles, food and materials. Nothing that was invented or built after this moment appears; no tourists, no modern signs.`;
  const famousLine = plan.famous
    ? `${sentence(soften(plan.famous))} This real historical person is never shown face to face: no close-up, no readable face, never next to the host, never speaking to camera.`
    : "";

  const parts = [
    "[SPOKEN LINE — AUDIO FIRST — DO NOT DROP]",
    onCamera
      ? `${hostName} says this exact ${lang} line to the camera, lips in sync, word for word, filling the whole clip:`
      : `Off-screen voice of ${hostName} (the same voice as every clip) says this exact ${lang} line, word for word, filling the whole clip:`,
    `"${quote}"`,
    "",
    "[IDENTITY LOCK — SAME PEOPLE EVERY CLIP]",
    hostLine(s, host),
    companionName ? companionLine(s, companion) : "",
    local && shot === "tt_local" ? `Local ${local.name} (${short(local.storyRole, 60)}): ${short(soften(local.baseAppearancePrompt), 320)}` : "",
    "Reference images are identity sheets: each shows ONE person (or ONE animal) twice, front and back. In this video that person appears exactly once — never twins, never a second copy, never a look-alike.",
    local && shot === "tt_local" ? `${local.name} is a different person from ${hostName}.` : "",
    "",
    // Sira = oncelik: Veo metin girdisi ~1024 token (≈4000 karakter); kritik bloklar basta.
    `[SHOT] ${soften(blocks.shot)}`,
    "",
    `[WHO IS ON SCREEN] ${soften(blocks.who)}${famousLine ? ` ${famousLine}` : ""}`,
    "",
    `[SCENE CONTINUITY] Same journey and same day as the previous clip${prevPlan?.setting ? ` (previous shot: ${short(soften(prevPlan.setting), 160)})` : ""}. Host face, hair, body, outfit${companionName ? " and companion" : ""} stay identical to the reference; light follows the time of day.`,
    "",
    realityLockBlock({ world: era, crowd: "locals of this exact era and place", hasReferences: true }),
    "",
    "[RESTRICTIONS] No famous-person likeness. No modern objects except the host's outfit and bag. Every other person in frame, including far-background passersby, wears clothing of this era; no modern-dressed people. No readable writing on walls, signs or shop fronts. The camera phone itself is never visible. No blood, no injured close-ups.",
    "",
    "[TIME TRAVEL VLOG — FORMAT]",
    `Live-action travel vlog filmed by a modern visitor inside the real world of ${era}. Everything around the host belongs to that exact moment and looks lived-in and real. Only the host wears modern clothes.`,
    "",
    `[CAMERA] ${blocks.camera}`,
    "",
    `[PERFORMANCE] ${hostName}'s mood: ${clip.emotionLabel || "curiosity"} — expressive, warm, genuinely amazed, natural gestures.${companionName ? ` ${companionName} reacts like a real animal (looks around, sniffs, flicks ears).` : ""} Only ${hostName} speaks, in ${lang}, ${short(host?.voiceCharacter || s.hostVoice, 120)} — same voice every clip. Locals do not speak.`,
    "",
    `[WORLD] ${world}`,
    "",
    "[STYLE] Real camera footage, natural daylight and practical light, true-to-life color, fine texture on skin, fur, stone and fabric. Natural ambient sound of the place. No background music. Not a cartoon, not a painting, not CGI-looking.",
  ];
  const text = sanitizeCelebrityLikenessForFlow(parts.filter((p, i, arr) => p !== "" || arr[i - 1] !== "").join("\n"));
  return clampPromptForFlowBox(text, Math.min(FLOW_PROMPT_MAX, FLOW_HARD_CHAR_LIMIT - 1) - 900);
}

/** Klip icin yuklenecek referans sheet'leri: sunucu, yol arkadasi, yerli (en fazla 3). */
export function timeTravelReferencePaths(
  clip: Clip,
  cast: Array<Pick<CharacterProfile, "id" | "role" | "referenceImagePath" | "dnaCard">>
): { paths: string[]; labels: string[] } {
  const shot = isTimeTravelShot(clip.shotType) ? clip.shotType : "tt_selfie";
  const plan = parseTimeTravelClipPlan(clip.imagePrompt);
  const paths: string[] = [];
  const labels: string[] = [];
  const add = (profile: (typeof cast)[number] | undefined, label: string) => {
    const file = profile ? relocateStoredProjectFile(profile.referenceImagePath) : null;
    if (file && !paths.includes(file) && paths.length < 3) {
      paths.push(file);
      labels.push(label);
    }
  };
  if (shot !== "tt_pov") add(cast.find((c) => c.role === "main"), "sunucu");
  if (plan.companion) add(cast.find((c) => isTimeTravelCompanion(c)), "yol arkadaşı");
  if (shot === "tt_local" && clip.characterId) add(cast.find((c) => c.id === clip.characterId), "yerli");
  return { paths, labels };
}

// ---------------------------------------------------------------------------
// Karakter sayfasi (Nano Banana)
// ---------------------------------------------------------------------------

export function buildTimeTravelSheetPrompt(project: Project, profile: CharacterProfile): string {
  const s = timeTravelSettingsOf(project);
  const role = readRole(profile);
  let text: string;
  if (role === "companion") {
    const species = companionSpeciesForFlow(s.companionSpecies);
    text = [
      `ONE reference sheet of exactly ONE real ${species}, shown twice in two panels.`,
      `LEFT panel: full-body SIDE view of the ${species}, standing, whole body and tail visible. RIGHT panel: full-body FRONT view of the SAME animal, sitting, looking at the camera.`,
      `The animal: ${short(resolveCompanionLook(s.companionSpecies, profile.baseAppearancePrompt || s.companionLook), 360)}.`,
      "Identical fur color, markings, eye color and size in both panels. No humans, no other animals, no props, no collar text.",
      "Empty plain mid-gray seamless background, soft even studio light, real photograph look, sharp fur detail.",
      "No text, no captions, no watermark, no logo.",
    ].join(" ");
  } else {
    const person = profile.gender === "male" ? "adult man (male)" : "adult woman (female)";
    const isHost = profile.role === "main";
    const look = isHost
      ? `${profile.age}-year-old ${person}. ${short(profile.faceFeatures || s.hostLook, 360)}. Outfit: ${short(profile.wardrobe || s.hostWardrobe, 300)}.`
      : `${person}. ${short(softenFamousFiguresForFlow(profile.baseAppearancePrompt), 420)}. Clothing accurate to ${softenFamousFiguresForFlow(timeTravelWorldForFlow(s))}.`;
    text = [
      "ONE character reference sheet of exactly ONE person, shown twice in two panels.",
      "LEFT panel: FRONT view, full body head-to-toe, feet visible, standing straight, facing the camera, clear readable face, calm natural expression.",
      "RIGHT panel: BACK view of the SAME person, full body head-to-toe, same height and scale.",
      `Subject: ${look}`,
      "Identical face, hair, body and outfit in both panels. Forbidden: two different people, twins, group, extra panels.",
      "Empty plain mid-gray seamless background, even soft light, real photograph look, natural skin texture, real fabric.",
      "No text, no captions, no watermark, no logo.",
    ].join(" ");
  }
  return clampPromptForFlowBox(sanitizeCelebrityLikenessForFlow(text.replace(/\s+/g, " ").trim()));
}

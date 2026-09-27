/**
 * Konusma diline gore kadro isimleri + Flow karakter locale kilidi.
 * Almanca: Alman ozel isim + Alman yetiskin komsu tarifi (unlu/etnik "tip" YOK).
 */

import { languageTagFor } from "@/lib/tts-catalog";

export type SpeechLocaleTag = "tr" | "de" | "en" | "fr" | "es";

type LocalePack = {
  label: string;
  demonym: string;
  femaleNames: string[];
  maleNames: string[];
  lookLock: string;
};

const PACKS: Record<SpeechLocaleTag, LocalePack> = {
  tr: {
    label: "Turkce",
    demonym: "Turkish",
    femaleNames: ["Elif", "Derya", "Zeynep", "Ayse", "Merve"],
    maleNames: ["Mert", "Emre", "Kerem", "Hakan", "Murat"],
    lookLock: "Everyday Turkish city neighbor. Original invented face.",
  },
  de: {
    label: "Almanca",
    demonym: "German",
    femaleNames: ["Lena", "Anna", "Julia", "Laura", "Nina", "Hannah", "Lea", "Clara"],
    maleNames: ["Lukas", "Jonas", "Markus", "Tobias", "Felix", "Niklas", "Leon", "Jan"],
    lookLock:
      "Everyday German city adult invented for this story. Ordinary original face, light-to-medium complexion, natural eyes. German street-casual clothes (Berlin/Hamburg neighbor, not a fashion campaign).",
  },
  en: {
    label: "Ingilizce",
    demonym: "English-speaking",
    femaleNames: ["Sarah", "Claire", "Megan", "Rachel", "Lauren"],
    maleNames: ["James", "Daniel", "Oliver", "Nathan", "Ryan"],
    lookLock: "Everyday English-speaking city neighbor. Original invented face.",
  },
  fr: {
    label: "Fransizca",
    demonym: "French",
    femaleNames: ["Camille", "Claire", "Manon", "Lea", "Julie"],
    maleNames: ["Julien", "Antoine", "Nicolas", "Lucas", "Hugo"],
    lookLock: "Everyday French city neighbor. Original invented face.",
  },
  es: {
    label: "Ispanyolca",
    demonym: "Spanish",
    femaleNames: ["Lucia", "Marta", "Carmen", "Elena", "Paula"],
    maleNames: ["Carlos", "Diego", "Pablo", "Javier", "Miguel"],
    lookLock: "Everyday Spanish-speaking city neighbor. Original invented face.",
  },
};

function foldName(raw: string): string {
  const first = raw.trim().split(/\s+/)[0] || "";
  return first
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function speechLocaleTag(language: string | null | undefined): SpeechLocaleTag {
  const tag = languageTagFor(language);
  if (tag === "de" || tag === "en" || tag === "fr" || tag === "es") return tag;
  return "tr";
}

export function localePackForSpeech(language: string | null | undefined): LocalePack {
  return PACKS[speechLocaleTag(language)];
}

/** Karakter profili nationalityLook — TR'de bos, Almanca'da Alman komsu kilidi. */
export function localeNationalityLook(language: string | null | undefined): string {
  const tag = speechLocaleTag(language);
  if (tag === "tr") return "";
  return PACKS[tag].lookLock;
}

/** Hikaye / konu / kadro GPT: isimler konusma diline kilitli. */
export function speechCastStoryLock(language: string | null | undefined): string {
  const tag = speechLocaleTag(language);
  const pack = PACKS[tag];
  const female = pack.femaleNames.slice(0, 5).join(", ");
  const male = pack.maleNames.slice(0, 5).join(", ");
  const foreign = foreignNameExamples(tag).join(", ");
  if (tag === "de") {
    return [
      `ISIM KILIDI — konusma dili Almanca: kadroda yalnizca yaygin ALMAN ozel isimleri.`,
      `Kadin ornek: ${female}. Erkek ornek: ${male}.`,
      `Baska dilin ismi YASAK (${foreign}). Unlu / siyasetci / oyuncu adi YASAK.`,
      "Ilk geciste rol+isim (mein Mann Markus), sonra hep o Alman isim.",
      "ULKE KILIDI: hikaye, mekan, kurum, sokak, yemek, meslek ve gunluk hayat ALMANYA'da (Berlin, Hamburg, Munih, Koln, Leipzig). Turk, Amerikan veya baska ulke sahnesi YASAK.",
      "fullStory, ozet, diyalog ve seslendirme metni tamamen Almanca olsun (Turkiye/Turkce kelime yok).",
    ].join(" ");
  }
  if (tag === "tr") {
    return [
      `ISIM KILIDI — konusma dili Turkce: kadroda yaygin Turkce ozel isimler (${female} / ${male}).`,
      `Yabanci isim (${foreign}) ve unlu adi YASAK.`,
      "ULKE KILIDI: hikaye, mekan, kurum ve gunluk hayat TURKIYE'de. Baska ulke sahnesi YASAK.",
      "fullStory, ozet, diyalog ve seslendirme metni tamamen Turkce olsun.",
    ].join(" ");
  }
  return [
    `ISIM KILIDI — konusma dili ${pack.label}: kadroda bu dile uygun yaygin ozel isimler.`,
    `Kadin: ${female}. Erkek: ${male}.`,
    `Baska dilin ismi YASAK (${foreign}). Unlu adi YASAK.`,
    `fullStory ve diyalog yalnizca ${pack.label} olsun.`,
  ].join(" ");
}

/**
 * Konusma dili neyse kullaniciya giden her metin o dilde.
 * GPT sistem promptu Turkce kalsa bile JSON alanlari kacmasin.
 */
export function speechOutputLanguageLock(language: string | null | undefined): string {
  const tag = speechLocaleTag(language);
  if (tag === "de") {
    return [
      "AUSGABE-SPRACHSPERRE — UNVERHANDELBAR:",
      "title, summary, hook, fullText, closingLine, promisedQuestion, act titles, characterVoiceNotes, contentWarnings, storyRole, topic — alles ausschließlich auf Deutsch.",
      "Kein Türkisch und kein englischer Hörtext. Keine türkischen Wörter, Behörden, Speisen oder Straßennamen.",
      "Nur Deutschland. Voice-over nur Deutsch.",
    ].join(" ");
  }
  if (tag === "tr") {
    return [
      "CIKTI DIL KILIDI — TARTISILMAZ:",
      "title, summary, hook, fullText, closingLine, promisedQuestion, bolum basliklari, characterVoiceNotes, contentWarnings, storyRole, topic — hepsi yalnizca Turkce.",
      "Baska dilde cumle YASAK. Mekan Turkiye. Ses metni Turkce.",
    ].join(" ");
  }
  const pack = localePackForSpeech(language);
  return `OUTPUT LANGUAGE LOCK: every user-facing string (title, summary, hook, fullText, topic) must be entirely in ${pack.label}.`;
}

/**
 * Kare promptuna ulke/dil dunyasi — hikaye dili ile ayni sehir.
 * city verilirse filmin TEK sehri yazilir (birden fazla sehir kareden kareye kayma yapar).
 */
export function speechStillWorldLock(language: string | null | undefined, city?: string): string {
  const tag = speechLocaleTag(language);
  if (tag === "de") {
    return `[SPRACHWELT] Deutschland (${city || "Berlin/Hamburg/München/Köln"}). Deutsche Erwachsene. Keine Türkei, keine türkischen Schilder oder Namen im Bild.`;
  }
  if (tag === "en") {
    return `[LANGUAGE WORLD] English-speaking city adults${city ? ` in ${city}` : ""}. No Turkish or German street signs.`;
  }
  if (tag === "fr") {
    return `[MONDE] Ville française${city ? ` (${city})` : ""}. Adultes français. Pas de panneaux turcs.`;
  }
  if (tag === "es") {
    return `[MUNDO] Ciudad hispanohablante${city ? ` (${city})` : ""}. Adultos locales. Sin letreros turcos.`;
  }
  return `[DIL DUNYASI] Turkiye sehri${city ? ` (${city})` : ""}. Turk yetiskinler. Yabanci tabela yok.`;
}

export function defaultStillLocation(language: string | null | undefined): string {
  const tag = speechLocaleTag(language);
  if (tag === "de") return "bewohnte Berliner Wohnung, Küchentisch, Schlüssel und Unterlagen";
  if (tag === "en") return "lived-in city apartment kitchen, papers and keys";
  if (tag === "fr") return "appartement parisien habité, table de cuisine, clés";
  if (tag === "es") return "piso habitado, mesa de cocina, llaves";
  return "lived-in contemporary Turkish city interior, shallow depth of field";
}

/** Kilit metninde "sunlari yazma" ornegi: diger paketlerden birkac isim. */
function foreignNameExamples(tag: SpeechLocaleTag): string[] {
  const out: string[] = [];
  for (const [key, pack] of Object.entries(PACKS) as Array<[SpeechLocaleTag, LocalePack]>) {
    if (key === tag) continue;
    out.push(pack.femaleNames[0], pack.maleNames[0]);
  }
  return out.filter(Boolean).slice(0, 8);
}

/** Isim bu konusma diline ait mi? (paket listesi + baska paketlerde gecmiyor mu) */
export function isLocaleCastName(name: string, language: string | null | undefined): boolean {
  const key = foldName(name);
  if (key.length < 2) return true;
  const tag = speechLocaleTag(language);
  const own = PACKS[tag];
  if ([...own.femaleNames, ...own.maleNames].some((n) => foldName(n) === key)) return true;
  for (const [other, pack] of Object.entries(PACKS) as Array<[SpeechLocaleTag, LocalePack]>) {
    if (other === tag) continue;
    if ([...pack.femaleNames, ...pack.maleNames].some((n) => foldName(n) === key)) return false;
  }
  // Listede hic yoksa karar verilemez — hikaye kendi ismini uydurmus olabilir.
  return true;
}

/** Konusma diline uymayan kadro isimleri (uyari icin). */
export function offLocaleCastNames(names: string[], language: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = (raw || "").trim();
    if (!name || isLocaleCastName(name, language)) continue;
    const key = foldName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Film plani cinsiyet satiri — isim listesi dile gore. */
export function speechCastGenderHint(language: string | null | undefined): string {
  const pack = localePackForSpeech(language);
  return `Kadin isimler (${pack.femaleNames.join(", ")}) asla male olamaz. Erkek isimler (${pack.maleNames.join(", ")}) asla female olamaz.`;
}

/**
 * Flow karakter / sheet promptu — konusma dili Almanca ise Alman yetiskin kilidi.
 * Unlu, Slav/Iskandinav "tip", public figure YOK.
 */
export function flowLocaleCastLock(
  language: string | null | undefined,
  gender: "male" | "female",
  name?: string | null
): string {
  const tag = speechLocaleTag(language);
  if (tag === "tr") return "";
  const pack = PACKS[tag];
  // Ozel isim BILEREK yazilmaz: Flow "taninmis kisiler" suzgeci ad geceni reddediyor.
  const who =
    gender === "male"
      ? `Exactly ONE ${pack.demonym} adult man (male) invented for this story.`
      : `Exactly ONE ${pack.demonym} adult woman (female) invented for this story.`;
  return `[LOCALE CAST] ${who} ${pack.lookLock} Keep this ${pack.demonym} look — do not swap in another nationality or region.`;
}

/** Gorunum metnine locale kilidini bir kez ekler (kadro seed / film plani). */
export function appendFlowLocaleCast(
  appearance: string,
  language: string | null | undefined,
  gender: "male" | "female",
  name?: string | null
): string {
  const lock = flowLocaleCastLock(language, gender, name);
  if (!lock) return appearance.replace(/\s+/g, " ").trim();
  if (/\[LOCALE CAST\]/i.test(appearance)) return appearance.replace(/\s+/g, " ").trim();
  return `${appearance} ${lock}`.replace(/\s+/g, " ").trim();
}

/** Politika süzgeci: locale paketlerindeki ozel isimleri rol diline cevirmek icin. */
export function allLocaleGivenNames(): string[] {
  const names: string[] = [];
  for (const pack of Object.values(PACKS)) {
    names.push(...pack.femaleNames, ...pack.maleNames);
  }
  return [...new Set(names)];
}

export function inferLocaleGivenNameGender(name: string): "male" | "female" | null {
  const key = foldName(name);
  if (key.length < 3) return null;
  let female = false;
  let male = false;
  for (const pack of Object.values(PACKS)) {
    if (pack.femaleNames.some((n) => foldName(n) === key)) female = true;
    if (pack.maleNames.some((n) => foldName(n) === key)) male = true;
  }
  if (female && !male) return "female";
  if (male && !female) return "male";
  return null;
}

/**
 * Tum hikaye turlerinde (sinema anlatisi, gorsel anlati karesi, Zaman Yolcusu)
 * ayni kisa gerceklik + sureklilik kilidi. 10-20 dk'lik filmde referans kisiler,
 * sehir, esyalar ve arka plandaki insanlar klipten klibe kaymasin diye her
 * promptta birebir ayni metin gider; Flow kisaltmasinda (compactPromptForFlow)
 * bu blok ASLA dusmez. Uzunluk ~1100 karakteri gecmez (8000 limiti).
 */

import { speechLocaleTag, type SpeechLocaleTag } from "@/lib/speech-cast-locale";

export const REALITY_LOCK_TAG = "[REALITY LOCK — SAME WORLD EVERY CLIP]";

export type RealityFamily = "live-action" | "cgi3d" | "anime2d";

const CITIES: Record<SpeechLocaleTag, { country: string; cities: string[] }> = {
  tr: { country: "Turkey", cities: ["Istanbul", "Ankara", "Izmir", "Bursa", "Antalya"] },
  de: { country: "Germany", cities: ["Berlin", "Hamburg", "Munich", "Cologne"] },
  en: { country: "the United Kingdom", cities: ["London", "Manchester", "Birmingham"] },
  fr: { country: "France", cities: ["Paris", "Lyon", "Marseille"] },
  es: { country: "Spain", cities: ["Madrid", "Barcelona", "Seville"] },
};

/** Metinde gecen sehir adlari (yerel yazimlar dahil) → Ingilizce ad. \b Turkce "İ" ile calismaz; harf-oncesi kontrolu kullanilir. */
const CITY_ALIASES: Array<[RegExp, string]> = [
  [/(?<!\p{L})[İIi]stanbul/iu, "Istanbul"],
  [/(?<!\p{L})Ankara/iu, "Ankara"],
  [/(?<!\p{L})[İIi]zmir/iu, "Izmir"],
  [/(?<!\p{L})Bursa/iu, "Bursa"],
  [/(?<!\p{L})Antalya/iu, "Antalya"],
  [/(?<!\p{L})Berlin/iu, "Berlin"],
  [/(?<!\p{L})Hamburg/iu, "Hamburg"],
  [/(?<!\p{L})(?:M(?:ü|ue|u)nchen|Munich)/iu, "Munich"],
  [/(?<!\p{L})(?:K(?:ö|oe)ln|Cologne)/iu, "Cologne"],
  [/(?<!\p{L})London/iu, "London"],
  [/(?<!\p{L})Manchester/iu, "Manchester"],
  [/(?<!\p{L})Birmingham/iu, "Birmingham"],
  [/(?<!\p{L})Paris/iu, "Paris"],
  [/(?<!\p{L})Lyon/iu, "Lyon"],
  [/(?<!\p{L})Marseille/iu, "Marseille"],
  [/(?<!\p{L})Madrid/iu, "Madrid"],
  [/(?<!\p{L})Barcelona/iu, "Barcelona"],
  [/(?<!\p{L})Sevill[ae]/iu, "Seville"],
];

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Filmin TEK sehri: hikayede o dilin sehirlerinden biri geciyorsa o; yoksa
 * tohuma (proje kimligi / hikaye) gore sabit secim. Ayni proje her klipte ayni sehri alir.
 */
export function filmCityFor(language: string | null | undefined, seed: string, storyText = ""): { city: string; country: string } {
  const pack = CITIES[speechLocaleTag(language)];
  for (const [re, city] of CITY_ALIASES) {
    if (pack.cities.includes(city) && re.test(storyText)) return { city, country: pack.country };
  }
  return { city: pack.cities[hashSeed(seed || "film") % pack.cities.length], country: pack.country };
}

/** Gunumuz hikayeleri icin dunya satiri. */
export function presentDayWorld(language: string | null | undefined, seed: string, storyText = ""): string {
  const { city, country } = filmCityFor(language, seed, storyText);
  return `present-day ${city}, ${country}, the same real city every clip`;
}

export interface RealityLockInput {
  /** Kisa dunya tarifi: "present-day Berlin, Germany …" / "AD 79 Pompeii …" */
  world: string;
  /** Arka plandaki insanlar kim (or. "Berlin residents", "townspeople of AD 79 Pompeii"). */
  crowd: string;
  family?: RealityFamily;
  /** Referans gorsel kullaniliyor mu (kimlik eslestirme cumlesi). */
  hasReferences?: boolean;
  /** Tek kare (Nano Banana) mi — hareket/ses ifadeleri yazilmaz. */
  still?: boolean;
  /** Doluysa "real ordinary crowd" cumlesinin yerine gecer (3D cizgi film). */
  castLine?: string;
}

export function realityLockBlock(input: RealityLockInput): string {
  const family = input.family ?? "live-action";
  // Kelime ortasindan kesilmesin: sinir asilirsa son virgul/bosluktan kisaltilir.
  const clip = (text: string, max: number) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const at = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(" "));
    return cut.slice(0, at > max * 0.6 ? at : max).replace(/[,\s]+$/, "");
  };
  const world = clip(input.world, 200);
  const crowd = clip(input.crowd, 90);
  const unit = input.still ? "frame" : "clip";
  const reference = input.hasReferences
    ? "Reference match: each referenced person or animal is the exact individual in its reference image — same face, eyes, skin tone, hair color, length and parting, build, height and exact outfit colors and accessories; animals keep identical fur and markings. No beautifying, aging, restyling or outfit swap; each appears once, never duplicated."
    : `Recurring people keep the same face, hair, build and outfit in every ${unit}.`;
  const worldLine = `World: ${world}; architecture, materials, vehicles, props and weather match every other ${unit}; a returning place looks identical.`;
  const people = input.castLine?.trim()
    ? input.castLine.trim()
    : `Other people: real ordinary ${crowd} of varied ages and builds, dressed for this place and time, busy, not staring at the camera, no clones, correct hands.`;
  const look =
    family === "anime2d"
      ? "Look: one consistent 2D anime style, line weight and palette all film."
      : family === "cgi3d"
        ? "Look: one consistent 3D feature-animation style, materials and lighting all film; plausible light and contact shadows."
        : `Realism: one real camera look all film — same lens, grade, grain, exposure; one shadow direction, grounded feet and objects, true reflections${input.still ? "" : ", natural motion"}. Real ${input.still ? "photograph" : "footage"}, not CGI, not AI-looking.`;
  return [REALITY_LOCK_TAG, reference, worldLine, people, look].join(" ");
}

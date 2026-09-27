/**
 * Hikaye kadrosu: ozel isimden cinsiyet (GPT "Sevil=erkek" yazmasin).
 * Turkce + konusma dili (Almanca vb.) isim bankasi.
 * Cift anlamli isimler tahmin edilmez.
 */

import { inferLocaleGivenNameGender } from "@/lib/speech-cast-locale";

function foldGivenName(raw: string): string {
  const first = raw.trim().split(/\s+/)[0] || "";
  return first
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/[^a-z]/g, "");
}

const FEMALE_GIVEN = new Set(
  [
    "sevil", "sevgi", "sevim", "sevda", "zeynep", "asli", "aslihan", "elif", "ayse",
    "fatma", "hatice", "merve", "esra", "burcu", "seda", "leyla", "melek", "hulya",
    "serap", "pinar", "banu", "ceren", "dilek", "emine", "filiz", "gizem", "hilal",
    "irem", "melis", "nazli", "ozlem", "pelin", "selin", "tulay", "vildan", "yasemin",
    "zehra", "aylin", "berna", "canan", "damla", "ebru", "funda", "gamze", "handan",
    "isil", "kubra", "mine", "nalan", "oya", "tuba", "yildiz", "busra", "cagla",
    "duru", "ece", "fulya", "gulsah", "hande", "ilknur", "meltem", "neslihan", "ozge",
    "sibel", "tugba", "ulku", "zuhal", "begum", "cemre", "dilara", "ipek", "melike",
    "nilay", "oyku", "rabia", "selen", "tugce", "yeliz", "bahar", "cansu", "esin",
    "gulay", "havva", "ilayda", "nermin", "necla", "serpil", "semra", "ayten", "aysun",
    "derya", "nigar", "songul", "feride", "lina", "perihan", "reyhan", "saadet",
    "asya", "ayla", "derin",
  ].map(foldGivenName)
);

const MALE_GIVEN = new Set(
  [
    "emre", "hakan", "kerem", "murat", "ahmet", "mehmet", "ali", "mustafa", "hasan",
    "huseyin", "ibrahim", "yusuf", "omer", "cem", "burak", "onur", "serkan", "volkan",
    "erkan", "fatih", "gokhan", "halil", "ismail", "kemal", "levent", "metin", "nihat",
    "orhan", "polat", "recep", "sinan", "tarik", "ugur", "vedat", "yasin", "zafer",
    "baris", "cenk", "ege", "furkan", "haluk", "ilker", "kaan", "mesut", "necati",
    "osman", "ramazan", "selim", "tolga", "umit", "yavuz", "zeki", "alper", "berk",
    "caglar", "dogan", "erdem", "ferhat", "ilhan", "kadir", "mahmut", "oktay", "sedat",
    "tamer", "ufuk", "yilmaz", "adem", "bilal", "coskun", "erdal", "faruk", "hayri",
    "ismet", "erhan", "serdar", "tuncay", "bulent", "cengiz", "engin", "fahri",
  ].map(foldGivenName)
);

const UNISEX_GIVEN = new Set(
  ["deniz", "yagmur", "ozgur", "umut", "evren", "toprak", "yener", "dicle"].map(foldGivenName)
);

export function inferTurkishGivenNameGender(name: string): "male" | "female" | null {
  const key = foldGivenName(name);
  if (key.length < 3) return null;
  if (UNISEX_GIVEN.has(key)) return null;
  if (FEMALE_GIVEN.has(key) && !MALE_GIVEN.has(key)) return "female";
  if (MALE_GIVEN.has(key) && !FEMALE_GIVEN.has(key)) return "male";
  return null;
}

/** GPT cinsiyeti isimle celisiyorsa isim kazanir. */
export function resolveCastGender(name: string, declared: string | null | undefined): "male" | "female" {
  const inferred = inferTurkishGivenNameGender(name) ?? inferLocaleGivenNameGender(name);
  if (inferred) return inferred;
  return declared === "male" ? "male" : "female";
}

/**
 * Gorsel anlatı (slayt) icin NetShort DNA — sinema filmindeki duygu, etki→tepki,
 * sahne surekliligi ve iliski/guc dilini kare promptuna TASIR.
 * Ek OpenAI turu yok; beat metninden yerelde uretilir.
 */

import { findCastInText, onScreenCastForClipBeat } from "@/lib/cast-clip-match";
import { isLongformDramaGenre } from "@/lib/longform-catalog";
import { NETSHORT_EMOTIONS } from "@/lib/netshort-corpus";
import { netShortFlowEmotionCue } from "@/lib/netshort-summaries";
import { FLOW_FICTIONAL_PERSON_LOCK } from "@/lib/flow-prompt-safety";
import { filmCityFor, realityLockBlock } from "@/lib/reality-lock";
import {
  defaultStillLocation,
  inferLocaleGivenNameGender,
  speechLocaleTag,
  speechStillWorldLock,
} from "@/lib/speech-cast-locale";

export type LongformStoryPhase =
  | "humiliation"
  | "decision"
  | "fall"
  | "rise"
  | "return"
  | "regret";

export type LongformStillShotKind = "etki" | "tepki";

export interface LongformStillVisual {
  imagePrompt: string;
  mood: string;
  emotion: string;
  sceneDescription: string;
  location: string;
  people: string[];
  shotKind: LongformStillShotKind;
  phase: LongformStoryPhase;
}

export interface LongformStillBuildInput {
  narration: string;
  index: number;
  total: number;
  visualLock: string;
  genreId: string;
  roster?: string[];
  /** Birinci tekil anlaticinin ekran adi (kadrodaki ana karakter). */
  leadName?: string;
  /** Kadro cinsiyetleri (isim -> male/female); karede kim kadin kim erkek. */
  castGenders?: Record<string, "male" | "female">;
  /** Konusma dili: mekan/zamir/dunya kilidi buna gore. */
  speechLanguage?: string | null;
  previous?: Pick<LongformStillVisual, "location" | "people" | "emotion" | "shotKind"> | null;
  /** Filmin tek sehri (tum karelerde ayni). */
  filmCity?: { city: string; country: string };
}

/** Flow'a yapistirilan on gorunumler icin kisa kilit — bos oda / natürmort / sheet yasagi. */
export const STILL_SHEET_LOCK = [
  "[SHEET LOCK]",
  "Attached image(s) are FRONT-VIEW identity stills of the named adults (face, hair, age, wardrobe).",
  "Copy those EXACT faces, hair, age and wardrobe into this freeze.",
  "Those named adults MUST be clearly visible — face in frame, MCU or two-shot.",
  "OUTPUT must be ONE 16:9 story moment in a real location — never a character sheet, never a turnaround, never front-and-back split panels, never a gray studio cyclorama catalog pose.",
  "Forbidden: seamless gray/white cyclorama, looking-at-camera catalog pose, empty negative space, waist-up ID photo.",
  "Do not copy the identity still's blown-out white window, wall lamp, cyclorama glow or high-key studio light. Light this freeze like a real lived-in room: even practical indoor light, no blown highlights.",
  "Do not copy the reference framing. The attachments are identity only, not a layout to repeat.",
  "Empty rooms, still-lifes of keys/phones/papers without the people, crowd extras: forbidden.",
].join(" ");

/**
 * Birinci tekil isareti: anlatici bu karede SAHNEDE demektir.
 *
 * Eski liste yalnizca birkac kelimeydi ("ben", "yüzüm"...); "yanağıma çarptı",
 * "omzum irkildi", "sayfaları topladım" gibi cumleler kacip anlatici kadrodan
 * dusuyordu ve karede tek kisi (karsi taraf) kaliyordu. Artik hem iyelik
 * ekli govde kelimeleri hem 1. tekil fiil cekimi yakalanir.
 */
const FIRST_PERSON_RE =
  /(?:^|[^\p{L}\p{N}])(ben|bana|beni|benim|benden|bende|kendimi|kendime|elim|elime|elimi|elimde|avucum|avucuma|yüzüm|yuzum|yüzüme|yuzume|yanağım|yanagim|yanağıma|yanagima|omzum|omzuma|omuzlarım|omuzlarim|çenem|cenem|dilim|dilime|gözüm|gozum|gözlerim|gozlerim|kalbim|nefesim|nefesimi|parmaklarım|parmaklarim|saçım|sacim|sesim|sesimi|boğazım|bogazim|midem|içim|icim|ayaklarım|ayaklarim|dizlerim|bileğim|bilegim)(?:$|[^\p{L}\p{N}])/iu;

/** 1. tekil fiil: "topladım", "yazdım", "baktım", "gidiyorum", "diyeceğim". */
const FIRST_PERSON_VERB_RE =
  /\p{L}{2,}(?:d[iıuü]m|t[iıuü]m|yorum|iyorum|uyorum|üyorum|acağım|aca[gğ]im|ece[gğ]im|eceğim|mışım|misim|muşum|musum)(?:$|[^\p{L}\p{N}])/iu;

const FIRST_PERSON_DE_RE =
  /(?:^|[^\p{L}\p{N}])(ich|mir|mich|mein|meine|meiner|meinem|meinen|meines)(?:$|[^\p{L}\p{N}])/iu;

function mentionsFirstPerson(text: string): boolean {
  return FIRST_PERSON_RE.test(text) || FIRST_PERSON_VERB_RE.test(text) || FIRST_PERSON_DE_RE.test(text);
}

const NAME_STOP = new Set([
  "ben",
  "bir",
  "bu",
  "şu",
  "su",
  "o",
  "sen",
  "siz",
  "ve",
  "ama",
  "icin",
  "için",
  "sonra",
  "önce",
  "once",
  "gece",
  "sabah",
  "bugün",
  "bugun",
  "mutfak",
  "ofis",
  "araba",
  "otel",
  "evde",
  "kapı",
  "kapi",
  "telefon",
  "şimdi",
  "simdi",
  "dün",
  "dun",
  "yarın",
  "yarin",
  "herkes",
  "kimse",
  "annem",
  "babam",
  "kocam",
  "esim",
  "eşim",
  "ich",
  "und",
  "der",
  "die",
  "das",
  "ein",
  "eine",
  "dann",
  "nacht",
  "morgen",
  "küche",
  "kuche",
  "wohnung",
  "straße",
  "strasse",
  "berlin",
  "hamburg",
  "münchen",
  "munchen",
  "köln",
  "koln",
  "leipzig",
  "schlüssel",
  "schlussel",
  "anahtar",
  "karttaki",
  "göz",
  "goz",
  "kısa",
  "kisa",
  "yüz",
  "yuz",
  "uzun",
  "hayat",
  "para",
  "kalp",
  "ses",
  "sesi",
  "belki",
  "artık",
  "artik",
  "hepsi",
  "birden",
  "sanki",
  "elini",
  "eli",
  "metal",
  "saat",
  "mesaj",
  "dosya",
  "kart",
  "yüzük",
  "yuzuk",
  "kalem",
  "lobi",
  "asansör",
  "asansor",
  "toplantı",
  "toplanti",
  "koridor",
  "turnike",
  "imza",
  "mühür",
  "muhur",
  "cevap",
  "damar",
  "şoför",
  "sofor",
  "avucum",
  "yüzüm",
  "yuzum",
  "nişan",
  "nisan",
  "başkanlık",
  "baskanlik",
  "bunu",
  "şunu",
  "sunu",
  "onu",
  "kimi",
  "nesi",
  "ilk",
  "ilki",
  "ikinci",
  "bitti",
  "hamle",
  "maske",
  "bunları",
  "bunlari",
  "şunları",
  "sunlari",
  "onları",
  "onlari",
  "otomatik",
  "zarf",
  "adım",
  "adim",
  "yetki",
  "isim",
  "sayfa",
  "klasör",
  "klasor",
  "koltuk",
  "koruma",
  "ayna",
  "nefes",
  "gölge",
  "golge",
  "vakit",
  "takvim",
  "bagaj",
  "çanta",
  "canta",
  "ceket",
  "kravat",
  "parfüm",
  "parfum",
  "ekran",
  "oda",
  "resepsiyon",
  "koku",
  "masa",
  "kutu",
  "davet",
  "süreç",
  "surec",
  "bildirim",
  "yansıma",
  "yansima",
  "nabız",
  "nabiz",
  "kartvizit",
  "omuz",
  "bilek",
  "oje",
  "floresan",
  "klima",
  "sessizlik",
  "kulübe",
  "kulube",
  "güvenlik",
  "guvenlik",
]);

/** Apostrofsuz hâl eki: Kalemi → kalem, Anahtarı → anahtar. */
const NAME_CASE_SUFFIXES = [
  "nın",
  "nin",
  "nun",
  "nün",
  "ımı",
  "imi",
  "umu",
  "ümü",
  "yı",
  "yi",
  "yu",
  "yü",
  "ın",
  "in",
  "un",
  "ün",
  "sı",
  "si",
  "su",
  "sü",
  "ım",
  "im",
  "um",
  "üm",
  "ı",
  "i",
  "u",
  "ü",
];

const FEMALE_GIVEN_NAMES = new Set([
  "aslı",
  "asli",
  "asya",
  "ayla",
  "duru",
  "zeynep",
  "lina",
  "sevil",
  "emel",
  "elif",
  "ayşe",
  "ayse",
  "fatma",
  "merve",
  "damla",
  "defne",
  "ece",
  "ırmak",
  "irmak",
  "selin",
  "burcu",
  "pınar",
  "pinar",
  "nisa",
  "azra",
  "cemre",
  "duygu",
  "funda",
  "gamze",
  "hatice",
  "hülya",
  "hulya",
  "ipek",
  "leyla",
  "melis",
  "melisa",
  "nazlı",
  "nazli",
  "nur",
  "özge",
  "ozge",
  "pelin",
  "seda",
  "selma",
  "şule",
  "sule",
  "tuba",
  "yeliz",
  "yeşim",
  "yesim",
  "zehra",
  "zeliha",
  "beril",
  "ceren",
  "didem",
  "esra",
  "gizem",
  "hande",
  "ilknur",
  "jale",
  "kader",
  "meltem",
  "nilay",
  "oya",
  "aylin",
  "nesrin",
  "beren",
  "deren",
  "belgin",
  "nazan",
  "filiz",
  "özlem",
  "ozlem",
  "çiğdem",
  "cigdem",
  "şebnem",
  "sebnem",
  "derya",
  "fulya",
  "gülşah",
  "gulsah",
  "songül",
  "songul",
  // -i / -u ile biten kadin adlari: eski sezgi (a/e disi = erkek) bunlari
  // ERKEK sayiyordu; "Ezgi" kadrosu erkek olarak kaydediliyordu.
  "ezgi",
  "sevgi",
  "özgü",
  "ozgu",
  "simge",
  "bilge",
  "müge",
  "muge",
  "tuğçe",
  "tugce",
  "buse",
  "sedef",
  "sinem",
  "ebru",
  "eylül",
  "eylul",
  "nihal",
  "sibel",
  "aysel",
  "hazal",
  "ilayda",
  "kübra",
  "kubra",
  "lale",
  "mine",
  "yasemin",
  "zerrin",
  "tülay",
  "tulay",
  "ülkü",
  "ulku",
  "vildan",
  "şeyma",
  "seyma",
  "sena",
  "seval",
  "rana",
  "dilek",
  "yağmur",
  "yagmur",
  "nergis",
  "hilal",
  "bahar",
  "canan",
  "ceyda",
  "emine",
  "figen",
  "gonca",
  "havva",
  "münevver",
  "munevver",
  "neslihan",
  "reyhan",
  "sevgül",
  "sevgul",
  "türkan",
  "turkan",
  "ülker",
  "ulker",
  "lena",
  "anna",
  "julia",
  "laura",
  "nina",
  "hannah",
  "lea",
  "clara",
  "kathrin",
]);

/** "Gülnur", "Elifnaz", "Aygül" gibi kadin adi ekleri. */
const FEMALE_NAME_SUFFIX_RE = /(nur|naz|gul|gül|han(?:im)?)$/i;

const MALE_GIVEN_NAMES = new Set([
  "kerem",
  "hakan",
  "levent",
  "mert",
  "murat",
  "emre",
  "can",
  "oğuz",
  "oguz",
  "kaan",
  "baran",
  "ahmet",
  "mehmet",
  "ali",
  "mustafa",
  "hasan",
  "hüseyin",
  "huseyin",
  "osman",
  "orhan",
  "volkan",
  "sinan",
  "furkan",
  "kenan",
  "erhan",
  "burak",
  "onur",
  "cem",
  "caner",
  "yusuf",
  "ibrahim",
  "ismail",
  "serkan",
  "tolga",
  "umut",
  "barış",
  "baris",
  "efe",
  "enes",
  "erdem",
  "fatih",
  "gökhan",
  "gokhan",
  "halil",
  "ilker",
  "koray",
  "metin",
  "okan",
  "ömer",
  "omer",
  "selim",
  "taner",
  "tarık",
  "tarik",
  "ufuk",
  "yasin",
  "yavuz",
  "yiğit",
  "yigit",
  "zafer",
  "arda",
  "berk",
  "alp",
  "emir",
  "taha",
  "atakan",
  "cenk",
  "emrah",
  "ferhat",
  "kadir",
  "kemal",
  "mahmut",
  "nihat",
  "recep",
  "yunus",
  "berkay",
  "oğuzhan",
  "oguzhan",
  "tuncay",
  "lukas",
  "jonas",
  "markus",
  "tobias",
  "felix",
  "niklas",
  "leon",
  "jan",
]);

const NAME_TITLE_PREFIX = new Set([
  "avukat",
  "doktor",
  "dr",
  "bay",
  "bayan",
  "hanım",
  "hanim",
  "patron",
  "müdür",
  "mudur",
  "öğretmen",
  "ogretmen",
  "komiser",
  "hakim",
  "hâkim",
  "profesör",
  "profesor",
  "sekreter",
  "herr",
  "frau",
  "anwalt",
  "richter",
  "chef",
]);

const LOCATION_CUES: Array<{ re: RegExp; label: string }> = [
  { re: /ofis|b[uü]ro|toplant|hissedar|yatirimc|büro|buero|besprechung/i, label: "glass office at night, city lights" },
  { re: /limuzin|sedan|araba|direksiyon|trafik|auto|limousine|lenkrad/i, label: "luxury sedan interior at night" },
  { re: /d[uü]g[uü]n|gelinlik|salon|hochzeit|brautkleid/i, label: "warm wedding flashback ballroom" },
  { re: /mutfak|masa|anahtar|küche|kueche|schlüssel|schluessel/i, label: "lived-in kitchen table, papers and keys" },
  { re: /otel|lobi|resepsiyon|hotel|rezeption/i, label: "hotel lobby from a distance" },
  { re: /restoran|yemek|camdan|restaurant/i, label: "restaurant two-shot through glass" },
  { re: /penthouse|teras|manzara|terrasse/i, label: "penthouse emptiness, night city" },
  { re: /ma[gğ]aza|boutique|vitrin|schaufenster|laden/i, label: "boutique exit, wet pavement" },
  { re: /sokak|ya[gğ]mur|asfalt|straße|strasse|regen/i, label: "wet city street at night" },
  { re: /asans[oö]r|aufzug|fahrstuhl/i, label: "elevator two-shot" },
  { re: /mahkeme|avukat|evrak|gericht|anwalt|akte/i, label: "lawyer table, unsigned papers (no readable text)" },
  { re: /hastane|krankenhaus/i, label: "hospital corridor from a distance, no minors" },
  { re: /wohnung|berlin|hamburg|münchen|muenchen|köln|koeln|leipzig/i, label: "lived-in German city apartment" },
];

const ETKI_RE =
  /uzatt|firlat|tokat|itti|çarpt|carpt|imzala|gülümse|gulumse|tercih|kapıyı|kapiyi|anahtar|uzatma|vurdu|çekti|cekti|reichte|warf|schlug|stieß|stiess|unterschrieb|lächelte|laechelte/i;
const TEPKI_RE =
  /yüzü|yuzu|bakt|dönd|dondu|nefes|sustu|titre|donakald|yutkun|aşağı|asagi|kırıl|kiril|şok|sok|gesicht|schaute|drehte|atem|schwieg|zitterte|schock|erstarrt/i;

/**
 * Faz havuzlari genis tutulur: ayni etiket 13 karede tekrarlaninca seslendirme
 * de ayni profilde kalip duzlesiyordu. Her faz artik birkac farkli oyunculuk
 * profiline (ofke / sok / igrenme / soguk / pismanlik) dagilir.
 */
const PHASE_EMOTIONS: Record<LongformStoryPhase, readonly string[]> = {
  humiliation: [
    "donuk asagilanma",
    "kamusal ezme / herkesin onunde kucultme",
    "pişkin kucumseme (ihanet eden)",
    "pişkin hakimiyet bakisi (yukaridan)",
    "hakaretle asagilama",
    "asagilanma yarasi",
    "igrenme / tiksinti bakisi",
    "utanc / kamusal rezalet kizarmasi",
  ],
  decision: [
    "sakin yikici kararlilik",
    "numb / 'bitti' netligi",
    "delil ani: kagit/telefon isigi yuzu degistirir",
    "karar netligi (geri donus yok)",
    "kararli ofke (bagirmadan sert)",
    "sessiz dayanma",
  ],
  fall: [
    "flashback kirikligi (dugun ↔ simdi)",
    "mikro-sok: dudak aralanir, nefes kesilir",
    "etki sonrasi tepki (goz kırılması)",
    "ihanet soku (donup kalma)",
    "duygusal darbe (icten kirilma)",
    "yalnizlik ve direnis",
    "dehset / nefes tutulmasi",
  ],
  rise: [
    "gizli planin soguk heyecani",
    "hesap sorma tatmini (sakin, ustun)",
    "hesap sorma hazirligi",
    "gizli guc gerilimi",
    "soguk kin (bastirilmis nefret)",
    "ezme hamlesi",
  ],
  return: [
    "status zaferi (kontrollu gulus)",
    "yeni askla guvenli sogukluk",
    "donuste soğuk intikam ustunlugu",
    "piskin meydan okuma",
    "ic ferahligi / kontrollu sevinc",
    "yukun kalkmasi (rahatlama)",
  ],
  regret: [
    "pismanlik bogulmasi (yalvarma)",
    "kamusal rezalet gerilimi",
    "gec kalmis pismanlik",
    "pismanlik yalvarisi",
    "ikinci sans aciliyeti",
    "yakalanmis panik",
  ],
};

const KEYWORD_EMOTION: Array<{ re: RegExp; emotion: string }> = [
  { re: /pişman|pisman|yalvar/i, emotion: "pismanlik bogulmasi (yalvarma)" },
  { re: /tokat|itti|kapiyi carp|kapıyı çarp/i, emotion: "fiziksel ustunluk (itme, tokat, kapi carpma)" },
  { re: /sekreter|is yemegi|iş yemeği/i, emotion: "tercih ani: gulus baskasina, sirt donulur" },
  { re: /imza|dilekce|dilekçe|bosan/i, emotion: "sakin yikici kararlilik" },
  { re: /d[uü]g[uü]n|flashback|nikah/i, emotion: "flashback kirikligi (dugun ↔ simdi)" },
  { re: /yeni ask|yanımda|yanimda baskas/i, emotion: "yeni askla guvenli sogukluk" },
  { re: /y[uü]z[uü] d[uü]ş|yuzu dus/i, emotion: "status zaferi (kontrollu gulus)" },
  { re: /bagir|bağır|hayki|yeter artik|yeter artık|defol/i, emotion: "bagirmaya yakin ofke (patlama esigi)" },
  { re: /igren|iğren|tiksin|mide bulan/i, emotion: "igrenme / tiksinti bakisi" },
  { re: /yakaland|elleri titre|panik/i, emotion: "yakalanmis panik" },
  { re: /nefes kesil|donup kald|inanamad|şok|sok oldu/i, emotion: "ihanet soku (donup kalma)" },
  { re: /utand|utanc|utanç|rezil|kizard|kızard/i, emotion: "utanc / kamusal rezalet kizarmasi" },
  { re: /kibir|tepeden bak|kucumse|küçümse|alay/i, emotion: "kibirli kucumseme" },
  { re: /rahatlad|derin nefes|yuk kalkt|yük kalkt|ferahla/i, emotion: "yukun kalkmasi (rahatlama)" },
  { re: /bir sans|ikinci sans|geri don|affet/i, emotion: "ikinci sans aciliyeti" },
  { re: /reue|fleh|bitte nicht/i, emotion: "pismanlik bogulmasi (yalvarma)" },
  { re: /ohrfeige|stieß|tür knall|tuer knall/i, emotion: "fiziksel ustunluk (itme, tokat, kapi carpma)" },
  { re: /sekretärin|sekretaerin/i, emotion: "tercih ani: gulus baskasina, sirt donulur" },
  { re: /unterschrift|scheidung/i, emotion: "sakin yikici kararlilik" },
  { re: /hochzeit/i, emotion: "flashback kirikligi (dugun ↔ simdi)" },
  { re: /neue liebe/i, emotion: "yeni askla guvenli sogukluk" },
  { re: /schrie|schrei|raus hier/i, emotion: "bagirmaya yakin ofke (patlama esigi)" },
  { re: /ekel|veracht/i, emotion: "igrenme / tiksinti bakisi" },
  { re: /erwischt|zittert/i, emotion: "yakalanmis panik" },
  { re: /erstarrt|konnte nicht glauben/i, emotion: "ihanet soku (donup kalma)" },
  { re: /scham|skandal/i, emotion: "utanc / kamusal rezalet kizarmasi" },
  { re: /arrogant|spott/i, emotion: "kibirli kucumseme" },
  { re: /erleichtert|tiefe atem/i, emotion: "yukun kalkmasi (rahatlama)" },
  { re: /zweite chance|verzeih/i, emotion: "ikinci sans aciliyeti" },
];

const STILL_NO_TEXT =
  "[SABIT KURAL — ALTYAZI YOK] Absolute rule: zero written characters, zero typography, zero numbers on signs, zero captions, subtitles, watermarks, logos, UI, phone-screen messages, or posters with readable words.";

/** Kisa NetShort kare DNA — hikaye/güç romanini kareye yigmaz (8000 limiti). */
const STILL_NETSHORT_DNA = [
  "[NETSHORT STILL]",
  "16:9 cinematic live-action freeze of ONE moment IN A REAL PLACE — a scene, not a portrait.",
  "The location must be recognizable in frame. Forbidden: identity headshot, passport photo, catalog pose, character sheet, two-panel front/back turnaround, gray studio backdrop, blank wall behind a single face.",
  "Luxury sedan / glass office / boutique / wedding flashback vs cold present / kitchen keys / wet night street.",
  "Adult women 23-28: everyday neighbor faces; light short dress or mini, slightly open neckline, no office-modest, no clubwear. No ethnic type labels.",
  "Adult men: clearly male — male face and build, short hair, shirt/jacket/tee and trousers. The women's wardrobe rule above NEVER applies to a man.",
  "Humiliation, look-down dominance, status crush or cold return must read on faces.",
  "Slap, shove, slammed door OK. No blood, weapons, bed, minors.",
].join(" ");

function joinStillBlocks(parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => Boolean(p && String(p).trim()))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function longformStoryPhase(index: number, total: number): LongformStoryPhase {
  const n = Math.max(1, total);
  const t = Math.max(0, index) / n;
  if (t < 0.18) return "humiliation";
  if (t < 0.32) return "decision";
  if (t < 0.5) return "fall";
  if (t < 0.72) return "rise";
  if (t < 0.88) return "return";
  return "regret";
}

function stripNameTitle(raw: string): string {
  const parts = raw.replace(/\s+/g, " ").trim().split(" ");
  if (parts.length >= 2 && NAME_TITLE_PREFIX.has(parts[0].toLowerCase())) {
    return parts.slice(1).join(" ");
  }
  return parts.join(" ");
}

/** Kerem'in / Duru’nun → Kerem / Duru */
export function stripTurkishPossessive(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/['’](?:n?[ıiuüİI]n|n?[ıiuüİI]m|n?[ıiuüİI])$/iu, "");
}

function foldNameKey(name: string): string {
  return name.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

function isInflectedStopWord(key: string): boolean {
  for (const suffix of NAME_CASE_SUFFIXES) {
    if (key.length - suffix.length < 3 || !key.endsWith(suffix)) continue;
    if (NAME_STOP.has(key.slice(0, -suffix.length))) return true;
  }
  return false;
}

/** Duru/Aslı/Hakan gibi sik isimler sozlukte; aksi halde -a/-e disi erkek. */
export function guessTurkishGivenNameGender(name: string): "male" | "female" {
  const locale = inferLocaleGivenNameGender(name);
  if (locale) return locale;
  const key = foldNameKey(stripTurkishPossessive(stripNameTitle(name)).trim());
  if (FEMALE_GIVEN_NAMES.has(key)) return "female";
  if (MALE_GIVEN_NAMES.has(key)) return "male";
  if (FEMALE_NAME_SUFFIX_RE.test(key)) return "female";
  if (/a$|e$|ye$/i.test(key) && !/emre|caner|efe|ali|veli|nuri$/i.test(key)) return "female";
  return "male";
}

/** Cumle basi nesne/zamirleri ozel isim sanma. */
export function isLikelyPersonName(raw: string): boolean {
  const name = stripTurkishPossessive(stripNameTitle(raw));
  const key = foldNameKey(name);
  if (key.length < 3 || key.length > 24) return false;
  if (NAME_STOP.has(key) || NAME_TITLE_PREFIX.has(key) || isInflectedStopWord(key)) return false;
  if (/^(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar)$/i.test(name)) return false;
  if (!/^[\p{L}][\p{L}'’\-]+$/u.test(name)) return false;
  return true;
}

/**
 * CUMLE BASI BUYUK HARF ISIM KANITI DEGIL.
 * "Kısa bir süre sonra…" / "Yüzüm yandı." gibi cumleler, taninmayan kelimeleri
 * kadroya sokuyordu (Kısa ve Yüz icin karakter sayfasi bile uretildi). Bilinen
 * ad listesinde olmayan bir kelime, ancak CUMLE ICINDE en az iki kez buyuk
 * harfle geciyorsa isim sayilir.
 */
export function extractProperNames(text: string): string[] {
  const re = /\p{Lu}[\p{L}'’]{2,}(?:\s+\p{Lu}[\p{L}'’]{2,})?/gu;
  const counts = new Map<string, number>();
  const midSentence = new Map<string, number>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = stripTurkishPossessive(stripNameTitle(match[0]));
    if (!isLikelyPersonName(name)) continue;
    const canonical = [...counts.keys()].find((k) => foldNameKey(k) === foldNameKey(name)) || name;
    counts.set(canonical, (counts.get(canonical) || 0) + 1);
    const before = text.slice(0, match.index).replace(/["'“”«»(\s]+$/u, "");
    const sentenceStart = before.length === 0 || /[.!?…:;\n—-]$/u.test(before);
    if (!sentenceStart) midSentence.set(canonical, (midSentence.get(canonical) || 0) + 1);
  }
  const isKnownGiven = (name: string) => {
    const key = foldNameKey(name);
    return FEMALE_GIVEN_NAMES.has(key) || MALE_GIVEN_NAMES.has(key);
  };
  return [...counts.entries()]
    .filter(([name]) => isKnownGiven(name) || (midSentence.get(name) ?? 0) >= 2)
    .sort((a, b) => {
      const ak = isKnownGiven(a[0]) ? 1 : 0;
      const bk = isKnownGiven(b[0]) ? 1 : 0;
      if (bk !== ak) return bk - ak;
      return b[1] - a[1] || a[0].localeCompare(b[0], "tr");
    })
    .map(([name]) => name)
    .slice(0, 12);
}

export function extractLocationCue(text: string, previous?: string, speechLanguage?: string | null): string {
  for (const cue of LOCATION_CUES) {
    if (cue.re.test(text)) return cue.label;
  }
  return previous || defaultStillLocation(speechLanguage);
}

export function stillShotKind(narration: string, index: number, previousKind?: LongformStillShotKind): LongformStillShotKind {
  if (TEPKI_RE.test(narration) && !ETKI_RE.test(narration)) return "tepki";
  if (ETKI_RE.test(narration) && !TEPKI_RE.test(narration)) return "etki";
  if (previousKind === "etki") return "tepki";
  if (previousKind === "tepki") return "etki";
  return index % 2 === 0 ? "etki" : "tepki";
}

export function pickNetShortEmotion(input: {
  narration: string;
  phase: LongformStoryPhase;
  shotKind: LongformStillShotKind;
  index: number;
}): string {
  for (const row of KEYWORD_EMOTION) {
    if (row.re.test(input.narration)) return row.emotion;
  }
  const pool = PHASE_EMOTIONS[input.phase];
  if (input.shotKind === "tepki") {
    const reaction = pool.find((e) => /tepki|kiril|sok|pisman|asagilan/i.test(e)) || "etki sonrasi tepki (goz kırılması)";
    return reaction;
  }
  return pool[input.index % pool.length] || NETSHORT_EMOTIONS[0];
}

function peopleOnBeat(
  narration: string,
  roster: string[],
  previousPeople: string[],
  leadName?: string
): string[] {
  const cleanRoster = [...new Set(roster.map((n) => stripTurkishPossessive(n).trim()).filter(isLikelyPersonName))];
  if (leadName && isLikelyPersonName(leadName) && !cleanRoster.some((n) => n.toLowerCase() === leadName.toLowerCase())) {
    cleanRoster.unshift(leadName.trim());
  }
  const members = cleanRoster.map((name) => ({ name, storyRole: "" }));
  const names: string[] = [];
  const push = (value: string | undefined) => {
    const n = value?.trim();
    if (!n || names.some((x) => x.toLowerCase() === n.toLowerCase())) return;
    names.push(n);
  };

  if (members.length > 0) {
    for (const m of onScreenCastForClipBeat(narration, members, previousPeople.join(" "))) push(m.name);
  } else {
    for (const n of extractProperNames(narration)) push(n);
  }

  if (leadName && mentionsFirstPerson(narration)) push(leadName.trim());

  if (names.length > 0) return names.slice(0, 4);

  if (previousPeople.length > 0) {
    const fakePrev = previousPeople.map((name) => ({ name }));
    const carried = findCastInText(narration, fakePrev);
    if (carried.length > 0) return carried.map((m) => m.name).slice(0, 4);
    if (/(?:^|[^\p{L}\p{N}])(o|onu|ona|onun)(?:$|[^\p{L}\p{N}])/iu.test(narration)) {
      return previousPeople.slice(0, 4);
    }
  }

  // Kadro varsa bos oda yerine en az bir yuz: onceki kare veya lead/ilk iki isim.
  if (cleanRoster.length > 0) {
    if (previousPeople.length > 0) return previousPeople.slice(0, 2);
    if (leadName && isLikelyPersonName(leadName)) return [leadName.trim()];
    return cleanRoster.slice(0, 2);
  }
  return [];
}

/**
 * Karedeki kisiyi cinsiyetiyle yazar: "Mert (adult man)".
 *
 * Isim tek basina yazildiginda Flow cinsiyeti tahmin ediyordu ve kadin
 * gardirop kilidi yuzunden ERKEKLERI de kadin ciziyordu (Ezgi + Mert ikisi de
 * kadin geldi). Kadro cinsiyeti varsa o, yoksa isim sezgisi kullanilir.
 */
function describePersonWithGender(name: string, castGenders?: Record<string, "male" | "female">): string {
  const clean = stripTurkishPossessive(name).trim();
  const fromCast = castGenders?.[foldNameKey(clean)];
  const gender = fromCast || guessTurkishGivenNameGender(clean);
  return `${clean} (adult ${gender === "female" ? "woman" : "man"})`;
}

function relationshipCue(narration: string): string {
  const bits: string[] = [];
  if (/sekreter|üçüncü|ucuncu|metres|sekretärin|sekretaerin/i.test(narration)) bits.push("third-person triangle: secretary/other woman preferred, spouse crushed");
  if (/kayınvalide|kayinvalide|aile|schwiegermutter/i.test(narration)) bits.push("family pressure / mother-in-law dominance");
  if (/koca|eşin|esin|kocam|eşim|ehemann|mein mann|meine frau/i.test(narration)) bits.push("married couple power crush");
  if (/yeni aşk|yeni ask|yanımda|kolunda|neue liebe/i.test(narration)) bits.push("status return with new partner on the arm");
  if (/ortak|imza|para|unterschrift|geld/i.test(narration)) bits.push("betrayal over money/signature");
  return bits.join("; ");
}

const EMOTION_DE: Record<string, string> = {
  "sakin yikici kararlilik": "kalte zerstörerische Entschlossenheit",
  "pismanlik bogulmasi (yalvarma)": "Reue, die erdrückt (Flehen)",
  "fiziksel ustunluk (itme, tokat, kapi carpma)": "körperliche Überlegenheit (Stoß, Ohrfeige, Türknall)",
  "tercih ani: gulus baskasina, sirt donulur": "Bevorzugung: Lächeln für jemand anderen",
  "flashback kirikligi (dugun ↔ simdi)": "gebrochenes Hochzeits-Flashback",
  "yeni askla guvenli sogukluk": "sichere Kälte mit neuer Liebe",
  "status zaferi (kontrollu gulus)": "Statussieg (kontrolliertes Lächeln)",
  "bagirmaya yakin ofke (patlama esigi)": "Wut kurz vor dem Schrei",
  "igrenme / tiksinti bakisi": "Ekel / verächtlicher Blick",
  "yakalanmis panik": "ertappte Panik",
  "ihanet soku (donup kalma)": "Verratsschock (erstarren)",
  "utanc / kamusal rezalet kizarmasi": "Scham / öffentlicher Skandal",
  "kibirli kucumseme": "hochmütige Verachtung",
  "yukun kalkmasi (rahatlama)": "Last fällt ab (Erleichterung)",
  "ikinci sans aciliyeti": "Dringlichkeit der zweiten Chance",
  "donuk asagilanma": "starre Demütigung",
  "etki sonrasi tepki (goz kırılması)": "Reaktion nach dem Schlag (Blick bricht)",
};

function localizeStillEmotion(emotion: string, speechLanguage?: string | null): string {
  if (speechLocaleTag(speechLanguage) !== "de") return emotion;
  return EMOTION_DE[emotion] || emotion;
}

function cuesFromNarration(narration: string): string {
  return narration
    .replace(/["""''«»]/g, "")
    .replace(/\([^)]{0,80}\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 18)
    .join(" ")
    .slice(0, 140);
}

/**
 * Belgesel turlerinde cagrilmaz. Drama slaytinda sinema NetShort kilidini kareye yazar.
 */
export function buildLongformNetShortStill(input: LongformStillBuildInput): LongformStillVisual {
  const phase = longformStoryPhase(input.index, input.total);
  const shotKind = stillShotKind(input.narration, input.index, input.previous?.shotKind);
  const emotionKey = pickNetShortEmotion({ narration: input.narration, phase, shotKind, index: input.index });
  const emotion = localizeStillEmotion(emotionKey, input.speechLanguage);
  const location = extractLocationCue(input.narration, input.previous?.location, input.speechLanguage);
  const people = peopleOnBeat(input.narration, input.roster || [], input.previous?.people || [], input.leadName);
  const who =
    people.length > 0
      ? `On-screen named adults (MUST be clearly visible, faces in frame, max 4): ${people
          .map((name) => describePersonWithGender(name, input.castGenders))
          .join(", ")}. [GENDER LOCK] Each person's gender is exactly as written above — a name marked "adult man" is a MAN (male face, male body, male clothes) and a name marked "adult woman" is a WOMAN. Never turn one into the other, never make everyone the same gender. Empty interiors or object-only still-lifes without these people are forbidden. Do not invent extra faces.`
      : "1–2 adult faces matching the spoken beat MUST be clearly visible (MCU/two-shot); no empty room, no crowd party.";
  const samePlace = input.previous
    ? input.previous.location === location
      ? `CONTINUITY LOCK: same location (${location}), same wardrobe palette, same hair, same practical lighting and time of day as the previous still. Match-on-action freeze — the next frame of the SAME short-drama, not a new photoshoot.`
      : `Location moves to: ${location}. CONTINUITY LOCK: keep the SAME wardrobe palette, hair and time of day as the previous still unless the narration itself changes them — same film, new set.`
    : `Location: ${location}. Establish the wardrobe palette, hair and practical lighting that every following still will keep.`;
  // Sahne gorunsun: "portre gibi tek yuz" karesi kullanicinin bildirdigi
  // hatanin ta kendisiydi (kare, karakter fotosu gibi geliyordu).
  const framing =
    shotKind === "etki"
      ? "ETKI still: the ACTION of this beat — paper/key/phone offered, smile toward someone else, door, slap/shove (no blood), walking out. Hands + object required. Frame it as a MEDIUM shot or two-shot: the room and the action must both be readable. A face-only headshot is a FAIL."
      : "TEPKI still: the REACTION — eyes, jaw, breath, turning away, face falling. MCU or over-the-shoulder of the person who just got hit by the last action; keep the room visible behind them (soft, not empty). Not a studio portrait, not a blank-wall headshot.";
  const rel = relationshipCue(input.narration);
  const cues = cuesFromNarration(input.narration);

  const city = input.filmCity ?? filmCityFor(input.speechLanguage, input.narration);
  const imagePrompt = joinStillBlocks([
    FLOW_FICTIONAL_PERSON_LOCK,
    realityLockBlock({
      world: `present-day ${city.city}, ${city.country}, the same real city every frame`,
      crowd: `${city.city} residents`,
      hasReferences: true,
      still: true,
    }),
    speechStillWorldLock(input.speechLanguage, city.city),
    [
      "[STILL BEAT]",
      `STORY PHASE: ${phase}.`,
      framing,
      samePlace,
      who,
      rel ? `RELATIONSHIP / POWER: ${rel}.` : "POWER PICTURE: humiliation, look-down, status crush or cold revenge must read in the freeze.",
      netShortFlowEmotionCue(emotion),
      cues ? `Physical beat (objects and place only, never as written words): ${cues}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    STILL_NETSHORT_DNA,
    /cinematic NetShort short-drama still/i.test(input.visualLock) ? "" : input.visualLock,
    "Do not paint speech, quotes, names or letters on the picture.",
    STILL_NO_TEXT,
  ]);

  const sceneDescription = [emotion, shotKind, location, people.join(", ") || "mekan"].filter(Boolean).join(" · ");

  return {
    imagePrompt,
    mood: emotion,
    emotion,
    sceneDescription,
    location,
    people,
    shotKind,
    phase,
  };
}

export function buildLongformBeatVisuals(
  drafts: Array<{ narration: string }>,
  options: {
    visualLock: string;
    genreId: string;
    storyText?: string;
    roster?: string[];
    leadName?: string;
    /** Kadro cinsiyetleri (isim -> male/female); karedeki kisiler buna gore yazilir. */
    castGenders?: Record<string, "male" | "female">;
    speechLanguage?: string | null;
    /** Sabit tohum (proje kimligi): yeniden kurulumda da ayni sehir. */
    filmSeed?: string;
  }
): LongformStillVisual[] {
  const filmCity = filmCityFor(
    options.speechLanguage,
    options.filmSeed || options.storyText || drafts.map((d) => d.narration).join(" ").slice(0, 400),
    options.storyText || ""
  );
  if (!isLongformDramaGenre(options.genreId)) {
    return drafts.map((d) => {
      const cues = cuesFromNarration(d.narration);
      const imagePrompt = joinStillBlocks([
        realityLockBlock({
          world: `present-day ${filmCity.city}, ${filmCity.country}`,
          crowd: `${filmCity.city} residents`,
          still: true,
        }),
        "[STILL BEAT] Documentary freeze matching this spoken moment. Objects and place only; no crowd.",
        options.visualLock,
        cues ? `Physical scene (never as written words): ${cues}.` : "",
        "Do not paint speech, quotes, or letters. Adult figures only if implied; no minors.",
        STILL_NO_TEXT,
      ]);
      return {
        imagePrompt,
        mood: "documentary",
        emotion: "documentary",
        sceneDescription: "documentary",
        location: "",
        people: [],
        shotKind: "etki" as const,
        phase: "fall" as const,
      };
    });
  }

  const roster = (options.roster?.length ? options.roster : extractProperNames(options.storyText || drafts.map((d) => d.narration).join(" ")))
    .map((n) => stripTurkishPossessive(n))
    .filter(isLikelyPersonName);
  const out: LongformStillVisual[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const prev = out[i - 1];
    out.push(
      buildLongformNetShortStill({
        narration: drafts[i].narration,
        index: i,
        total: drafts.length,
        visualLock: options.visualLock,
        genreId: options.genreId,
        roster,
        leadName: options.leadName,
        castGenders: options.castGenders,
        speechLanguage: options.speechLanguage,
        previous: prev ? { location: prev.location, people: prev.people, emotion: prev.emotion, shotKind: prev.shotKind } : null,
        filmCity,
      })
    );
  }
  return out;
}

/** Karede kadro sheet'lerini esle — Flow'a en fazla 3 referans. */
export function collectStillReferenceSheets<
  T extends { name: string; role?: string | null; referenceImagePath: string | null },
>(input: {
  cast: T[];
  people: string[];
  narration: string;
  sceneDescription?: string | null;
  imagePrompt?: string | null;
  leadName?: string;
}): { sheetPaths: string[]; selectedNames: string[]; missingNames: string[] } {
  const ordered: T[] = [];
  const push = (member: T | undefined) => {
    if (!member || ordered.some((x) => x.name === member.name)) return;
    ordered.push(member);
  };
  for (const name of input.people) {
    const key = stripTurkishPossessive(name).trim().toLowerCase();
    if (!key) continue;
    push(
      input.cast.find((c) => stripTurkishPossessive(c.name).trim().toLowerCase() === key) ||
        input.cast.find((c) => c.name.trim().split(/\s+/)[0]?.toLowerCase() === key)
    );
  }
  for (const member of findCastInText(
    `${input.narration}\n${input.sceneDescription || ""}\n${input.imagePrompt || ""}`,
    input.cast
  )) {
    push(member);
  }
  if (input.leadName && mentionsFirstPerson(input.narration)) {
    const leadKey = input.leadName.trim().toLowerCase();
    push(
      input.cast.find((c) => c.name.trim().toLowerCase() === leadKey) ||
        input.cast.find((c) => c.role === "main")
    );
  }
  if (ordered.length === 0) {
    const main = input.cast.find((c) => c.role === "main");
    if (main) push(main);
    for (const member of input.cast.filter((c) => c.role !== "main").slice(0, 2)) push(member);
  }

  const sheetPaths: string[] = [];
  const selectedNames: string[] = [];
  const missingNames: string[] = [];
  for (const member of ordered.slice(0, 3)) {
    const path = member.referenceImagePath?.trim();
    if (path) {
      sheetPaths.push(path);
      selectedNames.push(member.name.trim() || "karakter");
    } else if (member.name.trim()) {
      missingNames.push(member.name.trim());
    }
  }
  return { sheetPaths, selectedNames, missingNames };
}


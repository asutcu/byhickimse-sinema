/**
 * Zaman Yolcusu formati — istemci ve sunucu ortak ayarlari.
 * Sunucu kameraya konusur (selfie vlog), yol arkadasi hayvan her klipte ayni,
 * cevredeki herkes secilen donemden.
 */

export type TimeTravelShot = "tt_selfie" | "tt_local" | "tt_pov" | "tt_wide";

export const TIME_TRAVEL_SHOTS: Array<{ id: TimeTravelShot; label: string; hint: string }> = [
  { id: "tt_selfie", label: "Selfie konuşma", hint: "Sunucu kameraya konuşur" },
  { id: "tt_local", label: "Yerliyle sahne", hint: "Sunucu + dönem yerlisi" },
  { id: "tt_pov", label: "Göz hizası", hint: "Sunucunun gözünden, dış ses" },
  { id: "tt_wide", label: "Geniş plan", hint: "Dönemin genel görüntüsü, dış ses" },
];

export { FLOW_PROJECT_URL_EXAMPLE, normalizeFlowProjectUrl } from "@/lib/flow-project-url";

/** Sureye gore en fazla kac yerli: her yerli ayri referans gorseli (Flow kredisi) ister. */
export function timeTravelLocalLimit(targetDurationSeconds: number): number {
  const minutes = Math.max(0, targetDurationSeconds) / 60;
  if (minutes <= 1.5) return 2;
  if (minutes <= 3.5) return 3;
  if (minutes <= 7) return 4;
  return Math.min(8, 4 + Math.floor((minutes - 7) / 3) + 1);
}

export function isTimeTravelShot(value: string | null | undefined): value is TimeTravelShot {
  return TIME_TRAVEL_SHOTS.some((s) => s.id === value);
}

/** Sunucunun agzi kadrajda mi (dudak senkronu)? */
export function isOnCameraShot(shot: string | null | undefined): boolean {
  return shot === "tt_selfie" || shot === "tt_local";
}

export function timeTravelShotLabel(shot: string | null | undefined): string {
  return TIME_TRAVEL_SHOTS.find((s) => s.id === shot)?.label ?? "Selfie konuşma";
}

export interface TimeTravelStop {
  time: string;
  location: string;
  happening: string;
  facts: string[];
}

export interface TimeTravelLocal {
  name: string;
  role: string;
  gender: "male" | "female";
  look: string;
}

export interface TimeTravelFamousFigure {
  name: string;
  role: string;
  staging: string;
}

/** Konu arastirmasi: senaryo, cekim plani ve Flow dunyasi buna dayanir. */
export interface TimeTravelResearch {
  topic: string;
  title: string;
  era: string;
  place: string;
  /** Flow promptlari icin Ingilizce karsiliklar ("AD 79, the morning before..."); eski dosyalarda bos. */
  eraEnglish: string;
  placeEnglish: string;
  summary: string;
  hostAngle: string;
  stops: TimeTravelStop[];
  locals: TimeTravelLocal[];
  famousFigures: TimeTravelFamousFigure[];
  visualWorld: string;
  allowedTech: string;
  anachronisms: string[];
  cautions: string[];
  thumbnailText: string;
  sources: Array<{ title: string; url: string }>;
  webSearched: boolean;
  researchedAt: string;
}

export interface TimeTravelSettings {
  era: string;
  place: string;
  hostName: string;
  hostGender: "female" | "male";
  hostAge: number;
  hostLook: string;
  hostWardrobe: string;
  hostVoice: string;
  companionEnabled: boolean;
  companionSpecies: string;
  companionName: string;
  companionLook: string;
  thumbnailText: string;
  musicFileName: string;
  research: TimeTravelResearch | null;
}

export const DEFAULT_TIME_TRAVEL_SETTINGS: TimeTravelSettings = {
  era: "MÖ 2560, Keops Piramidi inşa edilirken",
  place: "Gize, Antik Mısır",
  hostName: "Defne",
  hostGender: "female",
  hostAge: 27,
  hostLook: "long dark wavy hair, warm brown eyes, natural friendly face, light everyday makeup, expressive curious smile",
  hostWardrobe:
    "fitted white short-sleeve cotton t-shirt, light-wash denim shorts above the knee, brown leather crossbody bag, small gold crescent-and-star necklace, white canvas sneakers",
  hostVoice: "warm, curious, energetic young Turkish woman; friendly vlogger tone",
  companionEnabled: true,
  companionSpecies: "kedi",
  companionName: "Susam",
  companionLook: "small orange tabby kitten with a white chest and white paws, big amber eyes, soft short fur",
  thumbnailText: "",
  musicFileName: "",
  research: null,
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Web aramasinin metne gomdugu "([site](url))" atiflarini ve "ENGLISH:" onekini temizler. */
export function cleanResearchText(value: string): string {
  return value
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .replace(/^\s*(?:ENGLISH|IN ENGLISH|TURKCE|TÜRKÇE)\s*:\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url.trim();
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? cleanResearchText(value) : "";
}

function strList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .map((v) => cleanResearchText(v))
        .filter((v) => v.length > 0)
        .slice(0, max)
    : [];
}

function objList(value: unknown, max: number): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object").slice(0, max)
    : [];
}

/** Flow'a giden donem + yer: Ingilizce karsilik varsa o (Veo Ingilizceyi daha iyi okur). */
export function timeTravelWorldForFlow(s: TimeTravelSettings): string {
  // Kullanici donem/yeri elle degistirdiyse arastirmanin Ingilizcesi artik o yeri anlatmaz.
  const r = s.research;
  const eraEn = r?.eraEnglish && r.era.trim() === s.era.trim() ? r.eraEnglish : "";
  const placeEn = r?.placeEnglish && r.place.trim() === s.place.trim() ? r.placeEnglish : "";
  return [eraEn || s.era, placeEn || s.place].filter(Boolean).join(", ");
}

/** Disaridan (OpenAI / veritabani) gelen arastirmayi guvenli bicime getirir; bossa null. */
export function normalizeTimeTravelResearch(raw: unknown): TimeTravelResearch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const stops = objList(r.stops, 14)
    .map((s) => ({
      time: text(s.time),
      location: text(s.location),
      happening: text(s.happening),
      facts: strList(s.facts, 6),
    }))
    .filter((s) => s.location || s.happening);
  const era = text(r.era);
  const place = text(r.place);
  if (!era && !place && stops.length === 0) return null;
  const sources: Array<{ title: string; url: string }> = [];
  for (const s of objList(r.sources, 16)) {
    const url = cleanUrl(str(s.url, ""));
    if (!/^https?:\/\//i.test(url) || sources.some((x) => x.url === url)) continue;
    sources.push({ title: text(s.title) || url, url });
  }
  return {
    topic: text(r.topic),
    title: text(r.title),
    era,
    place,
    eraEnglish: text(r.eraEnglish),
    placeEnglish: text(r.placeEnglish),
    summary: text(r.summary),
    hostAngle: text(r.hostAngle),
    stops,
    locals: objList(r.locals, 8)
      .map((l) => ({
        name: text(l.name),
        role: text(l.role),
        gender: (l.gender === "male" ? "male" : "female") as "male" | "female",
        look: text(l.look),
      }))
      .filter((l) => l.name),
    famousFigures: objList(r.famousFigures, 8)
      .map((f) => ({ name: text(f.name), role: text(f.role), staging: text(f.staging) }))
      .filter((f) => f.name),
    visualWorld: text(r.visualWorld),
    allowedTech: text(r.allowedTech),
    anachronisms: strList(r.anachronisms, 16),
    cautions: strList(r.cautions, 8),
    thumbnailText: text(r.thumbnailText),
    sources: sources.slice(0, 12),
    webSearched: r.webSearched === true,
    researchedAt: str(r.researchedAt, ""),
  };
}

/** Kullanicinin konu fikri icin kategori listesi (Fikir oner). */
export const TIME_TRAVEL_IDEA_CATEGORIES = [
  "Antik uygarlıklar",
  "Osmanlı dönemi",
  "Türkiye tarihi",
  "Dünya tarihinin dönüm noktaları",
  "Felaketler ve kazalar",
  "Keşifler, bilim ve icatlar",
  "Yakın tarih (1950–2005)",
  "Sıradan bir gün",
] as const;

export function parseTimeTravelSettings(raw: string | null | undefined): TimeTravelSettings {
  let data: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  const d = DEFAULT_TIME_TRAVEL_SETTINGS;
  const age = Number(data.hostAge);
  return {
    era: str(data.era, d.era),
    place: str(data.place, d.place),
    hostName: str(data.hostName, d.hostName),
    hostGender: data.hostGender === "male" ? "male" : "female",
    hostAge: Number.isFinite(age) && age >= 18 && age <= 80 ? Math.round(age) : d.hostAge,
    hostLook: str(data.hostLook, d.hostLook),
    hostWardrobe: str(data.hostWardrobe, d.hostWardrobe),
    hostVoice: str(data.hostVoice, d.hostVoice),
    companionEnabled: typeof data.companionEnabled === "boolean" ? data.companionEnabled : d.companionEnabled,
    companionSpecies: str(data.companionSpecies, d.companionSpecies),
    companionName: str(data.companionName, d.companionName),
    companionLook: str(data.companionLook, d.companionLook),
    thumbnailText: str(data.thumbnailText, d.thumbnailText),
    musicFileName: str(data.musicFileName, d.musicFileName),
    research: normalizeTimeTravelResearch(data.research),
  };
}

export function serializeTimeTravelSettings(settings: Partial<TimeTravelSettings>): string {
  return JSON.stringify({ ...DEFAULT_TIME_TRAVEL_SETTINGS, ...settings });
}

/** Secilen ture hazir gorunum (Ingilizce, Flow icin). Tur degisince form bunu doldurur. */
export const COMPANION_LOOK_PRESETS: Record<string, string> = {
  kedi: "small orange tabby kitten with a white chest and white paws, big amber eyes, soft short fur",
  köpek: "small fluffy golden-brown puppy with floppy ears, a white blaze on the chest, bright dark eyes",
  papağan: "small bright green parrot with a yellow face, blue-tipped wing feathers, a curved pale beak and dark round eyes",
  tavşan: "small fluffy white rabbit with light gray ear tips, a pink nose and dark round eyes",
  tilki: "young red fox with a bushy white-tipped tail, black legs, amber eyes and a slim pointed face",
  baykuş: "small tawny owl with mottled brown-and-cream feathers, round face disc and large dark eyes",
};

const ANIMAL_WORDS: Record<string, RegExp> = {
  cat: /\b(cat|cats|kitten|kitty|tabby|feline)\b/i,
  dog: /\b(dog|dogs|puppy|pup|canine)\b/i,
  parrot: /\b(parrot|macaw|budgie|parakeet|cockatoo|bird|feathers?|beak)\b/i,
  rabbit: /\b(rabbit|bunny|hare)\b/i,
  fox: /\b(fox|vixen)\b/i,
  owl: /\b(owl|owlet)\b/i,
};

/** Hazir tarif yoksa ture gore genel bir gorunum. */
export function companionLookFor(species: string): string {
  const key = species.trim().toLocaleLowerCase("tr-TR");
  return COMPANION_LOOK_PRESETS[key] || `small friendly ${companionSpeciesForFlow(species)} with natural colors and bright eyes`;
}

/**
 * Gorunum metni secilen turle celisiyorsa (papagan secili, metin "kitten" diyor) veya bossa
 * turun tarifini dondurur — aksi halde Flow metindeki hayvani cizer (papagan yerine kedi).
 */
export function resolveCompanionLook(species: string, look: string | null | undefined): string {
  const text = (look || "").trim();
  if (!text) return companionLookFor(species);
  const target = companionSpeciesForFlow(species).toLowerCase();
  for (const [animal, re] of Object.entries(ANIMAL_WORDS)) {
    if (animal !== target && re.test(text) && !(ANIMAL_WORDS[target]?.test(text) ?? false)) {
      return companionLookFor(species);
    }
  }
  return text;
}

/** Sunucu icin cesitli hazir gorunumler: her yeni yolculuk ayni yuzle baslamasin. */
export const HOST_LOOK_PRESETS: Record<"female" | "male", string[]> = {
  female: [
    "long dark wavy hair, warm brown eyes, natural friendly face, light everyday makeup, expressive curious smile",
    "shoulder-length chestnut hair with soft bangs, hazel eyes, freckles across the nose, bright open smile",
    "sleek black hair in a high ponytail, dark almond eyes, defined brows, warm olive skin, confident grin",
    "curly auburn hair tied loosely back, green eyes, light skin with a few freckles, playful smile",
    "short wavy light-brown bob, gray-blue eyes, soft round face, natural makeup, friendly expression",
    "long straight honey-blonde hair, brown eyes, sun-kissed skin, small dimples, energetic smile",
  ],
  male: [
    "short dark brown hair with a neat fade, brown eyes, light stubble, friendly face, curious grin",
    "wavy black hair pushed back, dark eyes, trimmed beard, warm olive skin, confident smile",
    "short sandy-blond hair, blue-gray eyes, clean-shaven, freckled nose, easygoing smile",
    "curly dark hair, hazel eyes, short boxed beard, broad friendly face, expressive eyebrows",
    "buzz-cut light-brown hair, green eyes, angular jaw with light stubble, warm smile",
  ],
};

/** Yazlik, acik gunluk kiyafetler (tum bolum boyunca sabit kalir). */
export const HOST_WARDROBE_PRESETS: Record<"female" | "male", string[]> = {
  female: [
    "fitted white short-sleeve cotton t-shirt, light-wash denim shorts above the knee, brown leather crossbody bag, small gold crescent-and-star necklace, white canvas sneakers",
    "sleeveless sage-green linen top, high-waisted beige shorts, tan leather crossbody bag, thin silver necklace, white sneakers",
    "white ribbed tank top, light-blue denim mini skirt, small brown crossbody bag, gold hoop earrings, flat leather sandals",
    "short yellow floral sundress with thin straps, straw crossbody bag, delicate gold necklace, white canvas sneakers",
    "coral cropped short-sleeve tee, white high-waisted shorts, woven straw bag, beaded bracelet, strappy tan sandals",
    "light-blue sleeveless button-up linen top, cream linen shorts, small tan backpack, silver anklet, white slip-on sneakers",
    "black spaghetti-strap tank top, olive cargo shorts, brown leather belt bag, thin gold chain, white chunky sneakers",
  ],
  male: [
    "plain white crew-neck t-shirt, khaki cargo shorts, brown leather crossbody bag, white canvas sneakers",
    "short-sleeve navy linen shirt, beige chino shorts, small canvas backpack, leather bracelet, gray sneakers",
    "olive-green short-sleeve henley, light denim shorts, brown sling bag, silver chain necklace, white sneakers",
    "white sleeveless tank top, light-gray drawstring shorts, black belt bag, braided leather bracelet, slide sandals",
    "open short-sleeve Hawaiian-print shirt over a white tee, tan chino shorts, canvas crossbody bag, white sneakers",
    "sky-blue short-sleeve polo, white linen shorts, brown leather sling bag, thin leather wristband, leather sandals",
  ],
};

export const HOST_VOICE_PRESETS: Record<"female" | "male", string> = {
  female: "warm, curious, energetic young woman; friendly vlogger tone",
  male: "warm, curious, energetic young man; friendly vlogger tone",
};

/** Deger hazir listeden mi (kullanici elle degistirmemis mi)? */
export function isHostPreset(value: string, kind: "look" | "wardrobe" | "voice"): boolean {
  const text = value.trim();
  if (!text) return true;
  if (kind === "voice") return Object.values(HOST_VOICE_PRESETS).includes(text) || text === DEFAULT_TIME_TRAVEL_SETTINGS.hostVoice;
  const lists = kind === "look" ? HOST_LOOK_PRESETS : HOST_WARDROBE_PRESETS;
  return [...lists.female, ...lists.male].includes(text);
}

/**
 * Cinsiyete uygun rastgele hazir gorunum + kiyafet + ses. Mevcut gorunum ve kiyafet tekrar
 * secilmez (her "Farklı görünüm öner" gozle gorulur degisiklik yapar). Elle yazilmis ses korunur.
 */
export function randomHostPreset(
  gender: "female" | "male",
  current: Partial<Pick<TimeTravelSettings, "hostLook" | "hostWardrobe" | "hostVoice">> = {}
): Pick<TimeTravelSettings, "hostLook" | "hostWardrobe" | "hostVoice"> {
  const pick = (list: string[], avoid = "") => {
    const options = list.filter((item) => item !== avoid.trim());
    return options[Math.floor(Math.random() * options.length)] ?? list[0];
  };
  const voice = current.hostVoice?.trim() ?? "";
  return {
    hostLook: pick(HOST_LOOK_PRESETS[gender], current.hostLook),
    hostWardrobe: pick(HOST_WARDROBE_PRESETS[gender], current.hostWardrobe),
    hostVoice: voice && !isHostPreset(voice, "voice") ? voice : HOST_VOICE_PRESETS[gender],
  };
}

/**
 * Sunucu cinsiyetiyle celisen HAZIR metinleri duzeltir (erkek secilip kadin hazir gorunumu
 * kalmissa). Kullanicinin elle yazdigi metne dokunulmaz.
 */
export function resolveHostPresets(s: TimeTravelSettings): Pick<TimeTravelSettings, "hostLook" | "hostWardrobe" | "hostVoice"> {
  const other = s.hostGender === "male" ? "female" : "male";
  const look = HOST_LOOK_PRESETS[other].includes(s.hostLook.trim()) || !s.hostLook.trim() ? HOST_LOOK_PRESETS[s.hostGender][0] : s.hostLook;
  const wardrobe =
    HOST_WARDROBE_PRESETS[other].includes(s.hostWardrobe.trim()) || !s.hostWardrobe.trim()
      ? HOST_WARDROBE_PRESETS[s.hostGender][0]
      : s.hostWardrobe;
  const voice =
    s.hostVoice.trim() === HOST_VOICE_PRESETS[other] || (s.hostGender === "male" && s.hostVoice.trim() === DEFAULT_TIME_TRAVEL_SETTINGS.hostVoice) || !s.hostVoice.trim()
      ? HOST_VOICE_PRESETS[s.hostGender]
      : s.hostVoice;
  return { hostLook: look, hostWardrobe: wardrobe, hostVoice: voice };
}

/** Turkce tur adini Ingilizce Flow tarifine cevirir (bilinmeyen tur oldugu gibi kalir). */
export function companionSpeciesForFlow(species: string): string {
  const key = species.trim().toLocaleLowerCase("tr-TR");
  const map: Record<string, string> = {
    kedi: "cat",
    "yavru kedi": "kitten",
    köpek: "dog",
    kopek: "dog",
    "yavru köpek": "puppy",
    papağan: "parrot",
    papagan: "parrot",
    tavşan: "rabbit",
    tavsan: "rabbit",
    tilki: "fox",
    baykuş: "owl",
    baykus: "owl",
    kaplumbağa: "tortoise",
    at: "horse",
    maymun: "monkey",
    gelincik: "ferret",
  };
  return map[key] || species.trim() || "cat";
}

/**
 * Gercek tarihi kisilerin adini gorsel tarifte unvana cevirir.
 * Flow "taninmis kisi" politikasina takilmasin; sozlu metin dokunulmaz.
 */
function nameRe(names: string[]): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${names.join("|")})(?!\\p{L})`, "giu");
}

const FAMOUS_FIGURES: Array<[RegExp, string]> = [
  [/(?<!\p{L})(?:Keops|Kheops|Khufu|Hufu)\s+Piramidi(?:'?n[iı]n|'?n[iı]|'?nde|'?ne)?(?!\p{L})/giu, "the Great Pyramid"],
  [/(?<!\p{L})(?:the\s+)?(?:Great\s+)?Pyramid\s+of\s+(?:Khufu|Keops|Kheops|Cheops)(?!\p{L})/giu, "the Great Pyramid"],
  [nameRe(["Keops", "Kheops", "Khufu", "Hufu", "Cheops"]), "the pharaoh"],
  [
    nameRe(["Tutankamon", "Tutankhamun", "Tutankhamen", "Ramses", "Ramesses", "Nefertiti", "Kleopatra", "Cleopatra", "Hatşepsut", "Hatshepsut"]),
    "the royal figure",
  ],
  [nameRe(["Julius Caesar", "Jül Sezar", "Sezar", "Caesar", "Augustus", "Neron", "Nero"]), "the Roman ruler"],
  [nameRe(["Büyük İskender", "İskender", "Iskender", "Alexander the Great"]), "the young king"],
  [nameRe(["Fatih Sultan Mehmet", "Kanuni Sultan Süleyman", "Kanuni", "Yavuz Sultan Selim", "Osman Gazi"]), "the sultan"],
  [nameRe(["Atatürk", "Mustafa Kemal"]), "the commander"],
  [nameRe(["Napolyon", "Napoleon"]), "the emperor"],
  [nameRe(["Leonardo da Vinci", "Da Vinci", "Mimar Sinan", "Galileo", "Newton", "Einstein"]), "the master"],
];

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sabit listeye ek olarak arastirmanin buldugu unlu kisileri de unvanina cevirir
 * (or. "Osman Bey" → "the bey"). Sozlu metinde kullanilmaz.
 */
export function softenFamousFiguresForFlow(
  text: string,
  extra: Array<Pick<TimeTravelFamousFigure, "name" | "role">> = []
): string {
  let out = text;
  for (const figure of extra) {
    const name = figure.name.trim();
    if (name.length < 3) continue;
    const title = figure.role.trim().replace(/^(?:the|a|an)\s+/i, "");
    const role = title ? `the ${title}` : "the historical figure";
    out = out.replace(new RegExp(`(?<!\\p{L})${escapeRe(name)}(?!\\p{L})`, "giu"), role);
  }
  for (const [re, role] of FAMOUS_FIGURES) out = out.replace(re, role);
  return out;
}

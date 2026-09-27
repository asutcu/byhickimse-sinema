import { z } from "zod";
import type { CharacterProfile } from "@prisma/client";
import { resolveCastGender } from "@/lib/turkish-given-name-gender";
import { appendFlowLocaleCast, localeNationalityLook } from "@/lib/speech-cast-locale";
import { prisma } from "@/server/db";

/**
 * Anlatici kadrosu: hikayedeki yan kisiler (ekrandaki yuzler).
 * Film sahne plani `narrator-film.ts` icindedir; anlatici kadini ekranda yoktur.
 */

export const castMemberSchema = z.object({
  name: z.string().min(1),
  storyRole: z.string().min(1),
  storyNote: z.string().default(""),
  gender: z.enum(["male", "female"]),
  age: z.number().int().min(18).max(75).default(30),
  build: z.string().min(3),
  hairDetail: z.string().min(5),
  eyeColor: z.string().min(3),
  skinTone: z.string().min(3),
  distinctFeature: z.string().default(""),
  accessories: z.string().default(""),
  appearancePrompt: z.string().min(20),
  wardrobePrompt: z.string().min(10),
  voiceNote: z.string().default(""),
});

export type CastMember = z.infer<typeof castMemberSchema>;

/** Gunluk hafif sehir kadini: kisa/acik yazlik — ofis muhafazakar ve kulup yok. */
export const NETSHORT_FEMALE_WARDROBE_DEFAULT =
  "Everyday light city clothes: a short summer dress or mini skirt with a thin blouse, slightly open neckline, bare arms and knees, simple sandals. Ordinary woman on a normal day — not a modest office suit, not clubwear, no lingerie, no nudity.";

export const NETSHORT_MALE_WARDROBE_DEFAULT =
  "Everyday city menswear: open-collar cotton shirt or plain crewneck, dark jeans or chinos, simple belt, clean sneakers or loafers — ordinary neighbor, not a fashion campaign.";

export const NETSHORT_FEMALE_HAIR_DEFAULT =
  "shoulder-length natural blonde or light-brown waves, softly styled, a few flyaways";

export const NETSHORT_FEMALE_FACE_DEFAULT =
  "Everyday neighbor face, slight asymmetry, little makeup — not a catalog model.";

/** Kadro icinde kiyafet rengi cesitliligi — ayni cinsiyetteki uyeler ayni renge dusmesin. */
const FEMALE_WARDROBE_COLORS = [
  "soft sage green",
  "deep burgundy",
  "warm camel",
  "dusty rose pink",
  "charcoal grey",
  "ivory cream",
  "navy blue",
  "terracotta orange",
  "muted lilac",
  "olive green",
] as const;

const MALE_WARDROBE_COLORS = [
  "navy blue",
  "charcoal grey",
  "olive green",
  "burgundy red",
  "slate blue",
  "camel tan",
  "forest green",
  "steel grey",
] as const;

/** Ayni isim her zaman ayni rengi alsin diye kararli (deterministic) sacma. */
function paletteIndexForKey(key: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return length > 0 ? hash % length : 0;
}

function coloredFemaleWardrobe(color: string): string {
  return `Everyday light clothes: a short ${color} summer dress or mini skirt with a thin top, slightly open neckline, bare arms, simple sandals. Ordinary woman on a normal day — not office-modest, not clubwear, no lingerie, no nudity.`;
}

function coloredMaleWardrobe(color: string): string {
  return `Everyday city menswear: a ${color} open-collar cotton shirt or plain crewneck, dark jeans or chinos, simple belt, clean sneakers or loafers — ordinary neighbor, not a fashion campaign.`;
}

const MODEST_WARDROBE_RE =
  /cardigan|hırka|hirka|blazer|coat|kaban|overcoat|trench|turtleneck|balikci|sweater|kazak|trouser|pantolon|slacks|suit jacket|modest office|muhafazakar|long sleeve blouse|maxi|ankle.?length|office suit|business suit|wool coat|hoodie/i;

const GLAM_WARDROBE_RE =
  /micro.?mini|bodycon|club dress|platform heel|party.?girl|semi-revealing|plunge|sky-high|satin crop|deep cleavage|crop top|lingerie/i;

const FEMALE_OK_WARDROBE_RE =
  /knee-length|reaches the knee|above.?the.?knee|above-knee|short dress|summer dress|mini skirt|mini etek|slightly open|light clothes|everyday light|skirt|dress/i;

/**
 * Kadin: 23-28, siradan komsu yuzu (ozgun kurgu — etnik "tip" YOK),
 * kisa/yazlik hafif kiyafet. Kulup/dekolte ve muhafazakar ofis ezilir.
 *
 * @param colorSeed Ayni cinsiyetteki kadro uyeleri arasinda kiyafet rengini
 *   ayirt etmek icin sirali bir indeks (0,1,2...). Verilmezse isimden
 *   turetilen kararli bir indekse duser — yine de FLAT/ayni renk yerine
 *   kisiye ozel bir renk secilmis olur.
 */
export function normalizeNetShortFemaleCast(member: CastMember, colorSeed?: number): CastMember {
  if (member.gender !== "female") return member;
  const preferredAge = !member.age || member.age < 23 ? 25 : Math.min(55, member.age);

  const hair = member.hairDetail?.trim() || NETSHORT_FEMALE_HAIR_DEFAULT;
  const rawWardrobe = member.wardrobePrompt || "";
  const colorIndex = colorSeed ?? paletteIndexForKey(member.name || "female", FEMALE_WARDROBE_COLORS.length);
  const fallbackWardrobe = coloredFemaleWardrobe(FEMALE_WARDROBE_COLORS[Math.abs(colorIndex) % FEMALE_WARDROBE_COLORS.length]);
  const wardrobe =
    MODEST_WARDROBE_RE.test(rawWardrobe) || GLAM_WARDROBE_RE.test(rawWardrobe) || !FEMALE_OK_WARDROBE_RE.test(rawWardrobe)
      ? fallbackWardrobe
      : rawWardrobe;

  const rawLook = member.appearancePrompt?.replace(/\s+/g, " ").trim() || "";
  const appearance = /everyday neighbor|ordinary adult|original (?:invented )?face/i.test(rawLook)
    ? rawLook
    : [NETSHORT_FEMALE_FACE_DEFAULT, rawLook].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  return {
    ...member,
    age: preferredAge,
    build: member.build?.trim() || "average slim adult build, natural posture",
    hairDetail: hair,
    wardrobePrompt: wardrobe,
    appearancePrompt: appearance,
    accessories: member.accessories?.trim() || "small gold stud earrings",
  };
}

/**
 * Erkek: gunluk sehir kiyafeti; smokin / slick kampanya ezilir.
 * @param colorSeed bkz. normalizeNetShortFemaleCast — kiyafet rengi cesitliligi icin.
 */
export function normalizeNetShortMaleCast(member: CastMember, colorSeed?: number): CastMember {
  if (member.gender !== "male") return member;
  const preferredAge =
    member.age && member.age >= 28 && member.age <= 48 ? Math.min(48, Math.max(28, member.age)) : 34;
  const rawWardrobe = member.wardrobePrompt || "";
  const colorIndex = colorSeed ?? paletteIndexForKey(member.name || "male", MALE_WARDROBE_COLORS.length);
  const fallbackWardrobe = coloredMaleWardrobe(MALE_WARDROBE_COLORS[Math.abs(colorIndex) % MALE_WARDROBE_COLORS.length]);
  const wardrobe = /tuxedo|smoking|evening suit|three-piece|slicked|fashion campaign|runway|perfume/i.test(
    rawWardrobe
  )
    ? fallbackWardrobe
    : rawWardrobe.trim() || fallbackWardrobe;
  return {
    ...member,
    age: preferredAge,
    build: member.build?.trim() || "average adult male build",
    wardrobePrompt: wardrobe,
    accessories: member.accessories?.trim() || "",
  };
}

/**
 * Yapisal alanlardan (cinsiyet, yas, yapi, sac, goz, ten, ayirt edici ozellik)
 * KESIN ve NET bir on-cumle kurup AI'nin appearancePrompt'unu buna ekler.
 * Boylece cinsiyet/sac/goz bilgisi modelin serbest metninin insafina birakilmaz;
 * her uretimde ayni ve celismesiz sekilde gorsel promptuna gecer.
 */
export function composeCastAppearance(member: CastMember, colorSeed?: number): string {
  const normalized =
    member.gender === "male"
      ? normalizeNetShortMaleCast(member, colorSeed)
      : normalizeNetShortFemaleCast(member, colorSeed);
  const genderWord = normalized.gender === "male" ? "MAN" : "WOMAN";
  const sex = normalized.gender === "male" ? "male" : "female";
  const lead = `A ${normalized.age}-year-old adult ${genderWord} (${sex}), ${normalized.build}. Hair: ${normalized.hairDetail}. Eyes: ${normalized.eyeColor}. Skin tone: ${normalized.skinTone}. Gender is ${sex}.`;
  const distinct = normalized.distinctFeature.trim() ? ` Distinguishing feature: ${normalized.distinctFeature.trim()}.` : "";
  const accessories = normalized.accessories.trim() ? ` Accessories: ${normalized.accessories.trim()}.` : "";
  const face = slimCastAppearancePrompt(normalized.appearancePrompt, normalized.gender);
  const text = `${lead}${distinct}${accessories} ${face}`.replace(/\s+/g, " ").trim();
  if (text.length <= 520) return text;
  return text.slice(0, 520).replace(/\s+\S*$/, "").trim();
}

/** Katalog / hanimefendi denemesini at; yuz + sac + goz kilitini kisa tut (8000 payi). */
export function slimCastAppearancePrompt(raw: string, gender: "male" | "female" = "female"): string {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  t = t
    .replace(/Adult (?:wo)?man about \d+:[\s\S]*/gi, "")
    .replace(/Naturally beautiful ladylike[^.]*\./gi, "")
    .replace(/A poised young woman[^.]*\./gi, "")
    .replace(/A mid-30s urban man[^.]*\./gi, "")
    .replace(/An original fictional person A [^.]*\./gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const lead = t.match(/^A \d+-year-old adult (?:WOMAN|MAN)\b[\s\S]{0,380}/i)?.[0]?.trim();
  const clipped = (lead || t).slice(0, 400);
  const core = (clipped.length < 400 ? clipped : clipped.replace(/\s+\S*$/, "")).trim();
  if (/everyday neighbor|ordinary neighbor/i.test(core)) return core.slice(0, 480);
  const face =
    gender === "male"
      ? "Everyday neighbor man, lived-in face, not a fashion campaign."
      : "Everyday neighbor face, slight asymmetry, natural skin, little makeup — not a catalog model.";
  return `${core} ${face}`.replace(/\s+/g, " ").trim().slice(0, 520);
}

export function everydayFemaleWardrobeForName(name: string, colorSeed?: number): string {
  const color =
    FEMALE_WARDROBE_COLORS[
      Math.abs(colorSeed ?? paletteIndexForKey(name || "female", FEMALE_WARDROBE_COLORS.length)) %
        FEMALE_WARDROBE_COLORS.length
    ];
  return coloredFemaleWardrobe(color);
}

function labeledBit(raw: string, label: string): string {
  const hit = String(raw || "").match(new RegExp(`${label}:\\s*([^.]{2,140})`, "i"));
  return hit?.[1]?.replace(/\s+/g, " ").trim() || "";
}

/** Kayitli gorunumden sac/goz/yas parcalarini ceker — katalog cumlesini atar. */
export function appearanceBitsFromPrompt(raw: string): {
  build: string;
  hair: string;
  eyes: string;
  skin: string;
  distinct: string;
  accessories: string;
  age: number | null;
} {
  const text = String(raw || "");
  const ageHit = text.match(/(\d{2})-year-old/i);
  const ageNum = ageHit ? Number(ageHit[1]) : NaN;
  return {
    build: text.match(/adult (?:WOMAN|MAN) \((?:fe)?male\),\s*([^.]+)\./i)?.[1]?.trim() || "",
    hair: labeledBit(text, "Hair"),
    eyes: labeledBit(text, "Eyes"),
    skin: labeledBit(text, "Skin tone") || labeledBit(text, "Skin"),
    distinct: labeledBit(text, "Distinguishing feature"),
    accessories: labeledBit(text, "Accessories"),
    age: Number.isFinite(ageNum) && ageNum >= 18 && ageNum <= 75 ? ageNum : null,
  };
}

/** Siradan komsu yuzleri — ozgun kurgu kisiler, etnik "tip" yok. */
const FEMALE_LOOKS = [
  {
    hair: "long golden-blonde soft waves past the shoulders, loose side part",
    eyes: "blue-grey",
    skin: "light complexion with a cool undertone",
    face: "oval face, slightly uneven brows, small beauty mark above the left mouth corner, little makeup — everyday neighbor",
    build: "slim everyday adult build",
  },
  {
    hair: "light ash-blonde straight hair just past the shoulders, softly tucked behind one ear",
    eyes: "grey-blue",
    skin: "light complexion",
    face: "heart-shaped face, slightly uneven brows, soft rose lips — everyday neighbor face",
    build: "slender everyday adult build",
  },
  {
    hair: "honey-blonde loose waves to mid-back, center part",
    eyes: "green",
    skin: "fair with a warm blush",
    face: "round-oval face, faint freckles across the nose, smile lines, little makeup — everyday neighbor",
    build: "soft everyday adult frame",
  },
  {
    hair: "light-brown layered lob touching the collarbone, sun-kissed strands",
    eyes: "grey-green",
    skin: "fair with a cool undertone",
    face: "long oval face, narrow chin, a tiny leftover freckle on the cheek — original invented face",
    build: "slender tall everyday frame",
  },
  {
    hair: "pale-blonde sleek hair in a soft half-up style",
    eyes: "blue-grey",
    skin: "light complexion",
    face: "soft square jaw, full upper lids, calm gaze — everyday neighbor, not a catalog model",
    build: "average adult, natural posture",
  },
  {
    hair: "strawberry-blonde soft waves past the shoulders",
    eyes: "blue-grey",
    skin: "light with a warm blush",
    face: "diamond face, wide gentle mouth, dimple on the left cheek, barely-there makeup — everyday neighbor",
    build: "slim adult, long neck",
  },
  {
    hair: "dark chestnut-brown straight hair to the collarbone, sharp center part",
    eyes: "hazel-green",
    skin: "warm olive with a golden undertone",
    face: "oval face, a faint scar through one eyebrow, tired confident gaze — everyday neighbor",
    build: "athletic slim adult build",
  },
  {
    hair: "auburn copper waves past the shoulders, side-swept fringe",
    eyes: "amber-brown",
    skin: "fair with visible freckles across the cheeks",
    face: "round face, upturned nose, gap between the front teeth when she smiles — everyday neighbor",
    build: "petite curvy adult frame",
  },
  {
    hair: "jet-black sleek bob just above the shoulders, blunt fringe",
    eyes: "dark brown",
    skin: "fair porcelain with a rosy undertone",
    face: "heart-shaped face, small mole under the right eye, little makeup — everyday neighbor",
    build: "slender adult, straight posture",
  },
  {
    hair: "dark blonde loose curls past the shoulders, deep side part",
    eyes: "hazel",
    skin: "light tan with a warm undertone",
    face: "soft oval face, a single dimple on the right cheek, gentle laugh lines — everyday neighbor",
    build: "average adult build, relaxed posture",
  },
] as const;

const MALE_LOOKS = [
  {
    hair: "short dark-brown textured crop, a bit messy on top",
    eyes: "dark brown",
    skin: "olive tan",
    face: "rectangular face, heavy brow, two-day stubble, tired eyelids",
    build: "average adult male build",
  },
  {
    hair: "black hair combed to the side, not gelled",
    eyes: "hazel",
    skin: "fair warm",
    face: "long face, thin nose, clean-shaven, a small nick on the chin",
    build: "lean tall everyday frame",
  },
  {
    hair: "salt-and-pepper short crop",
    eyes: "green-brown",
    skin: "medium tan",
    face: "square jaw, deep nasolabial lines, trimmed beard",
    build: "broad-shouldered ordinary adult",
  },
  {
    hair: "chestnut curls kept short on the sides",
    eyes: "amber",
    skin: "light olive",
    face: "round face, thick brows, no beard, slightly receding temples",
    build: "compact average build",
  },
  {
    hair: "buzzed fade, dark brown",
    eyes: "blue",
    skin: "fair with ruddy cheeks",
    face: "square face, strong jaw, faint acne scarring on the cheeks, easy smile",
    build: "stocky broad build",
  },
  {
    hair: "wavy light-brown hair swept back, longer on top",
    eyes: "grey",
    skin: "medium olive",
    face: "narrow face, hooked nose, thick full beard, deep-set eyes",
    build: "tall lanky frame",
  },
  {
    hair: "shaved head, clean",
    eyes: "dark brown",
    skin: "deep tan",
    face: "wide face, flat broad nose, small scar on the eyebrow, calm heavy-lidded eyes",
    build: "muscular heavyset build",
  },
  {
    hair: "receding grey-brown hair, cropped short",
    eyes: "light brown",
    skin: "fair with sun spots",
    face: "long face, reading-glasses indent on the nose bridge, thin lips, tired but kind eyes",
    build: "slightly stooped older-adult build",
  },
] as const;

/**
 * Kadroya ozgun kurgu yuzu — kadinlar siradan komsu,
 * unlu/kampanya yuzu degil. `index` CINSIYETE OZEL sirali bir sayac olmalidir
 * (ayni cinsiyetteki 0., 1., 2. kadro uyesi gibi) — cinsiyetler arasi PAYLASILAN
 * bir sayac verilirse havuz boyu farkli oldugu icin baska cinsiyetteki
 * uyelerle hicbir ilgisi olmayan carpisamalar olusabilir, ama asil onemlisi:
 * AYNI cinsiyetten uyeler arasinda index farki havuz boyunun tam kati olursa
 * (or. 4 erkek + 4 kalip = index 1 ve 5) BIREBIR AYNI yuz secilir. Bu yuzden
 * cagiran taraf (ensureCastLooks / rewriteCastLooksForNewFaces) cinsiyete
 * ozel bir sayac tutar.
 */
export function uniqueLookForIndex(index: number, gender: "male" | "female", seed = 0) {
  const pack = gender === "female" ? FEMALE_LOOKS : MALE_LOOKS;
  const colors = gender === "female" ? FEMALE_WARDROBE_COLORS : MALE_WARDROBE_COLORS;
  const look = pack[Math.abs(index + seed) % pack.length];
  const color = colors[Math.abs(index + seed) % colors.length];
  const age = gender === "female" ? 25 : 34;
  const genderWord = gender === "female" ? "WOMAN" : "MAN";
  const sex = gender === "female" ? "female" : "male";
  const appearance = slimCastAppearancePrompt(
    `A ${age}-year-old adult ${genderWord} (${sex}), ${look.build}. Hair: ${look.hair}. Eyes: ${look.eyes}. Skin: ${look.skin}. Face: ${look.face}. Gender is ${sex}. An original fictional person from this story.`,
    gender
  );
  const wardrobe = gender === "female" ? coloredFemaleWardrobe(color) : coloredMaleWardrobe(color);
  return { appearance, wardrobe, hair: look.hair, faceFeatures: `${look.face}; ${look.eyes} eyes; ${look.skin} skin`, age };
}

function lookSeedFromId(projectId: string): number {
  let n = 0;
  for (let i = 0; i < projectId.length; i++) n = (n + projectId.charCodeAt(i) * (i + 1)) % 97;
  return n;
}

/**
 * Gorunumu bos kadro uyelerine sabit yuz/kiyafet yazar (sheet uretimi icin).
 * Var olan appearance / referans gorseline dokunmaz.
 */
export async function ensureCastLooks(projectId: string): Promise<number> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { speechLanguage: true },
  });
  const speechLanguage = project?.speechLanguage;
  const nationalityLook = localeNationalityLook(speechLanguage);
  const membersRaw = await prisma.characterProfile.findMany({
    where: { projectId, role: { in: ["main", "side"] } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  for (const member of membersRaw) {
    const gender = resolveCastGender(member.name, member.gender);
    if (gender === (member.gender === "male" ? "male" : "female")) continue;
    const lookWrong =
      gender === "female"
        ? /\b(adult man|gender is male|\(male\))\b/i.test(`${member.baseAppearancePrompt} ${member.imagePrompt}`)
        : /\b(adult woman|gender is female|\(female\))\b/i.test(`${member.baseAppearancePrompt} ${member.imagePrompt}`);
    await prisma.characterProfile.update({
      where: { id: member.id },
      data: {
        gender,
        ...(lookWrong
          ? { baseAppearancePrompt: "", imagePrompt: "", baseWardrobePrompt: "", wardrobe: "" }
          : {}),
      },
    });
  }
  const members = await prisma.characterProfile.findMany({
    where: { projectId, role: { in: ["main", "side"] } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  const seed = lookSeedFromId(projectId);
  let filled = 0;
  const hasLook = (m: (typeof members)[number]) =>
    (m.baseAppearancePrompt || m.imagePrompt || "").replace(/\s+/g, " ").trim().length > 24;
  // Cinsiyete ozel sayac, DAHA ONCE look atanmis uye sayisindan baslar.
  // Onemli: hikaye ilerledikce yeni isimler tek tek eklenip bu fonksiyon
  // BIRDEN FAZLA KEZ cagrilabilir (her cagri kendi ici icin 0'dan baslarsa,
  // iki AYRI cagridaki ilk erkek/kadin AYNI havuz girdisini alir — tam olarak
  // "Emre" ve "Hakan" birebir ayni yuzu almasina yol acan bug buydu). Sayaci
  // "zaten look'u olan" uye sayisindan baslatmak diziyi cagrilar arasi da
  // KORUR, boylece art arda eklenen kisiler hep bir sonraki havuz girdisini alir.
  const genderIndex: Record<"male" | "female", number> = {
    male: members.filter((m) => resolveCastGender(m.name, m.gender) === "male" && hasLook(m)).length,
    female: members.filter((m) => resolveCastGender(m.name, m.gender) === "female" && hasLook(m)).length,
  };
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    if (hasLook(member)) continue;
    const gender = resolveCastGender(member.name, member.gender);
    const look = uniqueLookForIndex(genderIndex[gender], gender, seed);
    genderIndex[gender] += 1;
    const appearance = appendFlowLocaleCast(look.appearance, speechLanguage, gender, member.name);
    await prisma.characterProfile.update({
      where: { id: member.id },
      data: {
        gender,
        age: look.age,
        hair: look.hair,
        faceFeatures: look.faceFeatures,
        wardrobe: look.wardrobe,
        nationalityLook: nationalityLook || member.nationalityLook,
        baseAppearancePrompt: appearance,
        baseWardrobePrompt: look.wardrobe,
        imagePrompt: appearance,
      },
    });
    filled += 1;
  }
  return filled;
}

/** Canli-aksiyon kadroyu gunluk yuz + hafif kiyafete ceker; sac/goz/yas kalir. */
export async function applyEverydayCastLooks(projectId: string): Promise<number> {
  const members = await prisma.characterProfile.findMany({
    where: { projectId, role: { in: ["main", "side"] } },
    orderBy: { createdAt: "asc" },
  });
  let n = 0;
  let femaleColor = 0;
  for (const member of members) {
    const blob = `${member.baseAppearancePrompt} ${member.imagePrompt}`;
    if (!/\badult (?:WOMAN|MAN|woman|man)\b/i.test(blob) && member.role !== "main") continue;
    if (/3D Pixar|turnaround sheet|puff-sheep|sea otter/i.test(blob)) continue;
    const gender = resolveCastGender(member.name, member.gender);
    const bits = appearanceBitsFromPrompt(member.baseAppearancePrompt || member.imagePrompt || "");
    const age =
      bits.age ??
      (member.age && member.age >= 18 ? member.age : gender === "female" ? 25 : 34);
    const hair =
      member.hair?.trim() || bits.hair || (gender === "female" ? NETSHORT_FEMALE_HAIR_DEFAULT : "short dark hair");
    const wardrobe =
      gender === "female"
        ? everydayFemaleWardrobeForName(member.name || member.id, femaleColor++)
        : /tuxedo|smoking|fashion campaign/i.test(member.baseWardrobePrompt || member.wardrobe || "")
          ? NETSHORT_MALE_WARDROBE_DEFAULT
          : member.baseWardrobePrompt || member.wardrobe || NETSHORT_MALE_WARDROBE_DEFAULT;
    const appearance = composeCastAppearance({
      name: member.name || "Adult",
      storyRole: member.storyRole || "story adult",
      storyNote: "",
      gender,
      age: Math.min(75, Math.max(18, age)),
      build:
        bits.build ||
        (gender === "female" ? "average slim adult build, natural posture" : "average adult male build"),
      hairDetail: hair,
      eyeColor: bits.eyes || "brown",
      skinTone: bits.skin || (gender === "female" ? "fair" : "medium tan"),
        distinctFeature: bits.distinct,
        accessories: bits.accessories
          .replace(/,?\s*(?:neatly folded )?wool scarf/gi, "")
          .replace(/^,\s*|,\s*$/g, "")
          .replace(/\s{2,}/g, " ")
          .trim(),
      appearancePrompt:
        gender === "female" ? NETSHORT_FEMALE_FACE_DEFAULT : "Everyday neighbor man, lived-in face.",
      wardrobePrompt: wardrobe,
      voiceNote: "",
    });
    await prisma.characterProfile.update({
      where: { id: member.id },
      data: {
        gender,
        baseAppearancePrompt: appearance,
        imagePrompt: appearance,
        baseWardrobePrompt: wardrobe,
        wardrobe,
      },
    });
    n += 1;
  }
  return n;
}

/** Mevcut kadronun yuz/kiyafetini yeniler; eski Flow sheet/@ref dusurur. */
export async function rewriteCastLooksForNewFaces(projectId: string): Promise<number> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { speechLanguage: true },
  });
  const speechLanguage = project?.speechLanguage;
  const nationalityLook = localeNationalityLook(speechLanguage);
  const members = await prisma.characterProfile.findMany({
    where: { projectId, role: "side" },
    orderBy: { createdAt: "asc" },
  });
  const seed = Date.now() % 97;
  let n = 0;
  const genderIndex: Record<"male" | "female", number> = { male: 0, female: 0 };
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const gender = resolveCastGender(m.name, m.gender);
    const look = uniqueLookForIndex(genderIndex[gender], gender, seed);
    genderIndex[gender] += 1;
    const appearance = appendFlowLocaleCast(look.appearance, speechLanguage, gender, m.name);
    await prisma.characterProfile.update({
      where: { id: m.id },
      data: {
        gender,
        age: look.age,
        hair: look.hair,
        faceFeatures: look.faceFeatures,
        wardrobe: look.wardrobe,
        nationalityLook: nationalityLook || m.nationalityLook,
        baseAppearancePrompt: appearance,
        baseWardrobePrompt: look.wardrobe,
        imagePrompt: appearance,
        referenceImagePath: null,
        flowCharacterReference: "",
      },
    });
    n++;
  }
  return n;
}

/**
 * Hikaye kadrosu + film sahne plani (anlatici artik talking-head degil).
 * Uygulama `planNarratorFilm` icindedir; dongu olmasin diye dinamik import.
 */
export async function extractCast(projectId: string): Promise<{ castCount: number; cutawayCount: number }> {
  const { runExclusiveProjectJob } = await import("@/server/lib/project-job");
  const { planNarratorFilm } = await import("@/server/services/narrator-film");
  return runExclusiveProjectJob(projectId, "film-plan", () => planNarratorFilm(projectId, { force: true }));
}

/** Kadro karakterlerini dondurur. */
export async function listCast(projectId: string): Promise<CharacterProfile[]> {
  return prisma.characterProfile.findMany({ where: { projectId, role: "side" }, orderBy: { createdAt: "asc" } });
}

/** Bir klibin plan tipini ve karakterini elle degistirir. */
export async function updateClipShot(
  clipId: string,
  input: {
    shotType?: "narrator" | "cutaway" | "tt_selfie" | "tt_local" | "tt_pov" | "tt_wide";
    characterId?: string | null;
    sceneDescription?: string;
  }
): Promise<void> {
  const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });
  const shotType = input.shotType ?? clip.shotType;
  // Not: null "karakteri kaldir" demektir, undefined "dokunma" demektir.
  // Zaman Yolcusu: yalnizca "yerliyle sahne" bir kadro uyesine baglanir.
  const noCharacter = shotType === "narrator" || (shotType.startsWith("tt_") && shotType !== "tt_local");
  let nextCharacterId = noCharacter ? null : input.characterId !== undefined ? input.characterId : clip.characterId;
  if (nextCharacterId) {
    const exists = await prisma.characterProfile.findFirst({
      where: { id: nextCharacterId, projectId: clip.projectId },
      select: { id: true },
    });
    if (!exists) nextCharacterId = null;
  }
  await prisma.clip.update({
    where: { id: clipId },
    data: {
      shotType,
      characterId: nextCharacterId,
      ...(input.sceneDescription !== undefined ? { sceneDescription: input.sceneDescription } : {}),
    },
  });
}

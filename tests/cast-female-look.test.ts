import { describe, expect, it } from "vitest";
import {
  normalizeNetShortFemaleCast,
  normalizeNetShortMaleCast,
  composeCastAppearance,
  slimCastAppearancePrompt,
  appearanceBitsFromPrompt,
  type CastMember,
} from "@/server/services/cast";
import { sanitizeCelebrityLikenessForFlow } from "@/lib/flow-prompt-safety";

const baseFemale: CastMember = {
  name: "Aslı",
  storyRole: "sekreter",
  storyNote: "üçüncü kişi",
  gender: "female",
  age: 34,
  build: "average",
  hairDetail: "dark brown bob",
  eyeColor: "brown",
  skinTone: "fair",
  distinctFeature: "",
  accessories: "",
  appearancePrompt: "A professional office look.",
  wardrobePrompt: "long coat and trousers",
  voiceNote: "yumuşak",
};

describe("Gunluk hafif kadro gorunumu", () => {
  it("genc yasi 25 yapar, yetiskin yasi korur, gunluk hafif varsayilani basar", () => {
    const young = normalizeNetShortFemaleCast({ ...baseFemale, age: 19 });
    expect(young.age).toBe(25);
    const next = normalizeNetShortFemaleCast(baseFemale);
    expect(next.age).toBe(34);
    expect(next.hairDetail.toLowerCase()).toContain("dark brown bob");
    expect(next.wardrobePrompt.toLowerCase()).toMatch(/short|summer|mini|everyday|slightly open/);
    // olumlu glam/kulup tarifi olmamali ("no bodycon" gibi yasak cumleleri sayilmaz)
    expect(next.wardrobePrompt.toLowerCase()).not.toMatch(/sky-high|party-girl|micro-mini|plunge|spaghetti/);
    expect(next.appearancePrompt.toLowerCase()).toMatch(/everyday neighbor|ordinary adult|original/);
    expect(next.appearancePrompt.toLowerCase()).not.toMatch(/slavic|scandinavian|ukrainian|nordic/);
    expect(next.appearancePrompt.toLowerCase()).not.toMatch(/baby-faced beauty/);
  });

  it("muhafazakar ve kulup kiyafetini gunluk hafif varsayilana cevirir", () => {
    const modest = normalizeNetShortFemaleCast({
      ...baseFemale,
      wardrobePrompt: "beige cardigan, long wool coat, black trousers, ballet flats",
    });
    expect(modest.wardrobePrompt.toLowerCase()).toMatch(/short|summer|mini|everyday|slightly open/);
    expect(modest.wardrobePrompt.toLowerCase()).not.toMatch(/beige cardigan|wool coat/);

    const glam = normalizeNetShortFemaleCast({
      ...baseFemale,
      wardrobePrompt: "sky-high stilettos, bodycon micro-mini, party-girl night-out",
    });
    expect(glam.wardrobePrompt.toLowerCase()).not.toMatch(/sky-high|party-girl|micro-mini/);
    expect(glam.wardrobePrompt.toLowerCase()).toMatch(/short|summer|mini|everyday|slightly open/);
  });

  it("hafif mini / diz ustu zarif kiyafeti artik KORUR; diz hizasi da serbest kalir", () => {
    const keep = normalizeNetShortFemaleCast({
      ...baseFemale,
      wardrobePrompt:
        "knee-length cotton A-line skirt, hem at the kneecap, closed crewneck tee covering the chest, sandals",
    });
    expect(keep.wardrobePrompt).toMatch(/knee-length/i);

    const mini = normalizeNetShortFemaleCast({
      ...baseFemale,
      wardrobePrompt: "tasteful slightly-mini A-line skirt, fitted modest-neck top, refined low heels",
    });
    expect(mini.wardrobePrompt.toLowerCase()).toContain("slightly-mini");

    const aboveKnee = normalizeNetShortFemaleCast({
      ...baseFemale,
      wardrobePrompt: "cotton A-line skirt just above the knee, modest neckline, sandals",
    });
    expect(aboveKnee.wardrobePrompt.toLowerCase()).toContain("just above the knee");
  });

  it("erkek smokinini gunluk sehir kiyafetine cevirir", () => {
    const male: CastMember = {
      ...baseFemale,
      name: "Emre",
      gender: "male",
      age: 36,
      hairDetail: "short dark hair",
      wardrobePrompt: "black tuxedo, fashion campaign",
      appearancePrompt: "Runway look",
    };
    const next = normalizeNetShortMaleCast(male);
    expect(next.wardrobePrompt.toLowerCase()).toMatch(/jeans|crewneck|sneakers|shirt/);
    expect(next.wardrobePrompt.toLowerCase()).not.toMatch(/tuxedo/);
  });

  it("erkek gunluk takimi oldugu gibi birakir", () => {
    const male: CastMember = {
      ...baseFemale,
      name: "Emre",
      gender: "male",
      age: 36,
      hairDetail: "short dark hair",
      wardrobePrompt: "charcoal suit",
      appearancePrompt: "Corporate CEO look",
    };
    expect(normalizeNetShortMaleCast(male).wardrobePrompt).toBe("charcoal suit");
  });

  it("composeCastAppearance siradan yetiskin kadini yazar", () => {
    const text = composeCastAppearance(baseFemale);
    expect(text).toMatch(/34-year-old adult WOMAN \(female\)/i);
    expect(text.toLowerCase()).toContain("gender is female");
    expect(text.toLowerCase()).toContain("dark brown bob");
    expect(text.toLowerCase()).not.toMatch(/blond|platinum|glamorous/);
    expect(text.length).toBeLessThanOrEqual(520);
  });

  it("slim ve parca cikarma sac/goz/yasi korur, katalog kuyrugunu atar", () => {
    const raw =
      "A 26-year-old adult WOMAN (female), slim petite soft curves. Hair: straight chestnut brown, shoulder-length with a center part. Eyes: light brown. Skin tone: fair neutral. Gender is female. Distinguishing feature: fine arched brows. Accessories: delicate gold stud earrings, slim bracelet, smartphone. Adult woman about 25: Naturally beautiful ladylike catalog face and a long dump.";
    const bits = appearanceBitsFromPrompt(raw);
    expect(bits.age).toBe(26);
    expect(bits.hair).toMatch(/chestnut brown/i);
    expect(bits.eyes).toMatch(/light brown/i);
    const slim = slimCastAppearancePrompt(raw, "female");
    expect(slim).toMatch(/chestnut brown/i);
    expect(slim).not.toMatch(/Adult woman about 25/i);
    expect(slim.length).toBeLessThanOrEqual(520);
    expect(slimCastAppearancePrompt("Everyday neighbor face, slight asymmetry, little makeup — not a catalog model.", "female")).toMatch(/catalog model/i);
  });

  it("NOT baby-faced ifadesi NOT graceful adult olmaz", () => {
    const next = sanitizeCelebrityLikenessForFlow("NOT baby-faced, naturally beautiful ladylike woman");
    expect(next).not.toMatch(/NOT graceful adult/i);
    expect(next).toMatch(/clearly adult/i);
  });
});

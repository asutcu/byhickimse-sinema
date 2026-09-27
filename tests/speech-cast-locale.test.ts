import { describe, expect, it } from "vitest";
import type { CharacterProfile, Project } from "@prisma/client";
import {
  appendFlowLocaleCast,
  flowLocaleCastLock,
  inferLocaleGivenNameGender,
  isLocaleCastName,
  localeNationalityLook,
  offLocaleCastNames,
  speechCastGenderHint,
  speechCastStoryLock,
  speechLocaleTag,
} from "@/lib/speech-cast-locale";
import { resolveCastGender } from "@/lib/turkish-given-name-gender";
import { sanitizeCelebrityLikenessForFlow } from "@/lib/flow-prompt-safety";
import { buildNarratorTopicSuggestPrompts, suggestNarratorTopicInputSchema } from "@/server/services/narrator-topic";
import { buildFlowCharacterDescription, buildFlowCharacterImagePrompt } from "@/server/services/character-flow";
import { fallbackExpandCharacterNote } from "@/server/services/character";

function fakeProject(speechLanguage: string): Project {
  return { speechLanguage } as Project;
}

function fakeProfile(partial: Partial<CharacterProfile>): CharacterProfile {
  return {
    id: "c1",
    projectId: "p1",
    role: "side",
    name: "Lena",
    age: 25,
    adult: true,
    gender: "female",
    nationalityLook: "",
    hair: "long blonde hair",
    faceFeatures: "natural eyes",
    makeup: "",
    wardrobe: "navy coat",
    bodyFraming: "",
    sittingPose: "",
    gestureLevel: "",
    voiceCharacter: "",
    emotionTone: "",
    environment: "",
    lighting: "",
    cameraAngle: "",
    lensLook: "",
    background: "",
    negativePrompt: "",
    referenceImagePath: null,
    flowCharacterReference: "",
    baseAppearancePrompt: "A 25-year-old adult WOMAN (female), slim. Hair: long blonde. Eyes: grey-blue.",
    baseWardrobePrompt: "navy coat",
    baseEnvironmentPrompt: "",
    baseCameraPrompt: "",
    baseVoicePrompt: "",
    dnaCard: "{}",
    imagePrompt: "",
    imageApproved: false,
    styleCloset: "[]",
    storyRole: "wife",
    storyNote: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe("konusma dili kadro kilidi", () => {
  it("Almanca ve Almanca etiketini de olarak okur", () => {
    expect(speechLocaleTag("German")).toBe("de");
    expect(speechLocaleTag("Almanca")).toBe("de");
    expect(speechLocaleTag("Deutsch")).toBe("de");
    expect(speechLocaleTag("Turkish")).toBe("tr");
  });

  it("Almanca hikaye kilidi Alman isim ister, Turkce isim yasaklar", () => {
    const lock = speechCastStoryLock("German");
    expect(lock).toContain("ALMAN");
    expect(lock).toContain("Lena");
    expect(lock).toContain("Lukas");
    expect(lock).toContain("Elif");
    expect(lock).toContain("YASAK");
    expect(speechCastStoryLock("Turkish")).toContain("Turkce");
    expect(speechCastStoryLock("Turkish")).not.toContain("ALMAN");
  });

  it("Almanca Flow karakter promptu Alman komsu bilgisi tasir", () => {
    const female = flowLocaleCastLock("German", "female", "Lena");
    expect(female).toContain("[LOCALE CAST]");
    expect(female).toMatch(/German adult woman/i);
    expect(female).not.toContain("Lena");
    expect(female).toMatch(/Berlin\/Hamburg|German street-casual|German city/i);
    expect(female).not.toMatch(/public figure|Slavic|celebrity|Given name/i);

    const male = flowLocaleCastLock("Almanca", "male", "Markus");
    expect(male).toMatch(/German adult man/i);
    expect(male).not.toContain("Markus");

    expect(flowLocaleCastLock("Turkish", "female", "Elif")).toBe("");
    expect(localeNationalityLook("German")).toMatch(/German city/i);
    expect(localeNationalityLook("Turkish")).toBe("");
  });

  it("sanitize Alman locale kilidini silmez", () => {
    const lock = flowLocaleCastLock("German", "female", "Anna");
    expect(sanitizeCelebrityLikenessForFlow(lock)).toContain("[LOCALE CAST]");
    expect(sanitizeCelebrityLikenessForFlow(lock)).toMatch(/German/i);
  });

  it("Alman isimden cinsiyet okunur", () => {
    expect(inferLocaleGivenNameGender("Markus")).toBe("male");
    expect(inferLocaleGivenNameGender("Lena")).toBe("female");
    expect(resolveCastGender("Markus", "female")).toBe("male");
    expect(resolveCastGender("Lena", "male")).toBe("female");
    expect(speechCastGenderHint("German")).toContain("Lena");
    expect(speechCastGenderHint("German")).toContain("Markus");
  });

  it("gorunum metnine locale kilidini bir kez ekler", () => {
    const once = appendFlowLocaleCast("A 25-year-old adult WOMAN", "German", "female", "Lena");
    expect(once).toContain("[LOCALE CAST]");
    expect(appendFlowLocaleCast(once, "German", "female", "Lena").match(/\[LOCALE CAST\]/g)?.length).toBe(1);
    expect(appendFlowLocaleCast("plain", "Turkish", "female", "Elif")).toBe("plain");
  });

  it("Flow karakter uretimi Almanca projede locale kilidi tasir", () => {
    const project = fakeProject("German");
    const profile = fakeProfile({ name: "Lena", gender: "female" });
    const desc = buildFlowCharacterDescription(project, profile);
    const image = buildFlowCharacterImagePrompt(project, profile);
    expect(desc).toContain("[LOCALE CAST]");
    expect(desc).toMatch(/German adult woman/i);
    expect(desc).not.toContain("Lena");
    expect(image).toContain("[LOCALE CAST]");
    expect(image).toMatch(/German/i);
    expect(image.length).toBeLessThan(8000);
    expect(desc.length).toBeLessThan(8000);
    expect(image).toMatch(/ONE identity|exactly ONE person/i);
    expect(image).toMatch(/nobody behind|no man walking in/i);
    expect(image).not.toMatch(/ladylike|naturally beautiful/i);

    const tr = buildFlowCharacterDescription(fakeProject("Turkish"), fakeProfile({ name: "Elif" }));
    expect(tr).not.toContain("[LOCALE CAST]");
  });

  it("Almanca konu onerisi isim kilidini sistem ve kullaniciya koyar", () => {
    const { system, user } = buildNarratorTopicSuggestPrompts(
      suggestNarratorTopicInputSchema.parse({
        genreId: "aldatma",
        speechLanguage: "German",
        storyLanguage: "German",
        targetDurationSeconds: 180,
      })
    );
    expect(system).toContain("ALMAN");
    expect(user).toContain("ALMAN");
    expect(user).toMatch(/Elif.*YASAK|YASAK/);
  });

  it("konusma diline uymayan kadro ismi yakalanir", () => {
    expect(isLocaleCastName("Julia", "German")).toBe(true);
    expect(isLocaleCastName("Elif", "German")).toBe(false);
    expect(isLocaleCastName("Mert", "German")).toBe(false);
    expect(isLocaleCastName("Lena", "Turkish")).toBe(false);
    // Listede olmayan uydurma isim engellenmez (hikaye kendi ismini secebilir).
    expect(isLocaleCastName("Kathrin", "German")).toBe(true);
    expect(offLocaleCastNames(["Julia", "Elif", "Elif", "Jonas"], "German")).toEqual(["Elif"]);
    expect(offLocaleCastNames(["Julia"], "German")).toEqual([]);
  });

  it("Almanca hikaye kilidi baska dilin ismini ornekle yasaklar", () => {
    const lock = speechCastStoryLock("German");
    expect(lock).toContain("Baska dilin ismi YASAK");
    expect(lock).toContain("Elif");
    const tr = speechCastStoryLock("Turkish");
    expect(tr).toContain("Yabanci isim");
    expect(tr).toContain("Lena");
  });

  it("Almanca karakter notu yedegi Alman gorunum yazar", () => {
    const de = fallbackExpandCharacterNote("blonde Frau", undefined, "German");
    expect(de.name).toBe("Lena");
    expect(de.nationalityLook).toMatch(/German city/i);
    const tr = fallbackExpandCharacterNote("sarı saçlı", "Duru", "Turkish");
    expect(tr.name).toBe("Duru");
    expect(tr.nationalityLook).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildCharacterLock,
  fallbackExpandCharacterNote,
  flowHandleFromName,
  normalizeAge,
} from "@/server/services/character";
import type { CharacterProfile } from "@prisma/client";

function fakeProfile(partial: Partial<CharacterProfile>): CharacterProfile {
  return {
    id: "c1",
    projectId: "p1",
    role: "main",
    name: "Lena",
    age: 20,
    adult: true,
    gender: "female",
    nationalityLook: "",
    hair: "",
    faceFeatures: "",
    makeup: "",
    wardrobe: "",
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
    baseAppearancePrompt: "",
    baseWardrobePrompt: "",
    baseEnvironmentPrompt: "",
    baseCameraPrompt: "",
    baseVoicePrompt: "",
    dnaCard: "{}",
    imagePrompt: "",
    imageApproved: false,
    styleCloset: "[]",
    storyRole: "",
    storyNote: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe("karakter notu", () => {
  it("kisa notu alanlara yayar ve yetiskin yasini korur", () => {
    const expanded = fallbackExpandCharacterNote("sarı saçlı renkli gözlü açık kıyafet", "Lena");
    expect(expanded.name).toBe("Lena");
    expect(expanded.age).toBeGreaterThanOrEqual(18);
    expect(expanded.hair).toMatch(/sarı|renkli|kıyafet|kiyafet/i);
    expect(expanded.wardrobe).toMatch(/sarı|renkli|kıyafet|kiyafet/i);
    expect(expanded.faceFeatures).toContain("sarı");
    expect(normalizeAge(expanded.age)).toBe(25);
  });

  it("Flow @handle adindan uretir", () => {
    expect(flowHandleFromName("Lena")).toBe("@Lena");
    expect(flowHandleFromName("@Lena")).toBe("@Lena");
    expect(flowHandleFromName("")).toBe("");
  });

  it("kilit kullanici notasini kaybetmez", () => {
    const lock = buildCharacterLock(
      fakeProfile({
        storyNote: "sarı saçlı, renkli gözlü, açık kıyafet",
        hair: "long blonde hair",
        wardrobe: "open light clothing",
        faceFeatures: "colored eyes",
      })
    );
    expect(lock.baseAppearancePrompt).toMatch(/sarı saçlı/);
    expect(lock.baseAppearancePrompt).toMatch(/blonde|colored|adult/i);
    expect(lock.baseWardrobePrompt).toMatch(/open light clothing/);
  });

  it("kadro karakterinin kilitini notla ezmez", () => {
    const lock = buildCharacterLock(
      fakeProfile({
        role: "side",
        storyNote: "bu not gorunmemeli",
        baseAppearancePrompt: "adult man, dark hair",
        wardrobe: "coat",
      })
    );
    expect(lock.baseAppearancePrompt).toBe("adult man, dark hair");
    expect(lock.baseAppearancePrompt).not.toMatch(/gorunmemeli/);
  });
});

import { describe, expect, it } from "vitest";
import type { CharacterProfile, Project } from "@prisma/client";
import { isSupportedTemplateType } from "@/lib/templates";
import { compactPromptForFlow } from "@/lib/flow-prompt-compact";
import { buildClipPrompt } from "@/server/services/prompt-builder";
import { buildCharacterLock } from "@/server/services/character";
import { buildFlowCharacterImagePrompt } from "@/server/services/character-flow";

describe("cizgi film", () => {
  it("yeni proje turu olarak aciktir", () => {
    expect(isSupportedTemplateType("kids_animation")).toBe(true);
  });

  it("klip promptu 3D kimlik kilidini korur ve canli cekim kadina donusmez", () => {
    const prompt = buildClipPrompt({
      project: {
        templateType: "kids_animation",
        speechLanguage: "Turkish",
        promptTemplate: "",
        useFlowCharacter: true,
        aspectRatio: "16:9",
        visualStyle: "pixar3d",
        allowSubtitles: false,
        emotionCurve: "",
        clipSeconds: 8,
        useReference: true,
        genre: "Çizgi film",
        id: "p1",
        topic: "A small orange fox looks for a bell on a snowy mountain",
      },
      character: {
        name: "Kirpik",
        baseAppearancePrompt: "3D animated original character. Small orange fox with a cream muzzle.",
        baseWardrobePrompt: "Red scarf and yellow knit hat, same colors every shot.",
        baseEnvironmentPrompt: "",
        baseCameraPrompt: "",
        baseVoicePrompt: "warm clear voice",
        negativePrompt: "",
        flowCharacterReference: "@Kirpik",
      },
      sceneCharacter: {
        name: "Kirpik",
        baseAppearancePrompt: "3D animated original character. Small orange fox with a cream muzzle.",
        baseWardrobePrompt: "Red scarf and yellow knit hat, same colors every shot.",
        flowCharacterReference: "@Kirpik",
      },
      supportingCast: [
        {
          name: "Tona",
          role: "side",
          storyRole: "friend",
          baseAppearancePrompt: "3D animated original character. Round blue bird.",
          baseWardrobePrompt: "Green satchel.",
          flowCharacterReference: "@Tona",
        },
      ],
      clip: {
        dialogue: 'Kirpik: "Çan bu tarafta."',
        index: 1,
        sceneDescription: "Snowy ridge at dawn",
        voiceTone: "",
        imagePrompt: "",
        emotionLabel: "",
      },
      isFirstClip: true,
    });

    expect(prompt).toContain("[CAST LOCK — ANIMATED FILM]");
    expect(prompt).toContain("@Kirpik");
    expect(prompt).toContain("Çan bu tarafta.");
    expect(prompt).toContain("Red scarf");
    expect(prompt).not.toMatch(/adult woman/i);
    expect(prompt).not.toMatch(/confession/i);
    expect(prompt).not.toMatch(/NetShort/i);
    expect(prompt).not.toMatch(/story-adult/i);

    const packed = compactPromptForFlow(prompt, "Turkish");
    expect(packed.text.length).toBeLessThanOrEqual(7800);
    expect(packed.text).toContain("[CAST LOCK — ANIMATED FILM]");
    expect(packed.text).toContain("Çan bu tarafta.");
    expect(packed.text).not.toMatch(/WARDROBE COVER/);
    expect(packed.text).not.toMatch(/\[STORY CAST\]/);
  });

  it("3D kostumdeki montu yazlik elbiseye cevirmez", () => {
    const lock = buildCharacterLock({
      role: "side",
      gender: "female",
      name: "Kirpik",
      wardrobe: "blue wool coat and red scarf",
      baseWardrobePrompt: "",
      baseAppearancePrompt: "3D animated original character. Orange fox.",
      imagePrompt: "3D animated original character. Orange fox.",
    } as CharacterProfile);
    expect(lock.baseWardrobePrompt).toContain("wool coat");
    expect(lock.baseWardrobePrompt).not.toMatch(/summer dress|mini skirt/i);
  });

  it("karakter karti canli cekim yetiskin kadin yazmaz", () => {
    const sheet = buildFlowCharacterImagePrompt(
      { templateType: "kids_animation", speechLanguage: "Turkish" } as Project,
      {
        name: "Kirpik",
        gender: "female",
        role: "side",
        imagePrompt: "3D animated original character. Small orange fox with a cream muzzle.",
        baseAppearancePrompt: "3D animated original character. Small orange fox with a cream muzzle.",
        baseWardrobePrompt: "Red scarf and yellow knit hat.",
        wardrobe: "Red scarf and yellow knit hat.",
      } as CharacterProfile
    );
    expect(sheet).toMatch(/3D|Pixar/i);
    expect(sheet).toContain("orange fox");
    expect(sheet).not.toMatch(/adult woman/i);
    expect(sheet).not.toMatch(/Live-action/i);
  });

  it("2D anime secimi karakter kartini Pixar 3D yapmaz", () => {
    const sheet = buildFlowCharacterImagePrompt(
      { templateType: "kids_animation", speechLanguage: "Turkish", visualStyle: "anime" } as Project,
      {
        name: "Tona",
        gender: "female",
        role: "side",
        imagePrompt: "3D animated original character. Round blue bird.",
        baseAppearancePrompt: "3D animated original character. Round blue bird.",
        baseWardrobePrompt: "Green satchel.",
        wardrobe: "Green satchel.",
      } as CharacterProfile
    );
    expect(sheet).toMatch(/2D anime/i);
    expect(sheet).not.toMatch(/Pixar/i);
    expect(sheet).toMatch(/not live-action/i);
  });
});

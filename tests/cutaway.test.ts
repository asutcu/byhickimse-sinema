import { describe, expect, it } from "vitest";
import { compactPromptForFlow, stampNoOnscreenTextLock } from "@/lib/flow-prompt-compact";
import { buildClipPrompt, DEFAULT_CUTAWAY_TEMPLATE, defaultTemplateFor } from "@/server/services/prompt-builder";

const narratorProject = {
  templateType: "narrator",
  speechLanguage: "Türkçe",
  promptTemplate: "",
  useFlowCharacter: false,
  aspectRatio: "16:9",
  visualStyle: "",
  allowSubtitles: false,
  emotionCurve: "",
  clipSeconds: 8,
  useReference: true,
};

const narrator = {
  baseAppearancePrompt: "A 30-year-old adult woman with dark hair.",
  baseWardrobePrompt: "simple knit sweater",
  baseEnvironmentPrompt: "modern living room",
  baseCameraPrompt: "Fixed tripod camera. Medium close-up.",
  baseVoicePrompt: "calm warm female voice",
  negativePrompt: "",
  flowCharacterReference: "",
};

const daughter = {
  name: "Elif",
  baseAppearancePrompt: "A 19-year-old adult woman with long brown hair and a worried expression.",
  baseWardrobePrompt: "denim jacket",
  flowCharacterReference: "",
};

const cutawayClip = {
  dialogue: "O gece mutfakta bir tabak kirildi.",
  index: 4,
  sceneDescription: "A dim kitchen at night, a broken plate on the floor, moonlight through the window",
  voiceTone: "tedirgin",
  imagePrompt: "",
  shotType: "cutaway",
  emotionLabel: "tedirgin",
};

describe("Kesit plani promptu", () => {
  it("anlatici yerine sahnedeki karakteri tarif eder", () => {
    const prompt = buildClipPrompt({
      project: narratorProject,
      character: narrator,
      clip: cutawayClip,
      sceneCharacter: daughter,
      isFirstClip: false,
    });
    expect(prompt).not.toMatch(/\bElif\b/);
    expect(prompt).toMatch(/On screen \(lead\)|story adult/i);
    expect(prompt).toContain("denim jacket");
    expect(prompt).toContain("narrator herself is NOT in this shot");
    expect(prompt).toContain("[IDENTITY LOCK]");
    expect(prompt).not.toMatch(/Lock these identities 1:1/);
    expect(prompt).not.toContain("She remains seated and looks naturally toward the camera");
  });

  it("konusmayi dis sese cevirir ve agiz hareketini yasaklar", () => {
    const prompt = buildClipPrompt({
      project: narratorProject,
      character: narrator,
      clip: cutawayClip,
      sceneCharacter: daughter,
      isFirstClip: false,
    });
    expect(prompt).toContain("voice-over");
    expect(prompt).toContain("O gece mutfakta bir tabak kirildi.");
    expect(prompt).toContain("Nobody on screen moves their lips");
  });

  it("anlatici sesinin ayni kalmasini sart kosar", () => {
    const prompt = buildClipPrompt({
      project: narratorProject,
      character: narrator,
      clip: cutawayClip,
      sceneCharacter: daughter,
      isFirstClip: false,
    });
    expect(prompt).toContain("same voice identity");
    expect(prompt).toContain("calm warm female voice");
  });

  it("kadro karakterinin @Flow referansi varsa prompta ekler", () => {
    const prompt = buildClipPrompt({
      project: narratorProject,
      character: narrator,
      clip: cutawayClip,
      sceneCharacter: { ...daughter, flowCharacterReference: "@Elif" },
      isFirstClip: false,
    });
    expect(prompt).not.toContain("@Elif");
    expect(prompt).toContain("denim jacket");
  });

  it("karakter atanmamissa kimseyi one cikarmaz", () => {
    const prompt = buildClipPrompt({
      project: narratorProject,
      character: narrator,
      clip: cutawayClip,
      sceneCharacter: null,
      isFirstClip: false,
    });
    expect(prompt).toContain("No featured portrait");
    expect(prompt).toContain("Do not invent a new recurring face");
    expect(prompt).toContain("[IDENTITY LOCK]");
    expect(prompt).toContain("broken plate");
  });

  it("sahnedeki ikinci kadro uyesi de kilitlenir", () => {
    const prompt = buildClipPrompt({
      project: narratorProject,
      character: narrator,
      clip: cutawayClip,
      sceneCharacter: daughter,
      supportingCast: [
        {
          name: "Ahmet",
          role: "side",
          storyRole: "koca",
          baseAppearancePrompt: "A 42-year-old man with short black hair and a tired face.",
          baseWardrobePrompt: "grey shirt",
          flowCharacterReference: "",
        },
      ],
      isFirstClip: false,
    });
    expect(prompt).not.toMatch(/\bElif\b|\bAhmet\b/);
    expect(prompt).toContain("koca");
    expect(prompt).toContain("grey shirt");
    expect(prompt).not.toMatch(/Lock these identities 1:1/);
  });

  it("hikaye kelimelerini ve mekan detayini prompta yazar", () => {
    const prompt = buildClipPrompt({
      project: narratorProject,
      character: narrator,
      clip: {
        ...cutawayClip,
        imagePrompt: "NARRATOR WORLD LOCK: rain on wet asphalt. [SHOT] dim kitchen, broken plate",
      },
      sceneCharacter: daughter,
      isFirstClip: false,
      previousClip: {
        index: 3,
        sceneDescription: "He opens the apartment door",
        imagePrompt: "",
        dialogue: "Kapıyı açtım.",
        emotionLabel: "",
        voiceTone: "",
      },
    });
    expect(prompt).toContain("STORY-WORD VISUAL LOCK");
    expect(prompt).toContain("broken plate");
    expect(prompt).toContain("MATCH-ON-ACTION");
    expect(prompt).toContain("mutfakta");
    expect(prompt).not.toContain("same room, chair, background");
  });

  it("ozel proje sablonu kesit planini ezmez", () => {
    const prompt = buildClipPrompt({
      project: { ...narratorProject, promptTemplate: "SADECE: {{DIALOGUE}}" },
      character: narrator,
      clip: cutawayClip,
      sceneCharacter: daughter,
      isFirstClip: false,
    });
    expect(prompt).toContain("voice-over");
    expect(prompt).not.toBe("SADECE: O gece mutfakta bir tabak kirildi.");
  });

  it("anlatici shotType kameradaki itiraf sablonunu kullanir", () => {
    const prompt = buildClipPrompt({
      project: narratorProject,
      character: narrator,
      clip: { ...cutawayClip, shotType: "narrator", sceneDescription: "Lived-in kitchen confession, wet cheeks" },
      sceneCharacter: null,
      isFirstClip: false,
    });
    expect(prompt).toContain("NARRATOR ON CAMERA");
    expect(prompt).toContain("She says exactly");
    expect(prompt).toMatch(/confession|lived-in|CRY|cry|wet/i);
    expect(prompt).not.toContain("A female narrator voice-over");
    expect(prompt).not.toContain("She remains seated and looks naturally toward the camera");
  });

  it("yasak ask turunde hüzün yerine sert duygu kilitlenir, diyalog bozulmaz", () => {
    const prompt = buildClipPrompt({
      project: { ...narratorProject, genre: "Yasak ask" },
      character: narrator,
      clip: cutawayClip,
      sceneCharacter: daughter,
      isFirstClip: false,
    });
    expect(prompt).toContain("O gece mutfakta bir tabak kirildi.");
    expect(prompt).toContain("[HARD EMOTION]");
    expect(prompt).toMatch(/NetShort|NETSHORT|sakin yikici|cold|status/i);
    expect(prompt).toMatch(/NOT MELANCHOLY|not a melancholic|melanchol/i);
    expect(prompt).toMatch(/\[AUDIO\]/);
    expect(prompt).toContain("says exactly");
    const { text } = compactPromptForFlow(prompt, "Türkçe", 2500);
    expect(text).toContain("O gece mutfakta bir tabak kirildi.");
    expect(text).toMatch(/HARD CONFLICT|NOT MELANCHOLY/i);
  });

  it("gomulu imagePrompt kuyrugu kesit diyalogunu silmez ve compact korur", () => {
    const imagePrompt = stampNoOnscreenTextLock(
      "[SHOT] dim kitchen, broken plate\n[ENVIRONMENT] tiled kitchen with rain at the window"
    );
    const prompt = buildClipPrompt({
      project: { ...narratorProject, useFlowCharacter: true },
      character: { ...narrator, flowCharacterReference: "@Deniz" },
      clip: { ...cutawayClip, imagePrompt },
      sceneCharacter: { ...daughter, flowCharacterReference: "@Elif" },
      isFirstClip: false,
    });
    expect(prompt).toContain("O gece mutfakta bir tabak kirildi.");
    expect(prompt).toMatch(/\[AUDIO\]/);
    expect(prompt).toMatch(/says exactly/);
    const { text } = compactPromptForFlow(prompt, "Türkçe", 2500);
    expect(text).toContain("O gece mutfakta bir tabak kirildi.");
    expect(text).toMatch(/\[SPOKEN LINE/);
  });

  it("defaultTemplateFor anlaticida shotType'a gore sablon secer", () => {
    expect(defaultTemplateFor("narrator", "cutaway")).toBe(DEFAULT_CUTAWAY_TEMPLATE);
    expect(defaultTemplateFor("narrator", "narrator")).not.toBe(DEFAULT_CUTAWAY_TEMPLATE);
    expect(defaultTemplateFor("longform", "cutaway")).toBe(DEFAULT_CUTAWAY_TEMPLATE);
  });
});

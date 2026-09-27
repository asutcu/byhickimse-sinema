import { describe, expect, it } from "vitest";
import { buildClipPrompt, defaultStyleFor, VISUAL_STYLE_PRESETS } from "@/server/services/prompt-builder";
import { compactPromptForFlow, FLOW_PROMPT_MAX } from "@/lib/flow-prompt-compact";

const baseProject = {
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

const baseCharacter = {
  baseAppearancePrompt: "A 20-year-old adult German woman with long blonde hair.",
  baseWardrobePrompt: "modern stylish outfit",
  baseEnvironmentPrompt: "modern living room. She is sitting on a sofa. Lighting: soft warm light",
  baseCameraPrompt: "Fixed tripod camera. Medium close-up.",
  baseVoicePrompt: "calm warm female voice",
  negativePrompt: "no jewelry",
  flowCharacterReference: "@Lena",
};

const baseClip = {
  dialogue: 'Merhaba. Bugun "tuhaf" bir sey anlatacagim.',
  index: 1,
  sceneDescription: "",
  voiceTone: "",
  imagePrompt: "",
  emotionLabel: "",
};

describe("Prompt olusturma", () => {
  it("diyalogu aynen icerir (cift tirnaklar tek tirnaga cevrilir)", () => {
    const prompt = buildClipPrompt({ project: baseProject, character: baseCharacter, clip: baseClip, isFirstClip: true });
    expect(prompt).toContain("Merhaba. Bugun 'tuhaf' bir sey anlatacagim.");
  });

  it("karakter kilidi metinlerini icerir", () => {
    const prompt = buildClipPrompt({
      project: baseProject,
      character: {
        ...baseCharacter,
        baseAppearancePrompt: "A 20-year-old adult German woman with long blonde hair.",
        baseWardrobePrompt: "modern stylish outfit",
        baseCameraPrompt: "Fixed tripod camera. Medium close-up.",
      },
      clip: { ...baseClip, shotType: "narrator", sceneDescription: "Lived-in kitchen confession" },
      isFirstClip: true,
    });
    expect(prompt).toContain("modern stylish outfit");
    expect(prompt).toContain("[IDENTITY LOCK]");
  });

  it("ilk klipte 'onceki klip' referansi olmaz, sonraki kliplerde film surekliligi olur", () => {
    const first = buildClipPrompt({ project: baseProject, character: baseCharacter, clip: baseClip, isFirstClip: true });
    const second = buildClipPrompt({
      project: baseProject,
      character: baseCharacter,
      clip: { ...baseClip, index: 2, sceneDescription: "A wet street at night" },
      isFirstClip: false,
      previousClip: { ...baseClip, index: 1, sceneDescription: "A doorway in the rain" },
    });
    expect(first).not.toContain("MATCH-ON-ACTION");
    expect(first).toContain("Opening take");
    expect(second).toContain("MATCH-ON-ACTION");
    expect(second).not.toContain("same room, chair, background");
  });

  it("konusma dilini prompta yazar", () => {
    const prompt = buildClipPrompt({ project: baseProject, character: baseCharacter, clip: baseClip, isFirstClip: true });
    expect(prompt).toContain("Türkçe");
  });

  it("Flow karakter referansi acikken bile @ad politika icin sokulur", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, useFlowCharacter: true },
      character: baseCharacter,
      clip: { ...baseClip, shotType: "narrator", sceneDescription: "Lived-in kitchen confession" },
      isFirstClip: true,
    });
    expect(prompt).not.toMatch(/@Lena/);
  });

  it("anlatici film kliplerinde anlatıcı @ referansi prompta girmez", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, useFlowCharacter: true },
      character: baseCharacter,
      clip: { ...baseClip, sceneDescription: "A kitchen at night, broken plate on the floor" },
      isFirstClip: true,
    });
    expect(prompt).not.toMatch(/^@Lena/);
    expect(prompt).toContain("The narrator is NOT in this shot");
    expect(prompt).toContain("broken plate");
  });

  it("kameradaki anlatici cekiminde ana karakter @ referansi kullanilir", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, useFlowCharacter: true },
      character: baseCharacter,
      clip: { ...baseClip, shotType: "narrator", sceneDescription: "Lived-in kitchen confession" },
      isFirstClip: true,
    });
    expect(prompt).not.toMatch(/@Lena/);
    expect(prompt).toContain("NARRATOR ON CAMERA");
    expect(prompt).toContain("NETSHORT SHORT-DRAMA LOOK");
    expect(prompt).not.toContain("A female narrator voice-over");
  });

  it("useFlowCharacter kapaliyken yan karakter @ etiketleri prompta girmez", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, useFlowCharacter: false },
      character: baseCharacter,
      clip: {
        ...baseClip,
        sceneDescription: "A dim kitchen at night, broken plate on the floor",
      },
      sceneCharacter: {
        name: "Elif",
        baseAppearancePrompt: "A 19-year-old adult woman with long brown hair.",
        baseWardrobePrompt: "denim jacket",
        flowCharacterReference: "@Elif",
      },
      supportingCast: [
        {
          name: "Ahmet",
          role: "side",
          storyRole: "koca",
          baseAppearancePrompt: "A 42-year-old man with short black hair.",
          baseWardrobePrompt: "grey shirt",
          flowCharacterReference: "@Ahmet",
        },
      ],
      isFirstClip: true,
    });
    expect(prompt.startsWith("@Elif")).toBe(false);
    expect(prompt.startsWith("@Ahmet")).toBe(false);
    expect(prompt).not.toMatch(/^@Elif/m);
    expect(prompt).not.toMatch(/^@Ahmet/m);
    expect(prompt).not.toMatch(/\bElif\b|\bAhmet\b|@Elif|@Ahmet/);
    expect(prompt).toContain("denim jacket");
  });

  it("sinema anlatici klibine duygu + hareket yonergesi yazar (durgun video olmasin)", () => {
    const prompt = buildClipPrompt({
      project: baseProject,
      character: baseCharacter,
      clip: {
        ...baseClip,
        index: 3,
        sceneDescription: "Mert steps closer in the hallway; Elif freezes at the door frame",
        emotionLabel: "bastirilmis arzu / gerilim",
        voiceTone: "kisik, nefesi tutulmus",
      },
      isFirstClip: false,
      previousClip: { ...baseClip, index: 2, emotionLabel: "kiskanclik", voiceTone: "" },
    });
    expect(prompt).toContain("[PERFORMANCE — EMOTION IS MANDATORY]");
    expect(prompt).toContain("bastirilmis arzu / gerilim");
    expect(prompt).toContain("kisik, nefesi tutulmus");
    expect(prompt).toContain("Hangover from prev: kiskanclik");
    expect(prompt).toContain("MOVE every second");
    expect(prompt).toContain("no nudity/sex");
  });

  it("anlatici promptu eski bloklari korur ve tam mekan katmanini ekler", () => {
    const prompt = buildClipPrompt({
      project: baseProject,
      character: baseCharacter,
      clip: {
        ...baseClip,
        sceneDescription: "Elif at the open street door",
        emotionLabel: "hasret",
        imagePrompt: [
          "[SHOT] Elif at the open street door",
          "[CAMERA] slow push-in",
          "[SETTING] threshold",
          "[ENVIRONMENT] Worn stairwell, terrazzo steps, rain visible through the street door.",
          "[BACKGROUND LAYERS] Foreground door frame, mid wet sidewalk, distant lit windows.",
          "[SET DRESSING] Rusted mailboxes, dripping umbrella.",
          "[ATMOSPHERE] Cold rain mist under sodium street light.",
        ].join("\n"),
      },
      isFirstClip: true,
    });
    expect(prompt).toContain("[STYLE]");
    expect(prompt).toContain("[SHOT]");
    expect(prompt).toContain("[WHO IS ON SCREEN]");
    expect(prompt).toContain("[SCENE CONTINUITY]");
    expect(prompt).toContain("[CAMERA]");
    expect(prompt).toContain("[PERFORMANCE — EMOTION IS MANDATORY]");
    expect(prompt).toContain("[AUDIO]");
    expect(prompt).toContain("[WORLD — FULL LOCATION]");
    expect(prompt).toContain("[WORLD — FULL LOCATION]");
    expect(prompt).toContain("terrazzo steps");
    expect(prompt).toContain("Foreground door frame");
    const continuityAt = prompt.indexOf("\n[SCENE CONTINUITY]");
    const worldAt = prompt.indexOf("\n[WORLD — FULL LOCATION]");
    expect(continuityAt).toBeGreaterThan(-1);
    expect(worldAt).toBeGreaterThan(continuityAt);
  });

  it("duygu etiketi yoksa da notr sahne yasagini yazar", () => {
    const prompt = buildClipPrompt({
      project: baseProject,
      character: baseCharacter,
      clip: { ...baseClip, sceneDescription: "A wet street at night" },
      isFirstClip: true,
    });
    expect(prompt).toContain("EMOTION:");
    expect(prompt).toContain("frozen tableau FORBIDDEN");
  });

  it("useFlowCharacter acikken longformda @ad ve ozel isim politika icin sokulur", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, templateType: "longform", useFlowCharacter: true },
      character: { ...baseCharacter, flowCharacterReference: "@Lena" },
      clip: baseClip,
      supportingCast: [
        {
          name: "Ada",
          role: "side",
          storyRole: "arkadas",
          baseAppearancePrompt: "girl",
          baseWardrobePrompt: "jacket",
          flowCharacterReference: "@Ada",
        },
      ],
      isFirstClip: true,
    });
    expect(prompt).not.toMatch(/@Lena|@Ada|\bLena\b|\bAda\b/);
  });

  it("longform ozel sablon degiskenleri isler ve eksik kilitleri ekler", () => {
    const prompt = buildClipPrompt({
      project: {
        ...baseProject,
        templateType: "longform",
        promptTemplate: "DIL: {{LANGUAGE}}\nSOZ: {{DIALOGUE}}",
      },
      character: baseCharacter,
      clip: baseClip,
      isFirstClip: true,
    });
    expect(prompt).toContain("DIL: Türkçe\nSOZ: Merhaba. Bugun 'tuhaf' bir sey anlatacagim.");
    expect(prompt).toContain("[SPEECH / LYRIC LOCK]");
    expect(prompt).toContain("SPEECH FIDELITY — NON-NEGOTIABLE");
    expect(prompt).toContain("[ON-SCREEN TEXT]");
    expect(prompt).toContain("HARD BAN — NO TEXT IN FRAME");
    expect(prompt).toContain("[FINAL HARD LOCK — ON-SCREEN TEXT]");
  });

  it("anlatici talking-head ozel sablonunu yok sayar", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, promptTemplate: "SADECE: {{DIALOGUE}}" },
      character: baseCharacter,
      clip: { ...baseClip, sceneDescription: "A dim kitchen, broken plate on tile" },
      isFirstClip: true,
    });
    expect(prompt).toContain("voice-over");
    expect(prompt).toContain("broken plate");
    expect(prompt).not.toBe("SADECE: Merhaba. Bugun 'tuhaf' bir sey anlatacagim.");
  });

  it("kisitlama blogunu her zaman icerir (varsayilan sablon)", () => {
    const prompt = buildClipPrompt({ project: baseProject, character: baseCharacter, clip: baseClip, isFirstClip: true });
    expect(prompt).toContain("Do not add, remove, paraphrase or translate the narration.");
    expect(prompt).toContain("Pace the exact narration across the FULL clip");
    expect(prompt).toContain("SPEECH PACING LOCK — 8s CLIP");
  });
});

describe("Gorsel stil secenegi", () => {
  it("anlatici sablonunda varsayilan stil gercekci canli cekimdir", () => {
    const prompt = buildClipPrompt({ project: baseProject, character: baseCharacter, clip: baseClip, isFirstClip: true });
    expect(prompt).toContain("Cinematic live-action short drama");
    expect(prompt).toContain("[STORY CAST]");
    expect(prompt).toMatch(/ordinary neighbor/i);
    expect(prompt).not.toMatch(/photorealistic|skin-pore|celebrity|ünlü|unlu|fenomen/i);
  });

  it("uzun form sablonunda da varsayilan stil gercekci canli cekimdir", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, templateType: "longform" },
      character: baseCharacter,
      clip: baseClip,
      isFirstClip: true,
    });
    expect(prompt).toContain("Cinematic live-action short drama");
    expect(prompt).not.toMatch(/photorealistic|celebrity/i);
  });

  it("on ayar kimligi kaydedildiyse tarife cevrilir", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, visualStyle: "anime" },
      character: baseCharacter,
      clip: baseClip,
      isFirstClip: true,
    });
    expect(prompt).toContain("2D anime style");
    expect(prompt).not.toContain("Cinematic live-action short drama");
  });

  it("serbest metin stil aynen kullanilir", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, visualStyle: "Gritty handheld found-footage look" },
      character: baseCharacter,
      clip: baseClip,
      isFirstClip: true,
    });
    expect(prompt).toContain("Gritty handheld found-footage look");
  });

  it("defaultStyleFor narrator ve longform icin gercekci on ayari verir", () => {
    const photoreal = VISUAL_STYLE_PRESETS.find((p) => p.id === "photorealistic")!.prompt;
    expect(defaultStyleFor("narrator")).toBe(photoreal);
    expect(defaultStyleFor("longform")).toBe(photoreal);
  });
});

describe("Altyazi secenegi", () => {
  it("kapaliyken her turlu ekran yazisini guclu dille yasaklar (varsayilan)", () => {
    const prompt = buildClipPrompt({ project: baseProject, character: baseCharacter, clip: baseClip, isFirstClip: true });
    expect(prompt).toContain("[ON-SCREEN TEXT]");
    expect(prompt).toContain("HARD BAN — NO TEXT IN FRAME");
    expect(prompt).toContain("no subtitles");
    expect(prompt).toContain("karaoke");
    expect(prompt).toContain("[FINAL HARD LOCK — ON-SCREEN TEXT]");
    expect(prompt).toContain("Negative constraints: no subtitles");
    expect(prompt).not.toContain("REQUIRED: burn clean");
  });

  it("allowSubtitles acik olsa bile gomulu altyazi istemez (dikey/yatay)", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, allowSubtitles: true, aspectRatio: "16:9" },
      character: baseCharacter,
      clip: baseClip,
      isFirstClip: true,
    });
    expect(prompt).toContain("HARD BAN — NO TEXT IN FRAME");
    expect(prompt).toContain("[FINAL HARD LOCK — ON-SCREEN TEXT]");
    expect(prompt).toContain("9:16");
    expect(prompt).toContain("16:9");
    expect(prompt).not.toContain("REQUIRED: burn clean");
  });

  it("narrator ve longformda ekran yazisi yasaktir (ayar acik olsa bile)", () => {
    for (const templateType of ["narrator", "longform"] as const) {
      const off = buildClipPrompt({
        project: { ...baseProject, templateType, aspectRatio: "9:16" },
        character: baseCharacter,
        clip: baseClip,
        isFirstClip: true,
      });
      expect(off).toContain("HARD BAN — NO TEXT IN FRAME");
      expect(off).toContain("[ON-SCREEN TEXT]");
      expect(off).toContain("[FINAL HARD LOCK — ON-SCREEN TEXT]");

      const on = buildClipPrompt({
        project: { ...baseProject, templateType, allowSubtitles: true, aspectRatio: "16:9" },
        character: baseCharacter,
        clip: baseClip,
        isFirstClip: true,
      });
      expect(on).toContain("HARD BAN — NO TEXT IN FRAME");
      expect(on).toContain("[NO ON-SCREEN TEXT — NON-NEGOTIABLE]");
      expect(on).toContain("first scene through last scene");
      expect(on).not.toContain("REQUIRED: burn clean");
    }
  });

  it("anlatici kesitte anlatim sadakati, kamerada konusma sadakati zorunlu", () => {
    const cutaway = buildClipPrompt({ project: baseProject, character: baseCharacter, clip: baseClip, isFirstClip: true });
    expect(cutaway).toContain("NARRATION FIDELITY — NON-NEGOTIABLE");
    expect(cutaway).toContain("word for word");
    expect(cutaway).toContain("STORY-WORD VISUAL LOCK");

    const onCamera = buildClipPrompt({
      project: baseProject,
      character: baseCharacter,
      clip: { ...baseClip, shotType: "narrator", sceneDescription: "Lived-in kitchen confession" },
      isFirstClip: true,
    });
    expect(onCamera).toContain("SPEECH FIDELITY — NON-NEGOTIABLE");
    expect(onCamera).toContain("accurate lip-sync");
    expect(onCamera).toContain("SPEECH PACING LOCK — 8s CLIP");
  });

  it("1. ve 1000. klip ayni altyazi yasagini tasir", () => {
    const first = buildClipPrompt({
      project: baseProject,
      character: baseCharacter,
      clip: { ...baseClip, index: 1 },
      isFirstClip: true,
    });
    const last = buildClipPrompt({
      project: baseProject,
      character: baseCharacter,
      clip: { ...baseClip, index: 1000, sceneDescription: "A hallway at night" },
      isFirstClip: false,
      previousClip: { ...baseClip, index: 999, sceneDescription: "A doorway" },
    });
    expect(first).toContain("[SABIT KURAL — ALTYAZI YOK]");
    expect(last).toContain("[SABIT KURAL — ALTYAZI YOK]");
    expect(first).toContain("clip 1 and clip 1000 get the same ban");
    expect(last).toContain("clip 1 and clip 1000 get the same ban");
    expect(first).toContain("[SABIT KURAL SONU — ALTYAZI YOK]");
    expect(last).toContain("[SABIT KURAL SONU — ALTYAZI YOK]");
  });

  it("sinema klip promptu Flow 8000 altinda kalir, soz ve sahne dusmez", () => {
    const prompt = buildClipPrompt({
      project: { ...baseProject, useFlowCharacter: true },
      character: { ...baseCharacter, name: "Lina" },
      clip: {
        ...baseClip,
        shotType: "cutaway",
        dialogue: "Kerem sekretere güldü, kağıdı uzattı. Yüzüm dondu.",
        sceneDescription: "Glass office. Kerem smiles at the secretary and slides the paper.",
        imagePrompt:
          "[SHOT] Glass office. Kerem slides the paper.\n[ENVIRONMENT] Night city through glass.\n[SET DRESSING] Unsigned papers on the desk.\n[ATMOSPHERE] Cool tungsten.",
        emotionLabel: "asagilanma yarasi",
      },
      isFirstClip: false,
      previousClip: { ...baseClip, index: 1, sceneDescription: "Kitchen table, keys" },
      sceneCharacter: {
        name: "Kerem",
        baseAppearancePrompt: "30s Turkish man, short dark hair",
        baseWardrobePrompt: "navy shirt",
        flowCharacterReference: "@Kerem",
      },
    });
    expect(prompt.length).toBeLessThan(9800);
    const { text } = compactPromptForFlow(prompt, "Turkish");
    expect(text.length).toBeLessThanOrEqual(FLOW_PROMPT_MAX);
    expect(text.length).toBeLessThan(8000);
    expect(text).toContain("o sekretere");
    expect(text).not.toMatch(/\bKerem\b/);
    expect(text).toMatch(/Glass office|\[SHOT\]/);
    expect(text).toContain("[STORY CAST]");
    expect(text).not.toMatch(/photorealistic|\bcelebrity\b/i);
  });
});

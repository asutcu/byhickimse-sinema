import { describe, expect, it } from "vitest";
import {
  buildNarratorWorldLock,
  clipNeedsNarratorFilmPlan,
  collectNarratorOnScreenSheets,
  composeNarratorFilmImagePrompt,
  findNarratorCastInText,
  isTalkingHeadTemplate,
  mergeStoryNamesIntoCastMembers,
  mixNarratorShotTypes,
  narratorSupportingCastForPrompt,
  pendingNeedNarratorMix,
  pickNarratorFilmReferencePaths,
  resolveNarratorCastMember,
  textMentionsNarratorName,
  NARRATOR_MAX_SIDE_CAST,
  NARRATOR_WORLD_LOCK_MARKER,
} from "@/server/services/narrator-film";

describe("Anlatici film plani yardimcilari", () => {
  it("dunya kilidinde mekan, hava ve anlatici yasagini yazar", () => {
    const lock = buildNarratorWorldLock({
      era: "2019 Istanbul",
      timeOfDay: "night",
      weather: "rain",
      locations: ["narrow kitchen", "wet street"],
      signatureProps: ["cracked porcelain plate"],
      worldLock: "A worn Istanbul apartment building, yellow hallway bulbs, rain on the street.",
    });
    expect(lock).toContain(NARRATOR_WORLD_LOCK_MARKER);
    expect(lock).toContain("narrow kitchen");
    expect(lock).toContain("cracked porcelain plate");
    expect(lock).toContain("MIXED FEATURE FILM");
    expect(lock).toContain("ON CAMERA");
  });

  it("imagePrompt hikaye kelimelerini ve onceki sahneyi gomur", () => {
    const prompt = composeNarratorFilmImagePrompt({
      worldLock: `${NARRATOR_WORLD_LOCK_MARKER}: rain on wet asphalt.`,
      sceneDescription: "A dim kitchen at night, a man stares at a broken plate",
      dialogue: "O gece mutfakta bir tabak kirildi.",
      clipSeconds: 8,
      previousScene: "He pushes the apartment door open",
      camera: "slow push-in from the doorway",
      lighting: "single practical over the sink",
      secondBySecond: "0-1s: hand on the door; 1-2s: steps onto tile",
    });
    expect(prompt).toContain(NARRATOR_WORLD_LOCK_MARKER);
    expect(prompt).toContain("broken plate");
    expect(prompt).toContain("MATCH-ON-ACTION");
    expect(prompt).toContain("STORY-WORD VISUAL LOCK");
    expect(prompt).toContain("tabak");
    expect(prompt).toContain("slow push-in");
  });

  it("tamamlanmis veya sahnesi+duygusu dolu klibi yeniden planlamaz", () => {
    expect(clipNeedsNarratorFilmPlan({ status: "completed", sceneDescription: "" })).toBe(false);
    expect(
      clipNeedsNarratorFilmPlan({
        status: "draft",
        sceneDescription: "A kitchen",
        emotionLabel: "bastirilmis ofke",
        imagePrompt: "[SHOT] kitchen\n[ENVIRONMENT] tiled kitchen with a window to the wet street",
      })
    ).toBe(false);
    expect(clipNeedsNarratorFilmPlan({ status: "draft", sceneDescription: "" })).toBe(true);
    expect(clipNeedsNarratorFilmPlan({ status: "draft", sceneDescription: "A kitchen", emotionLabel: "" })).toBe(false);
    expect(
      clipNeedsNarratorFilmPlan({
        status: "draft",
        sceneDescription: "A kitchen",
        emotionLabel: "ofke",
        imagePrompt: "[SHOT] kitchen only",
      })
    ).toBe(false);
  });

  it("varsayilan voice-over only: tum klipler cutaway", () => {
    expect(mixNarratorShotTypes(1)).toEqual(["cutaway"]);
    expect(mixNarratorShotTypes(2)).toEqual(["cutaway", "cutaway"]);
    expect(mixNarratorShotTypes(9).every((s) => s === "cutaway")).toBe(true);
  });

  it("voiceOverOnly kapaliysa karisik cekim ~1/3 anlatici", () => {
    expect(mixNarratorShotTypes(1, { voiceOverOnly: false })).toEqual(["narrator"]);
    expect(mixNarratorShotTypes(2, { voiceOverOnly: false })).toEqual(["narrator", "cutaway"]);
    const nine = mixNarratorShotTypes(9, { voiceOverOnly: false });
    expect(nine).toEqual([
      "narrator",
      "cutaway",
      "cutaway",
      "narrator",
      "cutaway",
      "cutaway",
      "narrator",
      "cutaway",
      "narrator",
    ]);
    expect(nine.filter((s) => s === "narrator").length).toBe(4);
  });

  it("voice-over only iken hep-cutaway yeniden plan istemez", () => {
    expect(
      pendingNeedNarratorMix([
        { shotType: "cutaway", status: "draft" },
        { shotType: "cutaway", status: "pending" },
        { shotType: "cutaway", status: "draft" },
      ])
    ).toBe(false);
    expect(pendingNeedNarratorMix([{ shotType: "cutaway", status: "draft" }])).toBe(false);
  });

  it("imagePrompt duygu / oyunculuk / hareket bloklarini yazar", () => {
    const prompt = composeNarratorFilmImagePrompt({
      worldLock: `${NARRATOR_WORLD_LOCK_MARKER}: rain.`,
      sceneDescription: "Elif freezes as Mert steps closer in the hallway",
      dialogue: "Adim adim yaklasti.",
      emotion: "bastirilmis arzu / gerilim",
      performance: "Her breath quickens, gaze drops then locks on his, fingers tighten on the door frame.",
      motion: "He takes one slow step in; curtain lifts in the draft; slow push-in.",
    });
    expect(prompt).toContain("[EMOTION BEAT] bastirilmis arzu / gerilim");
    expect(prompt).toContain("[PERFORMANCE]");
    expect(prompt).toContain("fingers tighten on the door frame");
    expect(prompt).toContain("[MOTION]");
  });

  it("anlatici cekiminde kamerada oldugunu yazar, kesitte yazmaz", () => {
    const onCam = composeNarratorFilmImagePrompt({
      worldLock: `${NARRATOR_WORLD_LOCK_MARKER}: rain.`,
      sceneDescription: "She sits at the kitchen table with wet cheeks",
      dialogue: "O gece sesim kirildi.",
      shotType: "narrator",
    });
    expect(onCam).toContain("[NARRATOR ON CAMERA]");
    expect(onCam).not.toContain("[CUTAWAY]");
    const cut = composeNarratorFilmImagePrompt({
      worldLock: `${NARRATOR_WORLD_LOCK_MARKER}: rain.`,
      sceneDescription: "A dim kitchen, broken plate",
      dialogue: "Tabak kirildi.",
      shotType: "cutaway",
    });
    expect(cut).toContain("[CUTAWAY]");
    expect(cut).not.toContain("[NARRATOR ON CAMERA]");
  });

  it("imagePrompt mevcut bloklari koruyup tam mekan katmanini ekler", () => {
    const prompt = composeNarratorFilmImagePrompt({
      worldLock: `${NARRATOR_WORLD_LOCK_MARKER}: rain.`,
      sceneDescription: "Elif waits at the apartment doorway",
      dialogue: "Disarida yagmur vuruyordu.",
      camera: "slow push-in",
      lighting: "yellow hallway bulb",
      emotion: "hasret",
      settingType: "threshold",
      environment:
        "Worn Istanbul stairwell, chipped cream paint, terrazzo steps, open street door showing rain and parked cars.",
      background:
        "Foreground door frame, mid-ground wet sidewalk, background apartment blocks with lit windows and moving traffic glow.",
      setDressing: "Rusted mailboxes, dripping umbrella, plastic bag of groceries on the step.",
      atmosphere: "Cold rain mist, sodium street light mixing with warm hallway tungsten.",
    });
    expect(prompt).toContain("[SHOT] Elif waits at the apartment doorway");
    expect(prompt).toContain("[CAMERA] slow push-in");
    expect(prompt).toContain("[LIGHTING] yellow hallway bulb");
    expect(prompt).toContain("[EMOTION BEAT] hasret");
    expect(prompt).toContain("[SETTING] threshold");
    expect(prompt).toContain("[ENVIRONMENT]");
    expect(prompt).toContain("terrazzo steps");
    expect(prompt).toContain("[BACKGROUND LAYERS]");
    expect(prompt).toContain("[SET DRESSING]");
    expect(prompt).toContain("[ATMOSPHERE]");
  });

  it("talking-head sablonlarini tanir", () => {
    expect(isTalkingHeadTemplate("She remains seated and looks naturally toward the camera.")).toBe(true);
    expect(isTalkingHeadTemplate("Use the same room, chair, background")).toBe(true);
    expect(isTalkingHeadTemplate("Cinematic coverage of a real dramatized scene")).toBe(false);
  });

  it("sahnede kisi varsa yalnizca o kisinin sheetini kullanir; last-frame karismaz", () => {
    expect(
      pickNarratorFilmReferencePaths({
        previousLastFrame: "C:/frames/002.jpg",
        sceneCharacterImage: "C:/cast/elif.jpg",
        usePrevLastFrame: true,
        useReference: true,
      })
    ).toEqual(["C:/cast/elif.jpg"]);
    expect(
      pickNarratorFilmReferencePaths({
        previousLastFrame: "C:/frames/002.jpg",
        sceneCharacterImages: ["C:/cast/elif.jpg", "C:/cast/ahmet.jpg"],
        usePrevLastFrame: true,
        useReference: true,
      })
    ).toEqual(["C:/cast/elif.jpg", "C:/cast/ahmet.jpg"]);
    expect(
      pickNarratorFilmReferencePaths({
        previousLastFrame: "C:/frames/002.jpg",
        sceneCharacterImage: "C:/cast/elif.jpg",
        usePrevLastFrame: false,
        useReference: false,
      })
    ).toEqual([]);
  });

  it("kisisiz sahnede yalnizca onceki son kareyi kullanir", () => {
    expect(
      pickNarratorFilmReferencePaths({
        previousLastFrame: "C:/frames/002.jpg",
        usePrevLastFrame: true,
        useReference: true,
      })
    ).toEqual(["C:/frames/002.jpg"]);
  });

  it("kadro ismini birebir veya tekil icerikle esler", () => {
    const cast = [{ name: "Ahmet Kaya" }, { name: "Elif" }];
    expect(resolveNarratorCastMember("Ahmet Kaya", cast)?.name).toBe("Ahmet Kaya");
    expect(resolveNarratorCastMember("ahmet", cast)?.name).toBe("Ahmet Kaya");
    expect(resolveNarratorCastMember("Elif", cast)?.name).toBe("Elif");
    expect(resolveNarratorCastMember("YeniYuz", cast)).toBeUndefined();
  });

  it("sahne metninde gecen kadroyu bulur; yanlis parca eslemez", () => {
    const cast = [
      { id: "1", name: "Ahmet Kaya", role: "side" },
      { id: "2", name: "Elif", role: "side" },
      { id: "3", name: "Anlatici", role: "main" },
    ];
    expect(textMentionsNarratorName("kalibre bir isik", "Ali")).toBe(false);
    expect(findNarratorCastInText("Ahmet mutfakta duruyor", cast).map((m) => m.name)).toEqual(["Ahmet Kaya"]);
    expect(
      narratorSupportingCastForPrompt(cast, { sceneDescription: "Elif and Ahmet in the kitchen" }, cast[1]).map(
        (m) => m.name
      )
    ).toEqual(["Ahmet Kaya"]);
    expect(
      narratorSupportingCastForPrompt(cast, {
        shotType: "narrator",
        sceneDescription: "Elif and Ahmet in the kitchen",
        dialogue: "Elif kapida durdu.",
      }).map((m) => m.name)
    ).toEqual([]);
  });

  it("itiraf cekiminde ana karakter sheetini ister, yan kadroyu almaz", () => {
    const r = collectNarratorOnScreenSheets({
      cast: [
        { id: "1", name: "Lena", role: "main", referenceImagePath: null },
        { id: "2", name: "Elif", role: "side", referenceImagePath: "C:/cast/elif.jpg" },
      ],
      shotType: "narrator",
      dialogue: "O gece Elif gelmedi.",
    });
    expect(r.missingNames).toEqual(["Lena"]);
    expect(r.selectedNames).not.toContain("Elif");
  });

  it("imagePrompt'a ekrandaki kadro kilidini yazar", () => {
    const prompt = composeNarratorFilmImagePrompt({
      worldLock: `${NARRATOR_WORLD_LOCK_MARKER}: rain.`,
      sceneDescription: "Elif stands at the sink",
      dialogue: "O gece mutfakta bir tabak kirildi.",
      onScreenCastLock: "Elif: adult woman, long brown hair | wardrobe: denim jacket",
    });
    expect(prompt).toContain("[ON-SCREEN CAST LOCK]");
    expect(prompt).toContain("long brown hair");
  });

  it("imagePrompt NetShort duygu kilidini tasir", () => {
    const prompt = composeNarratorFilmImagePrompt({
      worldLock: "NARRATOR WORLD LOCK: modern city short drama.",
      sceneDescription: "Luxury car interior at night, cold stare out the window.",
      dialogue: "Bosanmak istiyorum.",
      shotType: "cutaway",
      emotion: "sakin yikici kararlilik",
      performance: "cold resolve, turning away",
    });
    expect(prompt).toContain("[EMOTION BEAT]");
    expect(prompt).toContain("sakin yikici");
    expect(prompt).toContain("[NETSHORT EMOTION LOCK]");
    expect(prompt).toMatch(/cold resolve|status contrast|NETSHORT VISUAL EMOTION/i);
  });

  it("hikayedeki Asya GPT 4 kisilik tavanda kadroya eklenir", () => {
    const four = ["Derin", "Kerem", "Ayla", "Emre"].map((name) => ({
      name,
      storyRole: "rol",
      storyNote: "",
      gender: name === "Kerem" || name === "Emre" ? ("male" as const) : ("female" as const),
      age: 30,
      build: "average adult build",
      hairDetail: "shoulder-length dark hair",
      eyeColor: "brown",
      skinTone: "fair light",
      distinctFeature: "",
      accessories: "",
      appearancePrompt: "A named adult from this story, original fictional person.",
      wardrobePrompt: "Everyday city clothes, modest neckline, no logos.",
      voiceNote: "",
    }));
    const story = [
      "Derin beni arabada bırakıp Kerem’le otele girdi.",
      "Asya lobide topuklarını tıkırdatarak bana yukarıdan gülümsedi.",
      "Asya lobide gülümsemeyi unuttu, Asya’nın ağzı aralandı.",
      "Ayla her sabah cam bardakta su uzattı.",
    ].join(" ");
    const merged = mergeStoryNamesIntoCastMembers(four, story);
    expect(merged.map((m) => m.name)).toContain("Asya");
    expect(merged.length).toBeLessThanOrEqual(NARRATOR_MAX_SIDE_CAST);
  });
});

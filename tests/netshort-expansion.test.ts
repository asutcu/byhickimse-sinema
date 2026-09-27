import { describe, expect, it } from "vitest";
import {
  isNarratorHardConflictGenre,
  NARRATOR_GENRE_GROUPS,
  NARRATOR_GENRES,
  NARRATOR_YOUTUBE_RETENTION_LOCK,
  narratorGenreFilmBlock,
  narratorGenreStoryBlock,
  narratorNetShortStorySystemLock,
  resolveNarratorGenre,
} from "@/lib/narrator-genres";
import { isLongformDramaGenre, longformGenreById, LONGFORM_GENRES } from "@/lib/longform-catalog";
import { buildLongformBeatVisuals } from "@/lib/longform-netshort-stills";
import { compactPromptForFlow, FLOW_PROMPT_MAX } from "@/lib/flow-prompt-compact";
import { rewritePromptAfterPolicyBlock, softenPolicyBlockedPrompt } from "@/lib/flow-prompt-safety";
import { buildClipPrompt, longformStillStyleText, VISUAL_STYLE_PRESETS } from "@/server/services/prompt-builder";
import { elevenV3TagsFor, ttsPerformanceFor } from "@/lib/tts-performance";
import { listNetShortSummaries, summariesMatchingGenres } from "@/lib/netshort-summaries";

describe("NetShort tur genislemesi", () => {
  it("12 yeni tur cozumlenir ve gruplara dagilmistir", () => {
    const newIds = [
      "hesap-sorma",
      "guclu-donus",
      "yeniden-dogus",
      "kadin-gelisimi",
      "gizli-kimlik",
      "sozlesmeli-evlilik",
      "yildirim-nikahi",
      "zengin-aile",
      "pismanlik",
      "trajik-ask",
      "aile-bagi",
      "ahlaki-ikilem",
    ] as const;
    const groupIds = NARRATOR_GENRE_GROUPS.flatMap((g) => g.ids);
    for (const id of newIds) {
      const genre = NARRATOR_GENRES.find((g) => g.id === id);
      expect(genre, id).toBeTruthy();
      expect(genre!.storyPrompt).toContain("TUR KILIDI");
      expect(genre!.topicSuggestions.length).toBeGreaterThanOrEqual(2);
      expect(genre!.netShortTags?.length).toBeGreaterThan(0);
      expect(groupIds).toContain(id);
    }
  });

  it("NetShort etiket adlari da tur cozumlemesine girer", () => {
    expect(resolveNarratorGenre("Hesap Sorma").id).toBe("hesap-sorma");
    expect(resolveNarratorGenre("Güçlü Dönüş").id).toBe("guclu-donus");
    expect(resolveNarratorGenre("Sözleşmeli Aşk").id).toBe("sozlesmeli-evlilik");
    expect(resolveNarratorGenre("Aşk Üçgeni").id).toBe("zengin-aile");
    expect(resolveNarratorGenre("Pişmanlık").id).toBe("pismanlik");
  });

  it("yeni dram turleri hard-conflict ve longform drama listesindedir", () => {
    expect(isNarratorHardConflictGenre("hesap-sorma")).toBe(true);
    expect(isNarratorHardConflictGenre("gizli-kimlik")).toBe(true);
    expect(isLongformDramaGenre("hesap-sorma")).toBe(true);
    expect(isLongformDramaGenre("zengin-aile")).toBe(true);
    expect(LONGFORM_GENRES.some((g) => g.id === "yildirim-nikahi")).toBe(true);
    expect(longformGenreById("gizli-kimlik").visualLock).toMatch(/NetShort short-drama still/);
  });

  it("hikaye blogu YouTube tutma kilidini ve tur filtreli ornekleri tasir", () => {
    const block = narratorGenreStoryBlock("hesap-sorma");
    expect(block).toContain("YOUTUBE IZLEYICI TUTMA");
    expect(block).toMatch(/ILK 15 SANIYE/);
    expect(block).toMatch(/mini-cliffhanger/i);
    expect(NARRATOR_YOUTUBE_RETENTION_LOCK).toMatch(/dur be/);
  });

  it("ozet bankasi genisledi ve yeni turlere ornek verir", () => {
    expect(listNetShortSummaries().length).toBeGreaterThanOrEqual(290);
    const picks = summariesMatchingGenres(["Gizli Kimlik"], 3);
    expect(picks.length).toBeGreaterThan(0);
    const pismanlik = summariesMatchingGenres(["Pişmanlık"], 3);
    expect(pismanlik.length).toBeGreaterThan(0);
  });

  it("yeni turle gorsel anlati karesi 8000 icinde kalir", () => {
    const visuals = buildLongformBeatVisuals(
      [
        { narration: "Ablama bobregimi verdim; Meral beni evden atti." },
        { narration: "Meral 'sen zaten fazlaliktin' dedi, yuzum dondu." },
      ],
      {
        visualLock: longformGenreById("hesap-sorma").visualLock,
        genreId: "hesap-sorma",
        storyText: "Meral ve Kerem. Hesap sorma hikayesi.",
      }
    );
    expect(visuals[0].imagePrompt).toContain("[STILL BEAT]");
    expect(visuals[0].imagePrompt.length).toBeLessThan(4500);
    const { text } = compactPromptForFlow(visuals[0].imagePrompt, "Turkish");
    expect(text.length).toBeLessThanOrEqual(FLOW_PROMPT_MAX);
    expect(text.length).toBeLessThan(8000);
  });

  it("gorsel anlati drama kareleri sinema stil presetiyle ayni dili konusur", () => {
    // Varsayilan (yeni longform "documentary-stills" isareti) → sinematik preset + gerceklik katmani
    const auto = longformStillStyleText("documentary-stills");
    expect(auto).toMatch(/ReelShort \/ NetShort premium short-drama look/);
    expect(auto).toMatch(/Film-camera physics/);
    expect(longformStillStyleText("")).toBe(auto);
    // Kullanici projede baska preset sectiyse ona uyulur
    expect(longformStillStyleText("photorealistic")).toMatch(/Cinematic live-action short drama/);

    // Kare promptuna stil gercekten girer ve butce asilmaz
    const visuals = buildLongformBeatVisuals(
      [{ narration: "Meral 'sen zaten fazlaliktin' dedi, yuzum dondu." }],
      {
        visualLock: auto,
        genreId: "hesap-sorma",
        storyText: "Meral ve Kerem. Hesap sorma hikayesi.",
      }
    );
    expect(visuals[0].imagePrompt).toMatch(/ReelShort \/ NetShort premium short-drama look/);
    const { text } = compactPromptForFlow(visuals[0].imagePrompt, "Turkish");
    expect(text.length).toBeLessThanOrEqual(FLOW_PROMPT_MAX);
  });

  it("yeni turle sinema klip promptu compact sonrasi 8000 icinde kalir ve sureklilik dusmez", () => {
    const prompt = buildClipPrompt({
      project: {
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
        genre: "gizli-kimlik",
      },
      character: {
        baseAppearancePrompt: "A 30-year-old adult woman with dark hair.",
        baseWardrobePrompt: "simple knit sweater",
        baseEnvironmentPrompt: "modern living room",
        baseCameraPrompt: "Fixed tripod camera.",
        baseVoicePrompt: "calm warm female voice",
        negativePrompt: "",
        flowCharacterReference: "",
      },
      clip: {
        dialogue: "Sirkete sofor olarak girdim; kimse bilmiyordu, sirket benimdi.",
        index: 3,
        sceneDescription: "Glass office lobby, uniformed driver watching the managers",
        voiceTone: "sakin yikici",
        imagePrompt: "",
        emotionLabel: "gizli guc sabri",
        shotType: "cutaway",
      },
      isFirstClip: false,
      previousClip: {
        index: 2,
        sceneDescription: "Parking garage, the driver opens the door",
        imagePrompt: "",
        dialogue: "Kapiyi actim.",
        emotionLabel: "",
        voiceTone: "",
      },
    });
    // Ham bütçe +~800: tüm filmde aynı gerçeklik kilidi (REALITY LOCK) eklendi.
    expect(prompt.length).toBeLessThan(9500);
    const { text } = compactPromptForFlow(prompt, "Turkish", 2600);
    expect(text.length).toBeLessThanOrEqual(2600);
    expect(text).toContain("Sirkete sofor olarak girdim");
    expect(text).toMatch(/MATCH-ON-ACTION|SCENE CONTINUITY/i);
  });
});

describe("politika yumusatma suzgeci", () => {
  it("gorunum superlatiflerini ve unlu dilini notralize eder", () => {
    const soft = softenPolicyBlockedPrompt(
      "@Lina\nA stunning, very beautiful woman resembling a famous actress, glamorous model look, perfect skin."
    );
    expect(soft).not.toMatch(/stunning|famous|actress|glamorous|resembling/i);
    expect(soft).toContain("[ORDINARY STORY PEOPLE]");
    expect(soft).not.toMatch(/@Lina/);
  });

  it("sahne ve diyalog metnine dokunmaz", () => {
    const soft = softenPolicyBlockedPrompt('[SHOT] kitchen table\n"Bosanmak istiyorum." dedi.');
    expect(soft).toContain("[SHOT] kitchen table");
    expect(soft).toContain("Bosanmak istiyorum");
  });

  it("politika kademeleri süzgeç → yumusak → sifir sirasini korur", () => {
    const raw = '[STORY CAST] famous actress\n[SHOT] kitchen\n"Cik git."';
    expect(rewritePromptAfterPolicyBlock(raw, 1)).not.toMatch(/famous|actress/i);
    expect(rewritePromptAfterPolicyBlock(raw, 1)).toContain("Cik git");
    expect(rewritePromptAfterPolicyBlock(raw, 2)).not.toMatch(/famous|actress/i);
    expect(rewritePromptAfterPolicyBlock(raw, 3)).not.toMatch(/\[STORY CAST\]/);
  });
});

describe("sertlik/acimasizlik hikaye kilidi", () => {
  it("hikaye sistem + user bloklari bes sinifli sertlik kilidini tasir", () => {
    for (const block of [narratorNetShortStorySystemLock("aldatma"), narratorGenreStoryBlock("Gizli kimlik")]) {
      expect(block).toContain("SERTLIK ZORUNLU");
      expect(block).toContain("KAMUSAL ASAGILAMA");
      expect(block).toContain("EZME HAMLESI");
      expect(block).toContain("ACIMASIZ PISKINLIK");
      expect(block).toContain("EZME DONUSU");
      expect(block).toMatch(/kan, silah, oldurme/);
    }
  });

  it("film plani blogu sertlik dokumunu TASIMAZ (parti suresi sismesin)", () => {
    expect(narratorGenreFilmBlock("Gizli kimlik")).not.toContain("SERTLIK ZORUNLU");
  });
});

describe("gorsel stil presetleri sinema kalitesi", () => {
  it("gercekci ve sinematik tarifler suzgece takilmaz ve olculudur", () => {
    for (const id of ["photorealistic", "cinematic"] as const) {
      const preset = VISUAL_STYLE_PRESETS.find((p) => p.id === id)!;
      expect(preset.prompt.length).toBeGreaterThan(400);
      expect(preset.prompt.length).toBeLessThan(1200);
      expect(preset.prompt).not.toMatch(/photoreal|celebrity|skin pores|supermodel|red carpet/i);
      expect(preset.prompt).toMatch(/35mm/);
      expect(preset.prompt).toMatch(/practical/i);
    }
  });
});

describe("ElevenLabs v3 duygu etiketleri", () => {
  it("mood ve metinden dogru etiketler cikar", () => {
    expect(elevenV3TagsFor("angry", "Yeter artik, defol!")).toContain("[shouts]");
    expect(elevenV3TagsFor("sad", "Gozyaslarim aktı, agladim.")).toContain("[crying]");
    expect(elevenV3TagsFor("cold", "Imzala ve git.")).toEqual(["[coldly]"]);
    expect(elevenV3TagsFor("calm", "Sakin bir gun.")).toEqual([]);
  });

  it("voiceTone da performansa katilir", () => {
    const perf = ttsPerformanceFor({ emotion: "", voiceTone: "donuk ofke", text: "Cik git." });
    expect(perf.mood).toBe("angry");
    expect(perf.elevenV3Tags.length).toBeGreaterThan(0);
  });
});

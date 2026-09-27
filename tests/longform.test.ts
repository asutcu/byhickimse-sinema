import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampLongformPitch,
  clampLongformSpeed,
  DEFAULT_LONGFORM_SETTINGS,
  longformDefaultSpeed,
  estimateLongformStillCount,
  formatLongformCastBudget,
  longformNamedCastBudget,
  parseLongformSettings,
  serializeLongformSettings,
  longformGenreById,
  longformStoredGenreName,
  narratorFormatLabel,
  resolveLongformGenre,
  isLongformDramaGenre,
  LONGFORM_GENRES,
  LONGFORM_GENRE_IDS,
} from "@/lib/longform-catalog";
import {
  isLongform,
  isListedNarration,
  isNarratorFamily,
  isNarratorSectionPath,
  projectWorkspaceHref,
  usesStudioWizard,
  templateLabel,
  TEMPLATE_TYPES,
} from "@/lib/templates";
import { curiosityRulesFor, CURIOSITY_LONGFORM_RULES, CURIOSITY_CORE_RULES, curiosityRulesForLongform } from "@/server/services/curiosity";
import { planLongformActs, splitNarrationIntoBeats, fallbackImagePrompt, mapPool, isLongformMusicFileName, mergeLongformNamedPeople } from "@/server/services/longform";
import { allocateSentenceTimes, splitSentences, splitTextForTts, sanitizeLongformSpeech } from "@/server/services/tts";
import { buildKenBurnsFilter, buildStillHoldFilter, kenBurnsMotionForIndex } from "@/server/services/ken-burns";
import { buildPitchFilter } from "@/server/services/ffmpeg";
import { buildSrtCuesFromTimestamps, buildSrtContent } from "@/server/services/srt";

describe("Uzun form sablon", () => {
  it("templateType listesinde longform vardir", () => {
    expect(TEMPLATE_TYPES).toContain("longform");
    expect(isLongform("longform")).toBe(true);
    expect(isLongform("narrator")).toBe(false);
    expect(usesStudioWizard("longform")).toBe(true);
    expect(usesStudioWizard("narrator")).toBe(false);
    expect(templateLabel("longform")).toBe("Gorsel Anlati");
    expect(isNarratorFamily("longform")).toBe(true);
    expect(isNarratorFamily("narrator")).toBe(true);
    expect(isListedNarration("kids_animation")).toBe(true);
    expect(isListedNarration("kids_song")).toBe(false);
    expect(projectWorkspaceHref({ id: "abc", templateType: "longform" })).toBe("/anlatici/abc");
    expect(projectWorkspaceHref({ id: "abc", templateType: "narrator" })).toBe("/anlatici/sinema/abc");
    expect(projectWorkspaceHref({ id: "abc", templateType: "kids_animation" })).toBe("/anlatici/sinema/abc");
  });

  it("anlatici adresleri dogru taninir", () => {
    expect(isNarratorSectionPath("/anlatici")).toBe(true);
    expect(isNarratorSectionPath("/anlatici/sinema/abc")).toBe(true);
    expect(isNarratorSectionPath("/projects/abc")).toBe(false);
  });

  it("yeni anlati sayfasinda longform ve sinema secenekleri vardir", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/anlatici/yeni/page.tsx"), "utf8");
    expect(source).toContain("Hikaye oner");
    expect(source).toContain("NarratorGenrePicker");
    expect(source).toContain("/api/narrator/suggest-topic");
    expect(source).toMatch(/longform|narrator/);
  });

  it("eski cocuk yeni-proje sayfasi kaldirilmistir", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/app/projects/new/page.tsx"))).toBe(false);
  });

  it("anlatici yeni sayfasinda Hikaye oner butonu ve aldatma / yasak ask vardir", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/anlatici/yeni/page.tsx"), "utf8");
    expect(source).toContain("Hikaye oner");
    expect(source).toContain("NarratorGenrePicker");
    expect(source).toContain("/api/narrator/suggest-topic");
    expect(source).toContain("LongformImageSourcePicker");
    expect(source).toContain("SubtitleStyleFields");
    expect(source).toContain("Alt yazı");
    expect(source).toContain("Seslendirme");
    expect(source).toContain("ElevenLabs");
    expect(source).toContain("Duygulu anlatım");
    expect(source).toContain("Ozel tur adi");
    expect(source).toContain("Anlatı adı");
    expect(source).toContain("Çizgi film");
    expect(source).toContain("kids_animation");
    expect(source).toContain("3D animasyon");
    expect(source).toContain("2D anime");
    expect(source).toContain("Yaş aralığı");
    expect(source).toContain("NarrationNameField");
    expect(source).not.toContain("!isStills && cinemaGenreId === \"ozel\"");
    const picker = fs.readFileSync(path.join(process.cwd(), "src/components/longform-image-source-picker.tsx"), "utf8");
    expect(picker).toContain("FlowImageModelField");
    expect(picker).toContain("Nano Banana 2");
    // Tek resim motoru: OpenAI / gpt-image-1 secenegi kalmadi.
    expect(picker).not.toContain("OpenAI");
    expect(picker).not.toContain("gpt-image");
  });
});

describe("Uzun form ayarlari", () => {
  it("aldatma ve yasak ask hikaye turleri katalogdadir", () => {
    const labels = LONGFORM_GENRES.map((g) => g.label);
    expect(labels).toContain("Aldatma");
    expect(labels).toContain("Yasak ask");
    expect(longformGenreById("aldatma").id).toBe("aldatma");
    expect(longformGenreById("yasak-ask").id).toBe("yasak-ask");
    expect(LONGFORM_GENRE_IDS).toContain("aldatma");
    expect(LONGFORM_GENRE_IDS).toContain("yasak-ask");
    expect(LONGFORM_GENRE_IDS).toContain("ozel");
    expect(LONGFORM_GENRES.map((g) => g.id).sort()).toEqual([...LONGFORM_GENRE_IDS].sort());
  });

  it("ozel tur adini saklar ve hikaye etiketine yazar", () => {
    expect(isLongformDramaGenre("ozel")).toBe(true);
    const parsed = parseLongformSettings(
      JSON.stringify({ genreId: "ozel", customGenre: "  ikinci es  " })
    );
    expect(parsed.genreId).toBe("ozel");
    expect(parsed.customGenre).toBe("ikinci es");
    expect(resolveLongformGenre(parsed).label).toBe("ikinci es");
    expect(longformStoredGenreName(parsed)).toBe("ikinci es");
    expect(parseLongformSettings(serializeLongformSettings(parsed)).customGenre).toBe("ikinci es");
  });

  it("bos veya bozuk JSON icin varsayilan doner", () => {
    expect(parseLongformSettings("").genreId).toBe("mystery");
    expect(parseLongformSettings("{").voiceId).toBe("female");
    expect(parseLongformSettings("{}").stillIntervalSeconds).toBe(15);
    expect(parseLongformSettings("{}").visualFormat).toBe("stills");
    expect(parseLongformSettings("{}").stillMotion).toBe("hold");
    expect(parseLongformSettings("{}").imageProvider).toBe("flow");
    expect(parseLongformSettings("{}").imageModel).toBe("Nano Banana 2");
    expect(parseLongformSettings("{}").subtitles.enabled).toBe(false);
    expect(parseLongformSettings("{}").subtitles.position).toBe("bottom");
  });

  it("degerleri kirpar ve serilestirir", () => {
    const parsed = parseLongformSettings(
      JSON.stringify({
        genreId: "sleep",
        voiceId: "male",
        ttsSpeed: 3,
        ttsPitch: 20,
        stillIntervalSeconds: 20,
        visualFormat: "stills",
        stillMotion: "kenburns",
      })
    );
    expect(parsed.genreId).toBe("sleep");
    expect(parsed.voiceId).toBe("male");
    expect(parsed.ttsSpeed).toBe(1.3);
    expect(parsed.ttsPitch).toBe(6);
    expect(parsed.stillMotion).toBe("kenburns");
    expect(parsed.visualFormat).toBe("stills");
    expect(parseLongformSettings(JSON.stringify({ stillIntervalSeconds: 10 })).stillIntervalSeconds).toBe(10);
    expect(narratorFormatLabel("stills")).toBe("Gorsel slayt");
    expect(narratorFormatLabel("video")).toBe("Video");
    const roundtrip = parseLongformSettings(serializeLongformSettings(parsed));
    expect(roundtrip).toEqual(parsed);
    expect(roundtrip.imageProvider).toBe("flow");
    expect(roundtrip.imageModel).toBe("Nano Banana 2");
  });

  it("konusma hizi %10 artmis varsayilanla gelir, eski varsayilan kayitlari tasir", () => {
    expect(DEFAULT_LONGFORM_SETTINGS.ttsSpeed).toBe(1.1);
    expect(longformDefaultSpeed({ defaultSpeed: 1 })).toBe(1.1);
    // Eski kayitta 1 duruyorsa yeni varsayilana tasinir
    expect(parseLongformSettings(JSON.stringify({ genreId: "aldatma", ttsSpeed: 1 })).ttsSpeed).toBe(1.1);
    // Kullanicinin bilincli sectigi deger korunur
    expect(parseLongformSettings(JSON.stringify({ genreId: "aldatma", ttsSpeed: 1.25 })).ttsSpeed).toBe(1.25);
    expect(parseLongformSettings(JSON.stringify({ genreId: "aldatma", ttsSpeed: 0.8 })).ttsSpeed).toBe(0.8);
  });

  it("flow fotograf modeli gecerliyse aynen kalir, gecersizse varsayilana (Nano Banana 2) doner", () => {
    const parsed = parseLongformSettings(
      JSON.stringify({ imageProvider: "flow", imageModel: "Nano Banana Pro" })
    );
    expect(parsed.imageProvider).toBe("flow");
    expect(parsed.imageModel).toBe("Nano Banana Pro");
    expect(parseLongformSettings(serializeLongformSettings(parsed)).imageModel).toBe("Nano Banana Pro");
    expect(
      parseLongformSettings(JSON.stringify({ imageProvider: "flow", imageModel: "Nano Banana 2" })).imageModel
    ).toBe("Nano Banana 2");
    expect(
      parseLongformSettings(JSON.stringify({ imageProvider: "flow", imageModel: "gecersiz-model" })).imageModel
    ).toBe("Nano Banana 2");
  });

  it("hiz ve perde yardimcilari sinirda kalir", () => {
    expect(clampLongformSpeed(0.2)).toBe(0.7);
    expect(clampLongformPitch(-12)).toBe(-6);
    expect(estimateLongformStillCount(1800, 10)).toBe(180);
    expect(estimateLongformStillCount(1800, 15)).toBe(120);
    expect(estimateLongformStillCount(1800, 20)).toBe(90);
  });

  it("tur kilitleri yazisiz kare ister", () => {
    expect(longformGenreById("history").visualLock).toMatch(/no text/i);
  });
});

describe("Parcali senaryo plani", () => {
  it("40 dakikada acilis + orta + kapanis uretir ve kelime toplami hedefe yakindir", () => {
    const plan = planLongformActs(2400, 130);
    expect(plan[0].role).toBe("opening");
    expect(plan[plan.length - 1].role).toBe("closing");
    expect(plan[plan.length - 1].cliffhanger).toBe(false);
    expect(plan.some((a) => a.cliffhanger)).toBe(true);
    const words = plan.reduce((sum, a) => sum + a.targetWords, 0);
    expect(words).toBeGreaterThan(4500);
    expect(words).toBeLessThan(6000);
    expect(plan.length).toBeGreaterThanOrEqual(6);
  });

  it("15 dakikada daha az bolum kullanir", () => {
    const shortPlan = planLongformActs(900, 130);
    const longPlan = planLongformActs(3600, 130);
    expect(shortPlan.length).toBeLessThan(longPlan.length);
  });

  it("10 dakikalik gorsel anlati kadrosu 2-3 kisiyle kalmaz", () => {
    expect(longformNamedCastBudget(300)).toEqual({ min: 3, max: 4 });
    expect(longformNamedCastBudget(600)).toEqual({ min: 5, max: 7 });
    expect(longformNamedCastBudget(1800)).toEqual({ min: 7, max: 9 });
    expect(formatLongformCastBudget(longformNamedCastBudget(600))).toBe("5-7");
    const merged = mergeLongformNamedPeople(
      [
        { name: "Kerem", storyRole: "koca", gender: "male" },
        { name: "Lina", storyRole: "es", gender: "female" },
      ],
      "Kerem gulumsedi. Sevil kapida durdu. Lina donup baktı. Avukat Baran evragi uzatti.",
      7
    );
    expect(merged.map((p) => p.name)).toEqual(expect.arrayContaining(["Kerem", "Lina", "Sevil", "Baran"]));
    expect(merged.length).toBeGreaterThanOrEqual(4);
    expect(merged.length).toBeLessThanOrEqual(7);
  });
});

describe("Beat listesi", () => {
  it("10 ve 15 saniyelik aralikta daha cok kare uretir", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Bu ${i + 1}. cumle belgesel akisini ileri tasiyor.`).join(" ");
    const beats10 = splitNarrationIntoBeats(text, 10, 130);
    const beats15 = splitNarrationIntoBeats(text, 15, 130);
    const beats20 = splitNarrationIntoBeats(text, 20, 130);
    expect(beats10.length).toBeGreaterThanOrEqual(beats15.length);
    expect(beats15.length).toBeGreaterThanOrEqual(beats20.length);
    expect(beats10.every((b) => b.narration.length > 0)).toBe(true);
  });

  it("cumleleri 20 sn butcesine gore gruplar", () => {
    const text =
      "Ilk sir geceleri ortaya cikti. Arsivde bir sayfa eksikti. Hakim dosyayi kapatti. Ertesi sabah yeni bir mektup geldi. Imza yoktu. Mum isigi titredi.";
    const beats = splitNarrationIntoBeats(text, 20, 130);
    expect(beats.length).toBeGreaterThanOrEqual(1);
    expect(beats.every((b) => b.narration.length > 0)).toBe(true);
    expect(beats.reduce((sum, b) => sum + b.wordCount, 0)).toBeGreaterThan(10);
  });

  it("bos metinde bos liste doner", () => {
    expect(splitNarrationIntoBeats("   ", 20, 130)).toEqual([]);
  });

  it("yedek gorsel promptu yaziyi yasaklar ve konusmayi ekrana yazdirmaz", () => {
    const prompt = fallbackImagePrompt("Sarayda bir kutu acildi.", "photoreal documentary still, no text");
    expect(prompt).toMatch(/zero written characters/i);
    expect(prompt.toLowerCase()).not.toContain("illustrating:");
    expect(prompt).toMatch(/Sarayda|kutu/i);
  });
});

describe("TTS zaman damgasi", () => {
  it("cumleleri ayirir ve 4096 sinirina boler", () => {
    expect(splitSentences("Bir. Iki! Uc?")).toEqual(["Bir.", "Iki!", "Uc?"]);
    const long = `${"Kelime ".repeat(900)}. Son.`;
    const chunks = splitTextForTts(long, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 400)).toBe(true);
  });

  it("ses metninden sahne notu ve konusmaci etiketini ayiklar", () => {
    expect(sanitizeLongformSpeech("[Sahne: mutfak]\nAyse: Kapı acildi.")).toBe("Kapı acildi.");
    expect(sanitizeLongformSpeech("Mutfaktaki kirik tabak duruyor.")).toBe("Mutfaktaki kirik tabak duruyor.");
  });

  it("sureyi kelime agirligina gore dagitir", () => {
    const times = allocateSentenceTimes(["Kisa.", "Bu cok daha uzun bir cumle olsun."], 10, 10);
    expect(times).toHaveLength(2);
    expect(times[0].startSeconds).toBe(10);
    expect(times[1].endSeconds).toBe(20);
    expect(times[1].startSeconds).toBeGreaterThan(times[0].endSeconds - 0.01);
  });
});

describe("Ken Burns ve perde", () => {
  it("zoompan filtresi sure ve boyutu yansitir", () => {
    const filter = buildKenBurnsFilter({ durationSeconds: 20, width: 1920, height: 1080, fps: 24, motion: "zoom-in" });
    expect(filter).toContain("zoompan");
    expect(filter).toContain("1920x1080");
    expect(filter).toContain("d=480");
    expect(kenBurnsMotionForIndex(1)).toBe("pan-right");
    expect(buildStillHoldFilter()).toContain("scale=1920:1080");
    expect(buildStillHoldFilter()).not.toContain("zoompan");
  });

  it("sifir perdede filtre uretmez, artida asetrate kullanir", () => {
    expect(buildPitchFilter(0)).toBe("");
    expect(buildPitchFilter(2)).toContain("asetrate=");
    expect(buildPitchFilter(2)).toContain("atempo=");
  });
});

describe("SRT zaman damgasi", () => {
  it("TTS kuyruklarindan SRT yazar", () => {
    const cues = buildSrtCuesFromTimestamps([
      { text: "Ilk cumle burada.", startSeconds: 0, endSeconds: 2.5 },
      { text: "Ikinci cumle devam eder.", startSeconds: 2.5, endSeconds: 5 },
    ]);
    expect(cues.length).toBeGreaterThanOrEqual(2);
    const srt = buildSrtContent(cues);
    expect(srt).toContain("-->");
    expect(srt).toContain("Ilk cumle");
  });
});

describe("Merak kurallari uzun form", () => {
  it("belgesel kancasi ve ucuncu tekil kilitleri ekler", () => {
    const rules = curiosityRulesFor("longform");
    expect(rules).toContain(CURIOSITY_CORE_RULES);
    expect(rules).toContain(CURIOSITY_LONGFORM_RULES);
    expect(rules).toContain("UCUNCU TEKIL");
    expect(rules).toContain("8-12");
    expect(rules).toContain("FILM SONU");
  });

  it("aldatma slaytinda birinci tekil belgesel ben-yasagini ezer", () => {
    const drama = curiosityRulesForLongform("aldatma");
    expect(drama).toContain("BIRINCI TEKIL");
    expect(drama).toContain("FILM SONU");
    expect(drama).toContain("NETSHORT");
    expect(drama).not.toContain("UCUNCU TEKIL: Kameraya");
    const doc = curiosityRulesForLongform("mystery");
    expect(doc).toContain("UCUNCU TEKIL");
  });
});

describe("Otomatik muzik", () => {
  it("TTS ve voice artigini muzik saymaz", () => {
    expect(isLongformMusicFileName("tts-part-001.wav")).toBe(false);
    expect(isLongformMusicFileName("voice.wav")).toBe(false);
    expect(isLongformMusicFileName("voice-013.wav")).toBe(false);
    expect(isLongformMusicFileName("voice-raw.wav")).toBe(false);
    expect(isLongformMusicFileName("gerilim-alt.mp3")).toBe(true);
    expect(isLongformMusicFileName("README.md")).toBe(false);
  });
});

describe("mapPool", () => {
  it("sirayi koruyarak paralel calisir", async () => {
    const result = await mapPool([1, 2, 3, 4], 2, async (n) => n * 2);
    expect(result).toEqual([2, 4, 6, 8]);
  });
});

describe("Gorsel slayt parcalama", () => {
  it("beat gorsel promptlari ayri openai turu ile kitlenmez", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/server/services/longform.ts"), "utf8");
    expect(source).not.toContain("longform_beat_visuals");
    expect(source).toContain("attachBeatVisualsLocal");
    expect(source).toContain("buildLongformBeatVisuals");
  });

  it("studyoda tek uret dugmesi vardir, parca parca adim butonu yok", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/project/longform-studio-tab.tsx"), "utf8");
    expect(source).toContain("Gorselleri uret");
    expect(source).not.toContain('["beats", "Parcala"]');
    expect(source).not.toContain('["stills", "Gorsel"]');
  });

  it("render kartinda alt yazi acilip filme basilabilir", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/project/longform-studio-tab.tsx"), "utf8");
    expect(source).toContain("Slayti render et");
    expect(source).toContain("SubtitleStyleFields");
    expect(source).toContain("Alt yazı burada filme basılır");
  });
});

import { describe, expect, it } from "vitest";
import {
  craftThumbnailOverlayText,
  craftThumbnailOverlayVariants,
  detectCoverTopicKey,
  enhanceThumbnailPrompt,
  filmCoverLanguage,
  forceShortCuriosityDescription,
  normalizePublishMeta,
  overlayLanguageMismatch,
  pickDiverseThumbnailCandidate,
  rankThumbnailClips,
  tightenCuriosityDescription,
  topicAlignedTagPack,
} from "@/server/services/publish";
import {
  extractListingBrief,
  groundListingTitle,
  isKeywordSaladTitle,
  spoilerSafeSetup,
} from "@/lib/youtube-listing";

describe("Yayin meta normalize", () => {
  it("eksik baslik/etiket/thumbnail alanlarini tamamlar", () => {
    const meta = normalizePublishMeta(
      {
        titleVariants: ["Tilki zirvede"],
        primaryTitle: "",
        description: "Kisa.",
        tags: ["tilki"],
        hashtags: [],
        seoKeywords: { primary: "", secondary: [] },
        targetAudience: "",
        thumbnailPrompt: "",
        thumbnailText: "",
        thumbnailConcepts: [],
        chapters: [],
        pinnedComment: "",
        communityPost: "",
        shortsHooks: [],
        endScreenCta: "",
        postingStrategy: "",
        uploadChecklist: [],
        kidsSafetyNotes: "",
        contentWarnings: [],
        seriesHook: "",
      },
      { titleFallback: "Dag Macerasi", isKids: true, totalSeconds: 120 }
    );

    expect(meta.primaryTitle.length).toBeGreaterThan(3);
    expect(meta.titleVariants.length).toBeGreaterThanOrEqual(5);
    expect(meta.description.length).toBeGreaterThan(40);
    expect(meta.tags.length).toBeGreaterThanOrEqual(8);
    expect(meta.tags.length).toBeLessThanOrEqual(15);
    expect(meta.hashtags.length).toBeGreaterThanOrEqual(3);
    expect(meta.hashtags.length).toBeLessThanOrEqual(5);
    expect(meta.tags.join(" ")).not.toMatch(/\byoutube\b/i);
    expect(meta.chapters[0]?.time).toBe("0:00");
    expect(meta.thumbnailConcepts.length).toBeGreaterThanOrEqual(3);
    expect(meta.thumbnailPrompt.length).toBeGreaterThan(20);
    expect(meta.uploadChecklist.length).toBeGreaterThanOrEqual(6);
    expect(meta.kidsSafetyNotes.length).toBeGreaterThan(10);
  });

  it("aciklama fallback film ozeti gibi degil merak on-bilgisi yazar", () => {
    const meta = normalizePublishMeta(
      {
        titleVariants: [],
        primaryTitle: "Karlı Zirve",
        description: "x",
        tags: [],
        hashtags: [],
        seoKeywords: { primary: "", secondary: [] },
        targetAudience: "",
        thumbnailPrompt: "enough characters here for thumb",
        thumbnailText: "Neler Oldu Neler?",
        thumbnailConcepts: [
          { name: "A", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt xx" },
          { name: "B", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt yy" },
          { name: "C", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt zz" },
        ],
        chapters: [
          { time: "0:00", label: "Bas", beat: "" },
          { time: "1:00", label: "Orta", beat: "" },
          { time: "2:00", label: "Son", beat: "" },
        ],
        pinnedComment: "y".repeat(40),
        communityPost: "z".repeat(50),
        shortsHooks: ["a", "b", "c"],
        endScreenCta: "cta text here enough",
        postingStrategy: "strategy text here enough chars ok",
        uploadChecklist: ["1", "2", "3", "4", "5", "6"],
        kidsSafetyNotes: "",
        contentWarnings: [],
        seriesHook: "",
      },
      { titleFallback: "Karlı Zirve", isKids: true, totalSeconds: 90 }
    );
    expect(meta.description).toMatch(/değişiyor|İzle|merak|ne oluyor/i);
    expect(meta.description.length).toBeLessThan(450);
    expect(meta.description).not.toMatch(/Sonunda zirveye vardılar|hikayenin ozeti/i);
  });

  it("uzun aciklamayi kisa merak metnine sikiştirir", () => {
    const long = `Sis kısalıyor, rüzgârın tonu değişiyor: Üç küçük kâşif Everest'in buz köprülerinde adım ritmini bulabilecek mi? Bir ip, bir jumar ve çokça dostluk—gizemli geçitlerin sırrı burada açığa çıkıyor.
Gerçek bir tırmanışta olması gereken her şey bu çocuk animasyonunda: emniyet kemeri, karabina, sekizli düğüm, jumar, ara emniyet ve ekip içi komutlarla ilerleyen güvenli bir rota. Tona, Mete ve Nima; sisin ardındaki mavi buza giriş penceresini yakalayıp South Col'un altın ışığına ulaşmaya çalışırken, buz köprülerini test ediyor.
Eğer gerçekçi dağcılık ayrıntılarını içeren çocuk animasyonlarını seviyorsanız, bu gizem dolu yolculukta bize katılın ve yeni maceraları kaçırmamak için abone olmayı unutmayın.

#everest #çocuk`;
    const tight = forceShortCuriosityDescription(long, { title: "Karlı Zirve", hashtags: ["#macera"] });
    expect(tight.length).toBeLessThan(480);
    expect(tight).not.toMatch(/abone|emniyet kemeri|South Col/i);
    expect(tight.split(/(?<=[.!?…])\s+/).length).toBeLessThanOrEqual(4);
  });

  it("etiketleri film konusuna kilitler, jenerik youtube doldurmaz", () => {
    const tags = topicAlignedTagPack({
      title: "Der Chef lügt",
      topic: "Hart und Wilde Holding, Ehe, Geheimnis",
      genre: "Drama",
      language: "German",
    });
    expect(tags.length).toBeGreaterThanOrEqual(8);
    expect(tags.length).toBeLessThanOrEqual(15);
    expect(tags.join(" ").toLowerCase()).toMatch(/chef|firma|holding|ehe|geheimnis|kurzfilm|drama/);
    expect(tags.join(" ")).not.toMatch(/youtube|yeni video/i);

    const meta = normalizePublishMeta(
      {
        titleVariants: ["Der Chef lügt"],
        primaryTitle: "Der Chef lügt",
        description: "Ein Abend, eine Firma, eine Lüge — wer deckt wen? Die Luft ändert sich. Die Wahrheit siehst du im Film.",
        tags: ["youtube", "video"],
        hashtags: ["#youtube"],
        seoKeywords: { primary: "", secondary: [] },
        targetAudience: "",
        thumbnailPrompt: "enough characters here for thumb xx",
        thumbnailText: "Was ist passiert?",
        thumbnailConcepts: [
          { name: "A", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt xx" },
          { name: "B", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt yy" },
          { name: "C", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt zz" },
        ],
        chapters: [
          { time: "0:00", label: "Bas", beat: "" },
          { time: "1:00", label: "Orta", beat: "" },
          { time: "2:00", label: "Son", beat: "" },
        ],
        pinnedComment: "y".repeat(40),
        communityPost: "z".repeat(50),
        shortsHooks: ["a", "b", "c"],
        endScreenCta: "cta text here enough",
        postingStrategy: "strategy text here enough chars ok",
        uploadChecklist: ["1", "2", "3", "4", "5", "6"],
        kidsSafetyNotes: "",
        contentWarnings: [],
        seriesHook: "",
      },
      {
        titleFallback: "Der Chef lügt",
        isKids: false,
        totalSeconds: 90,
        language: "German",
        topic: "Hart und Wilde Holding, Ehe, Geheimnis",
        genre: "Drama",
      }
    );
    expect(meta.tags.join(" ")).not.toMatch(/\byoutube\b/i);
    expect(meta.hashtags.join(" ")).not.toMatch(/#youtube/i);
    expect(meta.tags.some((t) => /holding|ehe|chef|firma|geheim/i.test(t))).toBe(true);
  });

  it("uzun hikaye konusunu etiket cumlesi yapmaz; slash basligi filme ceker", () => {
    const topic = `Ich legte Markus’ Handy auf den Tresen, das Display noch hell: „Reservierung: Suite 908 – Laura.“ Sein Blick fror.
Eine Stunde später stand ich vor dem Hotel. Im Standesamt sagte ich: „Heirate mich. Heute. Jetzt.“
Wochen später drehte ich die Machtverhältnisse um: Felix entpuppte sich als CEO, ich legte Beweise gegen Tobias vor.`;
    const hook =
      "Ich legte Markus’ Handy auf den Tresen, das Display noch hell: Reservierung: Suite 908 – Laura.";
    const summary =
      "Ich erwischte Markus mit einer Hotelbuchung auf seinem Handy und heiratete aus Trotz den Fremden Felix im Standesamt. Felix entpuppte sich als CEO.";
    expect(isKeywordSaladTitle("Suite 908 / Blitzhochzeit / Hotel-Affäre – Ich sperrte sein Handy")).toBe(true);
    expect(spoilerSafeSetup([hook, summary], 400)).not.toMatch(/CEO|Beweise/i);

    const tags = topicAlignedTagPack({
      title: "Suite 908 — Blitzhochzeit, kalter Kaffee",
      topic,
      genre: "Yildirim nikahi",
      language: "German",
      hook,
      summary,
      storyTitle: "Suite 908 — Blitzhochzeit, kalter Kaffee",
    });
    expect(tags.join(" ")).toMatch(/Suite 908|Blitzhochzeit|Standesamt|Hotelbuchung/i);
    expect(tags.join(" ")).not.toMatch(/Ich legte Markus|youtube|Geschäftsführer|USB/i);
    expect(tags.every((t) => t.split(/\s+/).length <= 6)).toBe(true);

    const meta = normalizePublishMeta(
      {
        titleVariants: ["Suite 908 / Blitzhochzeit / Hotel-Affäre – Ich sperrte sein Handy"],
        primaryTitle: "Suite 908 / Blitzhochzeit / Hotel-Affäre – Ich sperrte sein Handy",
        description:
          "Suite 908, Blitzhochzeit, Standesamt: Ich erwischte die Reservierung auf Markus’ Handy – und sagte einem Fremden Ja. Kalte Luft, Glas, leise Wut hinter höflichen Stimmen. Ein Schritt, der atmet.",
        seoKeywords: { primary: "Suite 908 Blitzhochzeit Hotel-Affäre", secondary: [] },
        tags: ["Ich legte Markus’ Handy auf den Tresen, da", "youtube"],
        hashtags: ["#youtube"],
        targetAudience: "",
        thumbnailPrompt: "enough characters here for thumb xx",
        thumbnailText: "Was ist passiert?",
        thumbnailConcepts: [
          { name: "A", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt xx" },
          { name: "B", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt yy" },
          { name: "C", emotion: "e", hook: "h", prompt: "enough characters for a concept prompt zz" },
        ],
        chapters: [
          { time: "0:00", label: "Bas", beat: "" },
          { time: "1:00", label: "Orta", beat: "" },
          { time: "2:00", label: "Son", beat: "" },
        ],
        pinnedComment: "y".repeat(40),
        communityPost: "z".repeat(50),
        shortsHooks: ["a", "b", "c"],
        endScreenCta: "cta text here enough",
        postingStrategy: "strategy text here enough chars ok",
        uploadChecklist: ["1", "2", "3", "4", "5", "6"],
        kidsSafetyNotes: "",
        contentWarnings: [],
        seriesHook: "",
      },
      {
        titleFallback: "Suite 908 — Blitzhochzeit, kalter Kaffee",
        isKids: false,
        totalSeconds: 90,
        language: "German",
        topic,
        genre: "Yildirim nikahi",
        hook,
        summary,
        storyTitle: "Suite 908 — Blitzhochzeit, kalter Kaffee",
      }
    );
    expect(meta.primaryTitle).not.toMatch(/\s\/\s.*\s\/\s/);
    expect(meta.primaryTitle).not.toMatch(/Hotel-Affäre/i);
    expect(meta.primaryTitle.slice(0, 40)).toMatch(/Suite 908|Blitzhochzeit/i);
    expect(meta.primaryTitle).toMatch(/ich|Handy|nach|heirat/i);
    expect(meta.description).toMatch(/Handy|Suite 908|Standesamt|Blitzhochzeit|Hotelbuchung/i);
    expect(meta.description).not.toMatch(/Suite 908,\s*Blitzhochzeit,\s*Standesamt:/i);
    expect(meta.description).not.toMatch(/Kalte Luft|Ein Schritt, der atmet|Hotel-Affäre/i);
    expect(meta.description).not.toMatch(/Geschäftsführer|USB|Kickback|ich blieb|entpuppte/i);
    expect(meta.description).not.toMatch(/değişiyor|İzle, gör/i);
    expect(meta.seoKeywords.primary).not.toMatch(/Hotel-Affäre/i);
    expect(meta.tags.every((t) => !/^Ich legte/i.test(t))).toBe(true);
    expect(new Set(meta.titleVariants.map((t) => t.toLowerCase())).size).toBeGreaterThanOrEqual(3);
    expect(meta.titleVariants.join(" ")).not.toMatch(/\(2\)|\(3\)/);
    expect(meta.tags.join(" ")).not.toMatch(/\b(Tresen|Display|Kaffee|Yildirim)\b/i);
  });

  it("Almanca aciklama fallback Turkce sablon kullanmaz", () => {
    const tight = forceShortCuriosityDescription("x", {
      title: "Suite 908",
      language: "German",
      setup: "Ich erwischte die Reservierung Suite 908 auf seinem Handy.",
      nouns: ["Suite 908"],
    });
    expect(tight).toMatch(/Suite 908/i);
    expect(tight).not.toMatch(/değişiyor|İzle, gör|her şeyi değiştiriyor/i);
  });
});

describe("Listeleme kilit", () => {
  it("kurulum iskeletini hikayeden alir, sonu atar", () => {
    const brief = extractListingBrief({
      storyTitle: "Suite 908 — Blitzhochzeit, kalter Kaffee",
      projectTitle: "Suite 908 — Blitzhochzeit, kalter Kaffee",
      hook: "Ich legte Markus’ Handy auf den Tresen: Reservierung Suite 908.",
      summary:
        "Ich erwischte Markus mit einer Hotelbuchung und heiratete Felix im Standesamt. Felix entpuppte sich als CEO.",
      genre: "Yildirim nikahi",
      language: "German",
      topic: "x".repeat(400) + " Hart & Wilde Holding Geschäftsführer USB",
    });
    expect(brief.setup).toMatch(/Suite 908|Handy|Standesamt/i);
    expect(brief.setup).not.toMatch(/CEO|USB|Geschäftsführer/i);
    expect(brief.nouns.join(" ")).toMatch(/Suite 908|Blitzhochzeit/i);
    expect(groundListingTitle("A / B / C – irgendwas", brief)).toMatch(/Suite 908|Blitzhochzeit/i);
  });
});

describe("Kapak yazisi", () => {
  it("flaş baslik filmden gelir, 2-4 kelimelik kancaya kesmez", () => {
    const flash = craftThumbnailOverlayText({
      language: "German",
      genre: "Yildirim nikahi",
      hook: "Ich legte Markus’ Handy auf den Tresen: Reservierung Suite 908 – Laura.",
      summary: "Ich heiratete aus Trotz den Fremden Felix im Standesamt.",
      storyTitle: "Suite 908 — Blitzhochzeit, kalter Kaffee",
      thumbnailText: "Heirate mich. Jetzt.",
    });
    expect(flash.split(/\s+/).length).toBeGreaterThanOrEqual(3);
    expect(flash.length).toBeGreaterThanOrEqual(16);
    expect(flash.length).toBeLessThanOrEqual(56);
    expect(flash).toMatch(/Suite 908|Handy|heirat|Fremden|Blitzhochzeit/i);
    expect(flash).not.toMatch(/Heirate mich|Neler Oldu|Was ist passiert/i);
  });

  it("Ingilizce kapak yazisini film diline cevirir", () => {
    const text = craftThumbnailOverlayText({
      thumbnailText: "What Happened Next?",
      emotionLabel: "gergin",
    });
    expect(text).toMatch(/donacaksın|bitti|Telefon|görünce|Kaçırma|Neler|Sakın|Ip Gerildi/i);
    expect(text).not.toMatch(/What|Happened|Next/i);
  });

  it("uzun listeleme basligini kapaga yapistirmez", () => {
    const text = craftThumbnailOverlayText({
      primaryTitle: "Kırpık ile arkadaşları Everest yolunda büyük macera yaşadı",
      emotionLabel: "heyecan",
    });
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(10);
    expect(text).not.toMatch(/Everest|arkadaşları/i);
  });

  it("Almanca filmde kapak yazisi Almanca flaş olur, Turkce kanca kullanmaz", () => {
    expect(filmCoverLanguage({ speechLanguage: "German", storyLanguage: "German" })).toBe("German");
    expect(overlayLanguageMismatch("Neler Oldu?", "German")).toBe(true);
    expect(overlayLanguageMismatch("Was ist passiert?", "German")).toBe(false);
    const text = craftThumbnailOverlayText({
      thumbnailText: "Neler Oldu?",
      language: "German",
      topic: "Hart und Wilde Holding, der Chef und die Ehe",
      emotionLabel: "gergin",
    });
    expect(text).toMatch(/Handy|heirat|Suite|Zurück|lügt|Stunde|Chef|Hart|Holding|Firma|Ehe/i);
    expect(text).not.toMatch(/Neler|Kaçırma|Şimdi/i);
  });

  it("konudan 3 farkli film-dili flaş uretir", () => {
    expect(detectCoverTopicKey("CEO holding ihanet")).toBe("betrayal");
    const variants = craftThumbnailOverlayVariants({
      language: "German",
      topic: "Ein Ehemann, eine Firma, ein Geheimnis",
      genre: "Yildirim nikahi",
      emotionLabel: "merak",
      count: 3,
    });
    expect(variants).toHaveLength(3);
    expect(new Set(variants.map((v) => v.toLowerCase())).size).toBe(3);
    for (const v of variants) {
      expect(overlayLanguageMismatch(v, "German")).toBe(false);
      expect(v.split(/\s+/).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("Thumbnail prompt guclendirme", () => {
  it("yazisiz profesyonel kilitleri ekler", () => {
    const prompt = enhanceThumbnailPrompt("orange fox on a snowy ridge gasping", {
      isKids: true,
      characterHint: "Sunny the fox with blue scarf",
    });
    expect(prompt).toMatch(/YouTube (drama )?thumbnail/);
    expect(prompt).toContain("NO text");
    expect(prompt).toContain("Pixar");
    expect(prompt).toContain("Sunny the fox");
    expect(prompt).toContain("orange fox on a snowy ridge");
  });
});

describe("Videodan thumbnail siralama", () => {
  it("yuksek merak + kanca + orta bolgeyi onde tutar", () => {
    const ranked = rankThumbnailClips([
      {
        index: 1,
        status: "completed",
        curiosityScore: 3,
        hasHook: false,
        emotionLabel: "sakin",
        videoPath: "C:\\fake\\a.mp4",
        lastFramePath: null,
        sceneImagePath: null,
        actualDurationSeconds: 8,
        estimatedDurationSeconds: 8,
      },
      {
        index: 5,
        status: "completed",
        curiosityScore: 9,
        hasHook: true,
        emotionLabel: "gergin",
        videoPath: "C:\\fake\\b.mp4",
        lastFramePath: null,
        sceneImagePath: null,
        actualDurationSeconds: 8,
        estimatedDurationSeconds: 8,
      },
      {
        index: 2,
        status: "draft",
        curiosityScore: 10,
        hasHook: true,
        emotionLabel: "heyecan",
        videoPath: "C:\\fake\\c.mp4",
        lastFramePath: null,
        sceneImagePath: null,
        actualDurationSeconds: 8,
        estimatedDurationSeconds: 8,
      },
    ]);
    expect(ranked[0]?.index).toBe(5);
    expect(ranked[0]?.reason).toMatch(/kanca|merak|duygu/i);
  });

  it("son kullanilan klipleri atlayip farkli kare orani secer", () => {
    const ranked = rankThumbnailClips([
      {
        index: 3,
        status: "completed",
        curiosityScore: 8,
        hasHook: true,
        emotionLabel: "gergin",
        videoPath: "a.mp4",
        lastFramePath: null,
        sceneImagePath: null,
        actualDurationSeconds: 8,
        estimatedDurationSeconds: 8,
      },
      {
        index: 7,
        status: "completed",
        curiosityScore: 8,
        hasHook: true,
        emotionLabel: "heyecan",
        videoPath: "b.mp4",
        lastFramePath: null,
        sceneImagePath: null,
        actualDurationSeconds: 8,
        estimatedDurationSeconds: 8,
      },
      {
        index: 10,
        status: "completed",
        curiosityScore: 7,
        hasHook: true,
        emotionLabel: "panik",
        videoPath: "c.mp4",
        lastFramePath: null,
        sceneImagePath: null,
        actualDurationSeconds: 8,
        estimatedDurationSeconds: 8,
      },
    ]);
    const first = pickDiverseThumbnailCandidate(ranked, [{ clipIndex: 3, atSec: 3.6 }]);
    expect(first.clip.index).not.toBe(3);
    expect(first.frameRatio).toBeGreaterThan(0.15);
    expect(first.frameRatio).toBeLessThan(0.85);
  });
});

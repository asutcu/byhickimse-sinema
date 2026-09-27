import { describe, expect, it } from "vitest";
import {
  buildLongformBeatVisuals,
  buildLongformNetShortStill,
  extractLocationCue,
  extractProperNames,
  guessTurkishGivenNameGender,
  isLikelyPersonName,
  longformStoryPhase,
  pickNetShortEmotion,
  stillShotKind,
  STILL_SHEET_LOCK,
  stripTurkishPossessive,
} from "@/lib/longform-netshort-stills";
import { compactPromptForFlow, FLOW_PROMPT_MAX } from "@/lib/flow-prompt-compact";
import { curiosityRulesForLongform } from "@/server/services/curiosity";
import { longformGenreById } from "@/lib/longform-catalog";

describe("gorsel anlati NetShort merdiveni", () => {
  it("erken kareler ezme, son kareler pismanlik fazina duser", () => {
    expect(longformStoryPhase(0, 20)).toBe("humiliation");
    expect(longformStoryPhase(6, 20)).toBe("decision");
    expect(longformStoryPhase(18, 20)).toBe("regret");
  });

  it("etki ve tepkiyi metinden veya onceki kareden kilitler", () => {
    expect(stillShotKind("Kagidi uzatti ve gulumsedi.", 0)).toBe("etki");
    expect(stillShotKind("Yuzu dustu, nefesi kesildi.", 1)).toBe("tepki");
    expect(stillShotKind("Sustuk.", 2, "etki")).toBe("tepki");
  });

  it("duygu paleti NetShort etiketidir, documentary degildir", () => {
    const emotion = pickNetShortEmotion({
      narration: "Bosanma kagidini masaya biraktim.",
      phase: "decision",
      shotKind: "etki",
      index: 4,
    });
    expect(emotion).toMatch(/sakin yikici|delil|bitti/i);
    expect(emotion).not.toBe("documentary");
  });

  it("ozel isimleri ve mekan surekliligini cikarir", () => {
    const names = extractProperNames("Lina ofiste durdu. Kerem gulumsedi. Lina donup baktı. Avukat Baran evragi uzatti.");
    expect(names).toEqual(expect.arrayContaining(["Lina", "Kerem", "Baran"]));
    expect(names).not.toContain("Avukat Baran");
    expect(extractLocationCue("Ofiste camdan baktim.")).toMatch(/office/i);
    expect(extractLocationCue("Sustuk.", "luxury sedan interior at night")).toBe("luxury sedan interior at night");
  });

  it("cumle basi nesne/zamirlerini ve iyelik ekini ozel isim saymaz", () => {
    expect(stripTurkishPossessive("Kerem’in")).toBe("Kerem");
    expect(stripTurkishPossessive("Duru'nun")).toBe("Duru");
    expect(isLikelyPersonName("Anahtar")).toBe(false);
    expect(isLikelyPersonName("Sen")).toBe(false);
    expect(isLikelyPersonName("Karttaki")).toBe(false);
    expect(isLikelyPersonName("Duru")).toBe(true);
    expect(isLikelyPersonName("Bunu")).toBe(false);
    expect(isLikelyPersonName("Kalemi")).toBe(false);
    expect(isLikelyPersonName("İlk")).toBe(false);
    expect(isLikelyPersonName("Aslı")).toBe(true);
    expect(isLikelyPersonName("Adımı")).toBe(false);
    expect(isLikelyPersonName("Otomatik")).toBe(false);
    expect(isLikelyPersonName("Zarfın")).toBe(false);
    const names = extractProperNames(
      "Anahtar yerde dönerken soğukça söyledim. Duru anahtarı çarptırdı. Kerem’in koluna girdi. Sen kimsin ki? Karttaki 1506 yandı."
    );
    expect(names).toEqual(expect.arrayContaining(["Duru", "Kerem"]));
    expect(names).not.toEqual(expect.arrayContaining(["Anahtar", "Sen", "Karttaki"]));
    expect(names.some((n) => /Kerem['’]in/i.test(n))).toBe(false);
  });

  it("Bunu/Kalemi/İlk cumle basini kisi saymaz; Duru/Hakan cinsiyeti dogru", () => {
    const names = extractProperNames(
      "Bunu yapamazsın, diye fısıldadı. Kalemi kavradım. İlk hamle gece atılacak. Duru parfüm sürdü. Hakan dosyayı uzattı. Aslı kahkahası geçti. Zeynep not açtı."
    );
    expect(names).toEqual(expect.arrayContaining(["Duru", "Hakan", "Aslı", "Zeynep"]));
    expect(names).not.toEqual(expect.arrayContaining(["Bunu", "Kalemi", "İlk"]));
    expect(guessTurkishGivenNameGender("Duru")).toBe("female");
    expect(guessTurkishGivenNameGender("Aslı")).toBe("female");
    expect(guessTurkishGivenNameGender("Zeynep")).toBe("female");
    expect(guessTurkishGivenNameGender("Hakan")).toBe("male");
    expect(guessTurkishGivenNameGender("Kerem")).toBe("male");
    expect(guessTurkishGivenNameGender("Levent")).toBe("male");
  });

  it("roster varsa karede hikaye kisileri kalir; Anahtar/Sen dusmez", () => {
    const visuals = buildLongformBeatVisuals(
      [
        { narration: "Anahtar yerde dönerken soğukça söyledim: Nişan bitti. Cevap güldü: Sen kimsin ki?" },
        { narration: "Duru anahtarı bileğime çarptırıp Kerem’in koluna girdi; çenem kilitlendi." },
      ],
      {
        visualLock: longformGenreById("aldatma").visualLock,
        genreId: "aldatma",
        roster: ["Duru", "Kerem", "Aslı"],
        leadName: "Anlatıcı",
        storyText: "Duru Kerem Aslı",
      }
    );
    expect(visuals[0].people.join(" ")).toMatch(/Anlatıcı/i);
    expect(visuals[0].people.join(" ")).not.toMatch(/Anahtar|\bSen\b/i);
    expect(visuals[1].people.join(" ")).toMatch(/Duru/i);
    expect(visuals[1].people.join(" ")).toMatch(/Kerem/i);
    expect(visuals[0].imagePrompt).toMatch(/MUST be clearly visible/i);
    expect(visuals[0].imagePrompt).not.toMatch(/Anahtar, Sen/);
  });

  it("drama kareleri ayni konum kilidi ve etki-tepki tasir", () => {
    const visuals = buildLongformBeatVisuals(
      [
        { narration: "Kerem sekretere gulumsedi, kagidi uzatti." },
        { narration: "Lina yuzu dondu, nefesi kesildi." },
        { narration: "Bes yil sonra Lina yeni askıyla ofise girdi." },
      ],
      {
        visualLock: longformGenreById("aldatma").visualLock,
        genreId: "aldatma",
        storyText: "Lina ve Kerem. Kerem sekreteri tercih etti. Lina sakin karar verdi.",
      }
    );
    expect(visuals).toHaveLength(3);
    expect(visuals[0].mood).not.toBe("documentary");
    expect(visuals[0].shotKind).toBe("etki");
    expect(visuals[1].shotKind).toBe("tepki");
    expect(visuals[0].people.join(" ")).toMatch(/Kerem/i);
    expect(visuals[1].people.join(" ")).toMatch(/Lina/i);
    expect(visuals[1].imagePrompt).toMatch(/CONTINUITY LOCK|same location|wardrobe/i);
    expect(visuals[0].imagePrompt).toMatch(/NETSHORT/i);
    expect(visuals[0].imagePrompt).toMatch(/character sheet|turnaround/i);
    expect(visuals[0].imagePrompt).toMatch(/a scene, not a portrait/i);
    expect(visuals[0].imagePrompt).toMatch(/zero written characters/i);
    expect(visuals[2].phase).toBe("rise");
    expect(longformStoryPhase(9, 10)).toBe("regret");
    const { text, truncated } = compactPromptForFlow(visuals[0].imagePrompt, "Turkish");
    expect(truncated).toBe(false);
    expect(visuals[0].imagePrompt.length).toBeLessThan(4500);
    expect(text.length).toBeLessThanOrEqual(FLOW_PROMPT_MAX);
    expect(text.length).toBeLessThan(8000);
    expect(text).toContain("[STILL BEAT]");
    expect(text).toContain("[WARDROBE COVER]");
    expect(text).toContain("Kerem");
    expect(text).not.toMatch(/SPEECH LANGUAGE LOCK/);
    expect(text).not.toMatch(/photorealistic|celebrity/i);
  });

  it("belgesel turunde documentary kilit kalir, NetShort ezme yok", () => {
    const visuals = buildLongformBeatVisuals([{ narration: "Arsivde bir sayfa eksikti." }], {
      visualLock: longformGenreById("history").visualLock,
      genreId: "history",
    });
    expect(visuals[0].mood).toBe("documentary");
    expect(visuals[0].imagePrompt).not.toMatch(/humiliation crush/i);
  });

  it("karedeki her isim cinsiyetiyle yazilir; erkek kadina cevrilemez", () => {
    const visuals = buildLongformBeatVisuals(
      [{ narration: "Ezgi Mert’in koluna girip zavallı diye fısıldadı. Dosya yere saçıldı; sayfaları topladım." }],
      {
        visualLock: longformGenreById("hesap-sorma").visualLock,
        genreId: "hesap-sorma",
        roster: ["Ezgi", "Mert", "Anlatıcı"],
        leadName: "Anlatıcı",
        castGenders: { ezgi: "female", mert: "male", anlatıcı: "female" },
        storyText: "Ezgi Mert Anlatıcı",
      }
    );
    const prompt = visuals[0].imagePrompt;
    expect(prompt).toContain("Mert (adult man)");
    expect(prompt).toContain("Ezgi (adult woman)");
    expect(prompt).toMatch(/\[GENDER LOCK\]/);
    // Kadin gardirop kuralinin erkege uygulanmasi acikca yasak.
    expect(prompt).toMatch(/NEVER applies to a man/i);
    // "topladım" birinci tekil: anlatici karede.
    expect(visuals[0].people.join(" ")).toMatch(/Anlatıcı/);
  });

  it("kadro cinsiyeti yoksa isim sezgisi kullanilir (Ezgi kadin)", () => {
    expect(guessTurkishGivenNameGender("Ezgi")).toBe("female");
    expect(guessTurkishGivenNameGender("Sevgi")).toBe("female");
    expect(guessTurkishGivenNameGender("Gülnur")).toBe("female");
    expect(guessTurkishGivenNameGender("Mert")).toBe("male");
    const still = buildLongformNetShortStill({
      narration: "Ezgi güldü, Mert başını çevirdi.",
      index: 0,
      total: 10,
      visualLock: longformGenreById("hesap-sorma").visualLock,
      genreId: "hesap-sorma",
      roster: ["Ezgi", "Mert"],
    });
    expect(still.imagePrompt).toContain("Ezgi (adult woman)");
    expect(still.imagePrompt).toContain("Mert (adult man)");
  });

  it("kare sahne ister: portre / vesikalik kare yasak", () => {
    const still = buildLongformNetShortStill({
      narration: "16:40, camlı toplantı odası. Kağıt yanağıma çarptı. Mert kapıyı çarptı; omzum irkildi.",
      index: 1,
      total: 10,
      visualLock: longformGenreById("hesap-sorma").visualLock,
      genreId: "hesap-sorma",
      roster: ["Mert", "Anlatıcı"],
      leadName: "Anlatıcı",
    });
    expect(still.imagePrompt).toMatch(/location must be recognizable/i);
    expect(still.imagePrompt).toMatch(/identity headshot|headshot is a FAIL|blank-wall headshot/i);
    // "yanağıma / omzum": anlatici bu karede sahnede olmali (tek kisi kalmasin).
    expect(still.people.join(" ")).toMatch(/Anlatıcı/);
    expect(still.people.length).toBeGreaterThan(1);
  });

  it("cinsiyet + sahne eklemeleri 8000 butcesini asmaz (sheet kilidi dahil)", () => {
    const visuals = buildLongformBeatVisuals(
      [{ narration: "Ezgi Mert’in koluna girdi; dosya yere saçıldı, sayfaları topladım." }],
      {
        visualLock: longformGenreById("hesap-sorma").visualLock,
        genreId: "hesap-sorma",
        roster: ["Ezgi", "Mert", "Anlatıcı"],
        leadName: "Anlatıcı",
        castGenders: { ezgi: "female", mert: "male" },
      }
    );
    // Uretimde Flow'a giden tam metin: sheet kilidi + kare promptu + cikti kilidi.
    const full = `${STILL_SHEET_LOCK}\n\n${visuals[0].imagePrompt}\n\n[OUTPUT LOCK] One 16:9 story freeze in a real place. Forbidden: character sheet, turnaround, front+back split, gray studio catalog.`;
    const { text, truncated } = compactPromptForFlow(full, "Turkish");
    expect(truncated).toBe(false);
    expect(text.length).toBeLessThanOrEqual(FLOW_PROMPT_MAX);
    // Kirpilma olmadigi icin kilitler ayakta kalir.
    expect(text).toContain("[GENDER LOCK]");
    expect(text).toContain("Mert (adult man)");
    expect(text).toContain("[SHEET LOCK]");
  });

  it("tek kare promptu duyguyu karede ister", () => {
    const still = buildLongformNetShortStill({
      narration: "Kayinvalidem 'sen kadin degilsin' dedi.",
      index: 0,
      total: 10,
      visualLock: longformGenreById("kayinvalide").visualLock,
      genreId: "kayinvalide",
      roster: ["Emel"],
    });
    expect(still.emotion.length).toBeGreaterThan(4);
    expect(still.imagePrompt).toMatch(/mother-in-law|family pressure|POWER/i);
    expect(still.imagePrompt).toMatch(/everyday|short dress|mini|slightly open/i);
  });
});

describe("uzun form merak NetShort aktarimi", () => {
  it("aldatma slaytina sinema NetShort entrika kilidini ekler", () => {
    const drama = curiosityRulesForLongform("aldatma");
    expect(drama).toContain("NETSHORT");
    expect(drama).toMatch(/etki|ETKI/i);
    expect(drama).toContain("KANIT ZINCIRI");
    const doc = curiosityRulesForLongform("mystery");
    expect(doc).not.toContain("KANIT ZINCIRI");
  });
});

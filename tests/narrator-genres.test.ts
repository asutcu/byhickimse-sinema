import { describe, expect, it } from "vitest";
import {
  NARRATOR_GENRE_GROUPS,
  NARRATOR_GENRES,
  applyNarratorTopicSuggestion,
  isNarratorCatalogTopic,
  narratorGenreLabel,
  narratorGenreStoryBlock,
  narratorNetShortStorySystemLock,
  narratorGenreTopicSuggestions,
  resolveNarratorGenre,
} from "@/lib/narrator-genres";
import {
  buildNarratorTopicSuggestPrompts,
  resolveSuggestNarratorGenre,
  suggestNarratorTopicInputSchema,
  suggestOutputBudget,
} from "@/server/services/narrator-topic";

describe("Sinema hikaye turleri", () => {
  it("NetShort taksonomisi gruplari: hesap/donus onde, klasikler sonda", () => {
    expect(NARRATOR_GENRE_GROUPS[0].ids[0]).toBe("hesap-sorma");
    expect(NARRATOR_GENRE_GROUPS[0].ids).toEqual(
      expect.arrayContaining(["hesap-sorma", "guclu-donus", "gizli-kimlik", "pismanlik"])
    );
    const allIds = NARRATOR_GENRE_GROUPS.flatMap((g) => g.ids);
    expect(allIds).toEqual(expect.arrayContaining(["aldatma", "yasak-ask", "ihanet", "kayinvalide"]));
    expect(NARRATOR_GENRE_GROUPS[NARRATOR_GENRE_GROUPS.length - 1].ids).toEqual(
      expect.arrayContaining(["gizem", "gerilim", "dram", "gercek-yasam"])
    );
  });

  it("aldatma ve ihanet katalogda vardir", () => {
    expect(NARRATOR_GENRES.some((g) => g.id === "aldatma")).toBe(true);
    expect(NARRATOR_GENRES.some((g) => g.id === "ihanet")).toBe(true);
    expect(NARRATOR_GENRES.some((g) => g.id === "yasak-ask")).toBe(true);
  });

  it("etiket, id ve eski sinema aliasini cozer", () => {
    expect(resolveNarratorGenre("Aldatma").id).toBe("aldatma");
    expect(resolveNarratorGenre("aldatma").id).toBe("aldatma");
    expect(resolveNarratorGenre("sinema").id).toBe("dram");
    expect(resolveNarratorGenre("Gizem").id).toBe("gizem");
  });

  it("bilinmeyen turu ozel kilide cevirir", () => {
    const genre = resolveNarratorGenre("ikinci es");
    expect(genre.id).toBe("ozel");
    expect(narratorGenreStoryBlock("ikinci es")).toContain("ikinci es");
  });

  it("aldatma hikaye kilidinde yatak yasagi vardir", () => {
    const block = narratorGenreStoryBlock("Aldatma");
    expect(block).toContain("ALDATMA");
    expect(block).toMatch(/yatak|soyunuk/i);
    expect(block).toContain("18 yas");
  });

  it("ozel etiket uretir", () => {
    expect(narratorGenreLabel("aldatma")).toBe("Aldatma");
    expect(narratorGenreLabel("ozel", "ikinci es")).toBe("ikinci es");
  });

  it("her tur icin kisa konu onerisi vardir (ozel haric)", () => {
    for (const genre of NARRATOR_GENRES.filter((g) => g.id !== "ozel")) {
      const list = narratorGenreTopicSuggestions(genre.id);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list[0].split(/\s+/).length).toBeGreaterThan(20);
    }
  });

  it("tur degisince bos veya katalog onerisini yeniler, ozel metni korur", () => {
    const first = applyNarratorTopicSuggestion("aldatma", "");
    expect(first).toContain("otel");
    expect(isNarratorCatalogTopic(first)).toBe(true);
    const swapped = applyNarratorTopicSuggestion("aldatma", first, true);
    expect(swapped).not.toBe(first);
    expect(applyNarratorTopicSuggestion("ihanet", first)).toContain("imza");
    expect(applyNarratorTopicSuggestion("aldatma", "Kendi yazdigim konu")).toBe("Kendi yazdigim konu");
  });

  it("hikaye SYSTEM kilidi NetShort corpus, ozet bankasi ve duygu paletini tasir", () => {
    const lock = narratorNetShortStorySystemLock("aldatma");
    expect(lock).toContain("NETSHORT CORPUS");
    expect(lock).toContain("OZET BANKASI");
    expect(lock).toContain("NETSHORT HIKAYE SISTEM KILIDI");
    expect(lock).toMatch(/DUYGU PALETI|DUYGU:/);
    expect(lock).toContain("SAHNE DARBELERI");
    expect(narratorGenreStoryBlock("aldatma")).toContain("NETSHORT OZET BANKASI");
    expect(narratorGenreStoryBlock("aldatma")).toMatch(/DUYGU PALETI|DUYGU:/);
  });

  it("AI konu promptu secilen tur kilidini tasir", () => {
    const { user, genre } = buildNarratorTopicSuggestPrompts(
      suggestNarratorTopicInputSchema.parse({
        genreId: "aldatma",
        topic: "eski otel karti hikayesi",
        audience: "18-35",
        targetDurationSeconds: 180,
      })
    );
    expect(genre.id).toBe("aldatma");
    expect(user).toContain("ALDATMA");
    expect(user).toMatch(/yatak|soyunuk/i);
    expect(user).toContain("eski otel karti hikayesi");
    expect(user).toContain("18-35");
    expect(user).toContain("TEKRARLAMA");
  });

  it("AI hikaye onerisi sureye gore kelime butcesi ve kapali sonuc ister", () => {
    const short = buildNarratorTopicSuggestPrompts(
      suggestNarratorTopicInputSchema.parse({
        genreId: "gizem",
        targetDurationSeconds: 60,
        targetWordCount: 105,
      })
    );
    expect(short.targetWords).toBe(105);
    expect(short.user).toContain("105 kelime");
    expect(short.user).toContain("SONUC");
    expect(short.system).toMatch(/YARIDA BIRAKMA|sonuca/i);
    expect(short.system).toContain("TAM HIKAYE");
    expect(short.system).toContain("NETSHORT CORPUS");
    expect(short.system).toContain("OZET BANKASI");

    const long = buildNarratorTopicSuggestPrompts(
      suggestNarratorTopicInputSchema.parse({
        genreId: "gizem",
        targetDurationSeconds: 600,
        wpm: 105,
      })
    );
    expect(long.targetWords).toBe(1050);
    expect(long.user).toContain("1050 kelime");
    expect(suggestOutputBudget(1050)).toBeGreaterThan(suggestOutputBudget(105));
  });

  it("gorsel slayt brief modu kisa omurga ister, 30 dk transkript istemez", () => {
    const brief = buildNarratorTopicSuggestPrompts(
      suggestNarratorTopicInputSchema.parse({
        genreId: "aldatma",
        kind: "brief",
        targetDurationSeconds: 1800,
      })
    );
    expect(brief.targetWords).toBeLessThanOrEqual(180);
    expect(brief.user).toContain("KISA BRIEF");
    expect(brief.system).toContain("KISA");
  });

  it("ozel tur adsiz AI cagrisini reddeder", () => {
    expect(() =>
      resolveSuggestNarratorGenre(suggestNarratorTopicInputSchema.parse({ genreId: "ozel" }))
    ).toThrow(/Ozel tur/);
    expect(resolveSuggestNarratorGenre(suggestNarratorTopicInputSchema.parse({ genreId: "ozel", customGenre: "ikinci es" })).id).toBe(
      "ozel"
    );
  });

  it("ozel tur adi hikaye onerisi ve kilidine girer", () => {
    const { user, genre } = buildNarratorTopicSuggestPrompts(
      suggestNarratorTopicInputSchema.parse({
        genreId: "ozel",
        customGenre: "ikinci es",
        kind: "brief",
        targetDurationSeconds: 1800,
      })
    );
    expect(genre.label).toBe("ikinci es");
    expect(user).toContain("ikinci es");
    expect(user).toContain("ZORUNLU OZEL TUR");
    expect(narratorGenreStoryBlock("ikinci es")).toContain("ikinci es");
  });
});

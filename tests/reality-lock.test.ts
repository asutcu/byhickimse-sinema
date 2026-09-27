import { describe, expect, it } from "vitest";
import { compactPromptForFlow, FLOW_PROMPT_MAX } from "@/lib/flow-prompt-compact";
import { filmCityFor, REALITY_LOCK_TAG, realityLockBlock } from "@/lib/reality-lock";
import { buildLongformBeatVisuals } from "@/lib/longform-netshort-stills";
import { speechStillWorldLock } from "@/lib/speech-cast-locale";
import { facelessSceneForPolicyRetry } from "@/lib/flow-prompt-safety";

describe("gerceklik kilidi (tum film)", () => {
  it("film sehri tohuma gore sabit, hikayede gecen sehir onceliklidir", () => {
    const a = filmCityFor("German", "proje-1");
    expect(filmCityFor("German", "proje-1")).toEqual(a);
    expect(filmCityFor("German", "proje-1", "Sie zog nach Hamburg.").city).toBe("Hamburg");
    expect(filmCityFor("Turkish", "x", "İzmir'de bir sabah").city).toBe("Izmir");
    // Baska dilin sehri o dilin filmine sizmaz
    expect(["Istanbul", "Ankara", "Izmir", "Bursa", "Antalya"]).toContain(filmCityFor("Turkish", "x", "Berlin").city);
  });

  it("kilit kisa kalir ve referans/dunya/insan/kamera kurallarini tasir", () => {
    const lock = realityLockBlock({ world: "present-day Berlin, Germany", crowd: "Berlin residents", hasReferences: true });
    expect(lock.length).toBeLessThan(1000);
    expect(lock).toContain(REALITY_LOCK_TAG);
    expect(lock).toMatch(/Reference match/);
    expect(lock).toMatch(/returning place looks identical/);
    expect(lock).toMatch(/no clones/);
    expect(lock).toMatch(/one real camera look/);
    const anime = realityLockBlock({ world: "w", crowd: "c", family: "anime2d" });
    expect(anime).not.toMatch(/real camera|footage/);
  });

  it("uzun prompt kisaltilsa da kilit dusmez ve 8000 asilmaz", () => {
    const lock = realityLockBlock({ world: "present-day Istanbul, Turkey", crowd: "Istanbul residents", hasReferences: true });
    const long = [
      "[SPOKEN LINE — AUDIO FIRST]",
      'She says: "Bunu sana hic soylemedim."',
      "[IDENTITY LOCK] Uploaded photo is the storyteller woman.",
      "",
      lock,
      "",
      "[SCENE CONTINUITY] Same kitchen as before.",
      "",
      `[SHOT] ${"Detailed shot direction. ".repeat(300)}`,
      "",
      `[STYLE] ${"Film texture. ".repeat(400)}`,
    ].join("\n");
    expect(long.length).toBeGreaterThan(FLOW_PROMPT_MAX);
    const { text, truncated } = compactPromptForFlow(long, "Turkish");
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(FLOW_PROMPT_MAX);
    expect(text).toContain(REALITY_LOCK_TAG);
    expect(text).toContain("Bunu sana hic soylemedim.");
  });

  it("gorsel anlati karelerinde tum kareler ayni sehri tasir", () => {
    const visuals = buildLongformBeatVisuals(
      [{ narration: "Kerem kapiyi carpti." }, { narration: "Elif sessizce agladi." }, { narration: "Ertesi gun ofiste karsilastilar." }],
      { visualLock: "", genreId: "aldatma", storyText: "Kerem ve Elif", roster: ["Kerem", "Elif"], speechLanguage: "Turkish", filmSeed: "p1" }
    );
    const cities = visuals.map((v) => v.imagePrompt.match(/present-day (\w+),/)?.[1]);
    expect(new Set(cities).size).toBe(1);
    for (const v of visuals) expect(v.imagePrompt).toContain(REALITY_LOCK_TAG);
  });

  it("yuzsuz politika kademesi kilidin yuz cumlesini siler, sehir/kamera kalir", () => {
    const lock = realityLockBlock({ world: "present-day Berlin, Germany", crowd: "Berlin residents", hasReferences: true });
    const out = facelessSceneForPolicyRetry(`[SPOKEN LINE]\n"Test satiri."\n\n${lock}\n\n[SHOT] A kitchen table.`);
    expect(out).not.toMatch(/Reference match/);
    expect(out).toContain(REALITY_LOCK_TAG);
    expect(out).toMatch(/one real camera look/);
  });

  it("dil dunyasi satiri sehir verilince tek sehir yazar", () => {
    expect(speechStillWorldLock("German", "Hamburg")).toContain("(Hamburg)");
    expect(speechStillWorldLock("German", "Hamburg")).not.toContain("München");
  });
});

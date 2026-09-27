import { describe, expect, it } from "vitest";
import { analyzeCuriosityFlow, curiosityWarnings } from "@/lib/curiosity-flow";
import {
  CURIOSITY_CORE_RULES,
  curiosityRulesFor,
  curiosityRulesForLongform,
  curiosityRulesForNarrator,
} from "@/server/services/curiosity";

function clip(index: number, curiosityScore: number, hasHook = true) {
  return { index, curiosityScore, hasHook };
}

describe("Merak akisi denetimi", () => {
  it("saglam akisi onaylar", () => {
    const report = analyzeCuriosityFlow([clip(1, 8), clip(2, 6), clip(3, 9), clip(4, 7), clip(5, 6, false)]);
    expect(report.ok).toBe(true);
    expect(report.hasPeak).toBe(true);
    expect(report.averageScore).toBeGreaterThanOrEqual(6);
    expect(curiosityWarnings(report)).toHaveLength(0);
  });

  it("art arda dusuk merak eden sahneleri isaretler", () => {
    const report = analyzeCuriosityFlow([clip(1, 9), clip(2, 3), clip(3, 4), clip(4, 8)]);
    expect(report.flatRuns).toEqual([[2, 3]]);
    expect(report.ok).toBe(false);
    expect(curiosityWarnings(report).join(" ")).toContain("Sahne 2, 3");
  });

  it("kancasiz sahneleri bulur ama son sahneyi muaf tutar", () => {
    const report = analyzeCuriosityFlow([clip(1, 9), clip(2, 7, false), clip(3, 8, false)]);
    expect(report.missingHooks).toEqual([2]);
  });

  it("doruk noktasi yoksa uyarir", () => {
    const report = analyzeCuriosityFlow([clip(1, 7), clip(2, 6), clip(3, 7)]);
    expect(report.hasPeak).toBe(false);
    expect(curiosityWarnings(report).join(" ")).toContain("Doruk merak");
  });

  it("bos klip listesinde cokmez", () => {
    const report = analyzeCuriosityFlow([]);
    expect(report.averageScore).toBe(0);
    expect(report.ok).toBe(false);
  });
});

describe("Merak kurallari sablona gore secilir", () => {
  it("anlatici sablonunda cekirdek kurallar ve puanlama vardir", () => {
    const rules = curiosityRulesFor("narrator");
    expect(rules).toContain(CURIOSITY_CORE_RULES);
    expect(rules).toContain("KANCA PUANLAMASI");
    expect(rules).toContain("FILM SONU");
    expect(rules).toContain("yarıda kalmasin");
    expect(rules).toContain("SURUKLEYICILIK");
  });

  it("uzun form belgeselde ucuncu tekil ve 8-12 dk kanca vardir", () => {
    const rules = curiosityRulesFor("longform");
    expect(rules).toContain("UCUNCU TEKIL");
    expect(rules).toContain("8-12");
    expect(rules).toContain("FILM SONU");
    expect(rules).toContain("SURUKLEYICILIK");
  });

  it("aldatma / ihanet gibi dram turlerinde iliski dramasi surukleyiciligi eklenir", () => {
    const drama = curiosityRulesForLongform("aldatma");
    expect(drama).toContain("SURUKLEYICILIK");
    expect(drama).toContain("KANIT ZINCIRI");
    expect(drama).toContain("MERDIVEN");
    const belgesel = curiosityRulesForLongform("mystery");
    expect(belgesel).toContain("SURUKLEYICILIK");
    expect(belgesel).not.toContain("KANIT ZINCIRI");
  });

  it("sinema anlatici dram turunde de kanit zinciri istenir", () => {
    expect(curiosityRulesForNarrator("Aldatma")).toContain("KANIT ZINCIRI");
    expect(curiosityRulesForNarrator("intikam")).toContain("KANIT ZINCIRI");
    expect(curiosityRulesForNarrator("gizem")).toContain("KANIT ZINCIRI");
    expect(curiosityRulesForNarrator("gizem")).toContain("SURUKLEYICILIK");
    expect(curiosityRulesForNarrator("Aldatma")).toContain("NETSHORT");
    expect(curiosityRulesForNarrator("gizem")).toContain("NETSHORT");
    expect(curiosityRulesForNarrator("Aldatma")).toMatch(/sakin yikici|donus|pismanlik/i);
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canTakeMainPage, flowPageNeedsNavigation, isOpeningStale, pickPreferredPageIndex, raceTimeout, shouldDropBrowserState } from "@/server/automation/browser";
import { acquireCharacterFlowSlot, isCharacterFlowBlocked } from "@/server/services/character-flow";
import { handle } from "@/server/lib/api";

describe("Flow penceresi acilisi", () => {
  it("bos ve chrome yeni sekme adreslerinde Flow'a gidilir", () => {
    expect(flowPageNeedsNavigation("")).toBe(true);
    expect(flowPageNeedsNavigation("about:blank")).toBe(true);
    expect(flowPageNeedsNavigation("chrome://newtab/")).toBe(true);
    expect(flowPageNeedsNavigation("https://labs.google/fx/tools/flow")).toBe(false);
  });

  it("eski context kapaninca yeni oturumu silmez", () => {
    const oldContext = { id: "old" };
    const newContext = { id: "new" };
    expect(shouldDropBrowserState(newContext, oldContext)).toBe(false);
    expect(shouldDropBrowserState(oldContext, oldContext)).toBe(true);
    expect(shouldDropBrowserState(null, oldContext)).toBe(false);
  });

  it("takili Chrome acilisini stale sayar", () => {
    expect(isOpeningStale(0, 1_000)).toBe(true);
    expect(isOpeningStale(1_000, 10_000, 45_000)).toBe(false);
    expect(isOpeningStale(1_000, 50_000, 45_000)).toBe(true);
  });

  it("session restore sekmelerinden Flow sekmesini secer", () => {
    expect(pickPreferredPageIndex([])).toBe(-1);
    expect(
      pickPreferredPageIndex(["about:blank", "https://labs.google/fx/tools/flow/project/abc", "chrome://newtab/"])
    ).toBe(1);
    expect(pickPreferredPageIndex(["about:blank", "https://example.com"])).toBe(1);
  });

  it("raceTimeout sure dolunca hata verir", async () => {
    await expect(raceTimeout(new Promise(() => undefined), 20, "ping")).rejects.toThrow(/zaman asimi/);
    await expect(raceTimeout(Promise.resolve("ok"), 200, "ping")).resolves.toBe("ok");
  });

  it("her proje kendi Flow sekmesinde kalir: ana sekme baska projeden CALINMAZ", () => {
    // Serbest ana sekme: tek is icin fazladan sekme acilmaz.
    expect(canTakeMainPage({ projectId: "sinema", mainPageOccupantId: null, hasOtherDedicatedTabs: false })).toBe(true);
    // Ayni projenin kendi kaydi: devam eder.
    expect(canTakeMainPage({ projectId: "sinema", mainPageOccupantId: "sinema", hasOtherDedicatedTabs: false })).toBe(
      true
    );
    // Ana sekme gorsel anlatinin elinde: sinema projesi kendi sekmesini acar.
    expect(canTakeMainPage({ projectId: "sinema", mainPageOccupantId: "gorsel", hasOtherDedicatedTabs: false })).toBe(
      false
    );
    // Baska projelerin ayri sekmeleri varsa ana sekme yine paylasilmaz.
    expect(canTakeMainPage({ projectId: "sinema", mainPageOccupantId: null, hasOtherDedicatedTabs: true })).toBe(false);
  });

  it("karakter uretimi baska projelerin sekmelerini kapatmaz", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/server/automation/browser.ts"), "utf8");
    const fn = source.slice(source.indexOf("export async function keepOnlyThisTab"));
    expect(fn.slice(0, 700)).toContain("claimedByOthers");
    expect(fn.slice(0, 700)).toContain("if (page === keep || claimedByOthers.has(page)) continue;");
  });

  it("yetim runningJobId karakter yenilemeyi kilitlemez", () => {
    expect(isCharacterFlowBlocked({ loopAlive: false })).toBe(false);
    expect(isCharacterFlowBlocked({ loopAlive: true })).toBe(true);
  });

  it("ayni proje icin ikinci karakter uretimi slotu reddeder", () => {
    const releaseA = acquireCharacterFlowSlot("proj-a");
    try {
      expect(() => acquireCharacterFlowSlot("proj-a")).toThrow(/zaten uretiliyor/);
      const releaseB = acquireCharacterFlowSlot("proj-b");
      releaseB();
    } finally {
      releaseA();
    }
    const releaseAgain = acquireCharacterFlowSlot("proj-a");
    releaseAgain();
  });

  it("karakter yenileme editor gorsel modunu kullanir, Karakterler sayfasina zipplamaz", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/server/services/character-flow.ts"), "utf8");
    expect(source).toContain("singleTab: true");
    expect(source).not.toContain("openCharactersPage");
    expect(source).toContain("voiceOverOnly && member.role === \"main\"");
  });

  it("karakter mesgul hatasi 409 doner (500 overlay degil)", async () => {
    const err = new Error("otomasyon calisiyor");
    err.name = "FlowCharacterBusyError";
    const res = await handle(async () => {
      throw err;
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("otomasyon");
  });
});

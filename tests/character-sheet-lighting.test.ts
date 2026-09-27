import { describe, expect, it } from "vitest";
import { characterTurnaroundSheetLock } from "@/server/services/character-flow";
import { STILL_SHEET_LOCK } from "@/lib/longform-netshort-stills";
import { fallbackExpandCharacterNote } from "@/server/services/character";

describe("karakter sayfasi isik", () => {
  it("canli cekim kilidi tek kisi + on/arka tam boy + pencere/lamba yasagi", () => {
    const lock = characterTurnaroundSheetLock(false, "Duru", "female");
    expect(lock).toMatch(/even diffused fill/i);
    expect(lock).toMatch(/matte mid-gray/i);
    expect(lock).toMatch(/windows/i);
    expect(lock).toMatch(/blown-out white/i);
    expect(lock).toMatch(/exactly ONE person/i);
    expect(lock).toMatch(/adult woman \(female\)/i);
    // Kullanici istegi: on + arka, tam boy — ama iki panel AYNI kisi.
    expect(lock).toMatch(/LEFT panel: FRONT view/i);
    expect(lock).toMatch(/RIGHT panel: BACK view/i);
    expect(lock.match(/full body head-to-toe/gi)?.length).toBe(2);
    expect(lock).toMatch(/SAME individual in both panels/i);
    expect(lock).toMatch(/Forbidden: couple, two different people, twins/i);
    expect(lock).not.toMatch(/soft window key/i);
    expect(lock).not.toMatch(/identical studio lighting/i);
  });

  it("erkek kilidi kadin eklemez", () => {
    const lock = characterTurnaroundSheetLock(false, "Emre", "male");
    expect(lock).toMatch(/adult man \(male\)/i);
    expect(lock).toMatch(/opposite sex/i);
    expect(lock).toMatch(/LEFT panel: FRONT view/i);
    expect(lock).toMatch(/never a second person/i);
  });

  it("slayt referansi karakter sheet isigini kopyalamasin", () => {
    expect(STILL_SHEET_LOCK).toMatch(/blown-out white/i);
    expect(STILL_SHEET_LOCK).toMatch(/high-key/i);
  });

  it("varsayilan karakter isigi pencere anahtari degil", () => {
    const expanded = fallbackExpandCharacterNote("siyah saçlı kadın", "Duru");
    expect(expanded.lighting).toMatch(/even diffused fill/i);
    expect(expanded.lighting).toMatch(/no window/i);
    expect(expanded.lighting).not.toMatch(/soft natural key/i);
  });
});

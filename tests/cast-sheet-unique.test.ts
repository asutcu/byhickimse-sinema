import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractProperNames, isLikelyPersonName } from "@/lib/longform-netshort-stills";
import { inferTurkishGivenNameGender, resolveCastGender } from "@/lib/turkish-given-name-gender";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("kadro sheet'i ve isim cikarimi", () => {
  it("cumle basi buyuk harfli kelimeler kadroya girmez", () => {
    const story = [
      "Kısa bir süre sonra kapı çaldı.",
      "Yüzüm yandı, hiçbir şey söylemedim.",
      "Kısa bir bakış attı bana.",
      "Yüzüm hâlâ yanıyordu.",
      "Derya'ya baktım, Derya elimi tuttu ve Derya bana gülümsedi.",
    ].join(" ");
    const names = extractProperNames(story);
    expect(names).toContain("Derya");
    expect(names).not.toContain("Kısa");
    expect(names).not.toContain("Yüz");
    expect(names).not.toContain("Yüzüm");
  });

  it("gunluk kelimeler isim sayilmaz", () => {
    for (const word of ["Kısa", "Yüz", "Ses", "Hayat", "Para", "Artık"]) {
      expect(isLikelyPersonName(word)).toBe(false);
    }
    expect(isLikelyPersonName("Zeynep")).toBe(true);
    expect(isLikelyPersonName("Asya")).toBe(true);
  });

  it("Asya hikaye metninden kadroya cikar", () => {
    const story = [
      "Asya lobide topuklarını tıkırdatarak bana yukarıdan gülümsedi.",
      "Asya lobide gülümsemeyi unuttu.",
      "Asya sandalyesinde kıpırdadı.",
    ].join(" ");
    expect(extractProperNames(story)).toContain("Asya");
  });

  it("kadro gorseli kaydedilirken kopya kontrolu var", () => {
    const source = read("src/server/services/character-flow.ts");
    expect(source).toContain("FlowCharacterDuplicateError");
    expect(source.match(/assertSheetIsUnique\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/sha256/);
  });

  it("hikaye kadrosu canli cekim gorseli tek kisiyi on+arka tam boy ister", () => {
    const source = read("src/server/services/character-flow.ts");
    expect(source).toContain("characterFrontBackSheetLock");
    expect(source).toMatch(/Exactly ONE adult woman|exactly ONE person/i);
    expect(source).toMatch(/LEFT panel: FRONT view/);
    expect(source).toMatch(/RIGHT panel: BACK view/);
  });

  it("turkce isimden cinsiyet okunur — tek kadin kadin kalir", () => {
    expect(inferTurkishGivenNameGender("Sevil")).toBe("female");
    expect(inferTurkishGivenNameGender("Zeynep")).toBe("female");
    expect(inferTurkishGivenNameGender("Derya")).toBe("female");
    expect(inferTurkishGivenNameGender("Asya")).toBe("female");
    expect(inferTurkishGivenNameGender("Ayla")).toBe("female");
    expect(inferTurkishGivenNameGender("Emre")).toBe("male");
    expect(inferTurkishGivenNameGender("Hakan")).toBe("male");
    expect(inferTurkishGivenNameGender("Kerem")).toBe("male");
    expect(resolveCastGender("Sevil", "male")).toBe("female");
    expect(resolveCastGender("Emre", "female")).toBe("male");
    expect(inferTurkishGivenNameGender("Deniz")).toBeNull();
    expect(resolveCastGender("Markus", "female")).toBe("male");
    expect(resolveCastGender("Lena", "male")).toBe("female");
  });
});

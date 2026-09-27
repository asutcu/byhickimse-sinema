import { describe, expect, it } from "vitest";
import path from "node:path";
import { slugify, safeProjectPath, PROJECTS_ROOT, clipFileName, isInsideProjectsRoot } from "@/server/lib/paths";

describe("Dosya yolu guvenligi", () => {
  it("Turkce karakterli proje adlarindan guvenli slug uretir", () => {
    expect(slugify("Çılgın Öykü Şöleni")).toBe("cilgin-oyku-soleni");
    expect(slugify("İIıi ĞğÜüŞşÖöÇç")).toBe("iiii-gguussoocc");
  });

  it("tehlikeli karakterleri temizler", () => {
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("a<>:\"|?*b")).toBe("a-b");
    expect(slugify("")).toBe("proje");
  });

  it("proje koku disina cikan yollari engeller", () => {
    expect(() => safeProjectPath("..", "..", "windows", "system32")).toThrow(/Guvensiz/);
    expect(() => safeProjectPath("proje", "..", "..", "gizli.txt")).toThrow(/Guvensiz/);
  });

  it("gecerli proje yollarina izin verir", () => {
    const result = safeProjectPath("test-proje", "clips", "001.mp4");
    expect(result.startsWith(path.resolve(PROJECTS_ROOT))).toBe(true);
  });

  it("isInsideProjectsRoot dogru calisir", () => {
    expect(isInsideProjectsRoot(path.join(PROJECTS_ROOT, "abc", "video.mp4"))).toBe(true);
    expect(isInsideProjectsRoot(path.join(PROJECTS_ROOT, "..", "secret.txt"))).toBe(false);
  });

  it("klip dosya adlarini 001.mp4 bicminde uretir", () => {
    expect(clipFileName(1)).toBe("001.mp4");
    expect(clipFileName(42)).toBe("042.mp4");
    expect(clipFileName(7, ".png")).toBe("007.png");
    expect(clipFileName(1, "abc123xyz")).toMatch(/^001-abc123xyz\.mp4$/);
  });
});

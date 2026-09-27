import { describe, expect, it } from "vitest";
import { maskApiKey, maskSecrets, maskObject } from "@/server/lib/mask";

describe("API anahtari maskeleme", () => {
  it("anahtari ilk 4 + son 2 karaktere indirger", () => {
    const masked = maskApiKey("sk-proj-abcdefghijklmnop1234");
    expect(masked).toBe("sk-p******34");
    expect(masked).not.toContain("abcdefgh");
  });

  it("bos/eksik anahtari guvenli isler", () => {
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey(null)).toBe("");
    expect(maskApiKey("kisa")).toBe("********");
  });

  it("metin icindeki OpenAI anahtarlarini maskeler", () => {
    const text = "Hata olustu: apiKey=sk-proj-verysecretkey12345678 ile baglanti";
    const masked = maskSecrets(text);
    expect(masked).not.toContain("verysecretkey");
  });

  it("Google cerezlerini ve Bearer tokenlari maskeler", () => {
    expect(maskSecrets("Cookie: SID=abcdefghijklmnoprstuvyz123")).not.toContain("abcdefghijklmnoprstuvyz123");
    expect(maskSecrets("Authorization: Bearer abcdefghij1234567890")).not.toContain("abcdefghij1234567890");
  });

  it("nesne icindeki gizli alan adlarini maskeler", () => {
    const masked = maskObject({ apiKey: "sk-proj-secret123456789", nested: { password: "hunter2hunter2" }, safe: "gorunur" });
    expect(JSON.stringify(masked)).not.toContain("secret123456789");
    expect(JSON.stringify(masked)).not.toContain("hunter2hunter2");
    expect((masked as { safe: string }).safe).toBe("gorunur");
  });
});

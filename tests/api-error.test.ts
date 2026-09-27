import { describe, expect, it } from "vitest";
import { publicApiErrorMessage } from "@/server/lib/api";

describe("publicApiErrorMessage", () => {
  it("Prisma / Turbopack dokumunu kisa mesaja cevirir", () => {
    const dump = `
Invalid \`prisma.project.update()\` invocation
Unknown argument \`flowImageModel\`. Available options are marked with ?.
`.repeat(8);
    expect(publicApiErrorMessage(dump)).toBe(
      "Kayit sirasinda alan uyusmazligi oldu. Sayfayi yenileyip tekrar deneyin."
    );
    expect(publicApiErrorMessage(dump).length).toBeLessThan(120);
  });
});

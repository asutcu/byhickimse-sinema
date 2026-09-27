import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LONGFORM_FLOW_IMAGE_MODELS,
  LONGFORM_IMAGE_PROVIDERS,
  defaultLongformImageModel,
  longformImageSourceLabel,
  parseLongformSettings,
  resolveLongformImageModel,
} from "@/lib/longform-catalog";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("tek resim motoru: Nano Banana", () => {
  it("longform ayarlari her zaman Flow + Nano Banana 2 cozer", () => {
    expect(LONGFORM_IMAGE_PROVIDERS).toEqual(["flow"]);
    expect(LONGFORM_FLOW_IMAGE_MODELS[0]).toBe("Nano Banana 2");
    expect(LONGFORM_FLOW_IMAGE_MODELS).toContain("Nano Banana Pro");
    expect(defaultLongformImageModel()).toBe("Nano Banana 2");
    expect(resolveLongformImageModel("openai", "gpt-image-1")).toBe("Nano Banana 2");
    expect(longformImageSourceLabel("openai", "gpt-image-1")).toBe("Flow · Nano Banana 2");
    expect(resolveLongformImageModel("flow", "Nano Banana Pro")).toBe("Nano Banana Pro");
  });

  it("eski openai kayitli proje ayarlari Flow'a cevrilir", () => {
    const parsed = parseLongformSettings(JSON.stringify({ imageProvider: "openai", imageModel: "gpt-image-1" }));
    expect(parsed.imageProvider).toBe("flow");
    expect(parsed.imageModel).toBe("Nano Banana 2");
  });

  it("hicbir servis gpt-image-1 ile resim uretmez", () => {
    for (const file of [
      "src/server/services/openai.ts",
      "src/server/services/character.ts",
      "src/server/services/longform.ts",
      "src/server/services/publish.ts",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/images\.(generate|edit)\(/);
      expect(source).not.toMatch(/model:\s*"gpt-image-1"/);
    }
  });

  it("kapak ve karakter yollari Flow gorsel servisini kullanir", () => {
    expect(read("src/server/services/publish.ts")).toContain("generateFlowImageBuffer");
    expect(read("src/app/api/projects/[id]/generate-character/route.ts")).toContain(
      "generateCharacterImageWithFlow"
    );
  });
});

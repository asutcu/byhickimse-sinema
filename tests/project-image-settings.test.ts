import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CharacterProfile, Project } from "@prisma/client";
import { VISUAL_STYLE_PRESETS } from "@/server/services/prompt-builder";
import { FLOW_HARD_CHAR_LIMIT, FLOW_PROMPT_MAX } from "@/lib/flow-prompt-compact";
import { buildFlowCharacterDescription, buildFlowCharacterImagePrompt } from "@/server/services/character-flow";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function fakeProject(partial: Partial<Project> = {}): Project {
  return { id: "p1", speechLanguage: "German", aspectRatio: "16:9", ...partial } as Project;
}

function fakeProfile(partial: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    id: "c1",
    projectId: "p1",
    name: "Julia",
    gender: "female",
    hair: "chestnut brown waves",
    faceFeatures: "everyday adult face",
    wardrobe: "short burgundy dress",
    baseAppearancePrompt: "A 26-year-old adult WOMAN (female), slim. Hair: chestnut brown. Eyes: hazel.",
    baseWardrobePrompt: "short burgundy summer dress",
    imagePrompt: "",
    ...partial,
  } as CharacterProfile;
}

describe("proje gorsel modeli tek kaynaktan okunur", () => {
  it("Flow model secimi proje ayarindan (SQL) okunur — istek degeri ezmez", () => {
    const adapter = read("src/server/automation/flow-adapter.ts");
    expect(adapter).toContain("readProjectFlowImageModel");
    // selectImageModel ve configureImageGeneration ayari kendisi okur:
    // eski Prisma client alani bos donse bile Pro secimi kaybolmaz.
    expect(adapter.match(/readProjectFlowImageModel\(project\.id\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("karakter / kapak / slayt uretimi projeyi model alaniyla doldurur", () => {
    for (const file of [
      "src/server/services/character-flow.ts",
      "src/server/services/flow-image.ts",
      "src/server/services/longform.ts",
    ]) {
      expect(read(file)).toContain("hydrateProjectFlowImageModel");
    }
  });
});

describe("sinematik film gorunumu (ReelShort / NetShort)", () => {
  const cinematic = VISUAL_STYLE_PRESETS.find((p) => p.id === "cinematic")!;

  it("kisa dizi platformlarinin premium bakisini tarif eder", () => {
    expect(cinematic.label).toMatch(/ReelShort/i);
    expect(cinematic.prompt).toMatch(/ReelShort \/ NetShort/i);
    expect(cinematic.prompt).toMatch(/shallow depth of field/i);
    expect(cinematic.prompt).toMatch(/rim|kicker/i);
    expect(cinematic.prompt).toMatch(/marble lobby|glass boardroom|penthouse/i);
    expect(cinematic.prompt).toMatch(/thumbnail size/i);
    expect(cinematic.prompt).toMatch(/no on-screen text/i);
  });

  it("stil metinleri klip promptunda yer birakacak kadar kisa", () => {
    for (const preset of VISUAL_STYLE_PRESETS) {
      expect(preset.prompt.length).toBeLessThan(2_000);
    }
  });
});

describe("karakter sheet promptu 8000 sinirini asmaz", () => {
  it("uzun gorunum metninde bile hard limitin altinda kalir", () => {
    const long = `${"chestnut brown shoulder-length waves with soft flyaways, ".repeat(400)}`;
    const profile = fakeProfile({ baseAppearancePrompt: long, baseWardrobePrompt: long });
    const image = buildFlowCharacterImagePrompt(fakeProject(), profile);
    const desc = buildFlowCharacterDescription(fakeProject(), profile);
    for (const prompt of [image, desc]) {
      expect(prompt.length).toBeLessThan(FLOW_HARD_CHAR_LIMIT);
      expect(prompt.length).toBeLessThanOrEqual(FLOW_PROMPT_MAX);
    }
  });

  it("karakter beklemesi kendi sheet'ini reddetmez, slayt/kapak reddetmeye devam eder", () => {
    const adapter = read("src/server/automation/flow-adapter.ts");
    expect(adapter).toContain("wantsSheet");
    expect(adapter).toContain("isRejectedSheet");
    // Slayt heuristikleri artik sadece "still" modunda calisir.
    expect(adapter).not.toMatch(/if \(await imageLooksLikeCharacterSheet\(page, (probe|cap)\)\)/);

    expect(read("src/server/services/character-flow.ts")).toMatch(/expect: "sheet"/);
    for (const file of ["src/server/services/longform-stills-flow.ts", "src/server/services/flow-image.ts"]) {
      expect(read(file)).not.toMatch(/expect: "sheet"/);
    }
  });

  it("normal kadroda on + arka tam boy sheet ister", () => {
    const image = buildFlowCharacterImagePrompt(fakeProject(), fakeProfile());
    expect(image).toMatch(/LEFT panel: FRONT view/);
    expect(image).toMatch(/RIGHT panel: BACK view/);
    expect(image).toMatch(/full body head-to-toe/);
    expect(image).toMatch(/German/);
    expect(image).toMatch(/Nobody behind the subject/i);
    expect(image.length).toBeLessThan(FLOW_HARD_CHAR_LIMIT);
  });
});

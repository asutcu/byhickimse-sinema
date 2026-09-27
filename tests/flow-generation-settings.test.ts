import { describe, expect, it } from "vitest";
import {
  chipNeedsRepair,
  defaultDurationsForFlowModel,
  flowClipSeconds,
  preferredNarratorClipSeconds,
  flowDurationTabPattern,
  isImageFlowModel,
  imageModelNamesMatch,
  isFlowPolicyBlockText,
  isStuckFlowResolvingText,
  parseFlowSettingsChip,
  resolveFlowImageModel,
  FLOW_IMAGE_MODEL_DEFAULT,
  shouldTreatVisibleFailureAsNew,
} from "@/lib/flow-generation-settings";

describe("flowClipSeconds", () => {
  it("Veo Fast/Lite icin 10 sn'yi 8 sn'ye ceker", () => {
    expect(flowClipSeconds("Veo 3.1 Fast", 10)).toBe(8);
    expect(flowClipSeconds("Veo 3.1 - Fast", 10)).toBe(8);
    expect(flowClipSeconds("Veo 3.1 Lite", 10)).toBe(8);
  });

  it("proje 8 sn ise oldugu gibi birakir", () => {
    expect(flowClipSeconds("Veo 3.1 Fast", 8)).toBe(8);
    expect(flowClipSeconds("Veo 3.1 Fast", 6)).toBe(6);
  });

  it("Quality ve Omni 10 sn kabul eder", () => {
    expect(flowClipSeconds("Veo 3.1 Quality", 10)).toBe(10);
    expect(flowClipSeconds("Gemini Omni Flash", 10)).toBe(10);
  });

  it("sinema anlatici 8 sn varsayilani model izin veriyorsa 10 sn olur", () => {
    expect(preferredNarratorClipSeconds("Gemini Omni Flash", 8)).toBe(10);
    expect(preferredNarratorClipSeconds("Veo 3.1 Quality", 0)).toBe(10);
    expect(preferredNarratorClipSeconds("Veo 3.1 Fast", 8)).toBe(8);
    expect(preferredNarratorClipSeconds("Veo 3.1 Quality", 6)).toBe(6);
  });

  it("destek listesi verilirse ona uyar", () => {
    expect(flowClipSeconds("Ozel", 10, [4, 6, 8])).toBe(8);
    expect(flowClipSeconds("Ozel", 10, [4, 6, 8, 10])).toBe(10);
  });
});

describe("defaultDurationsForFlowModel", () => {
  it("Fast/Lite 10 icermez", () => {
    expect(defaultDurationsForFlowModel("Veo 3.1 Fast")).toEqual([4, 6, 8]);
    expect(defaultDurationsForFlowModel("Veo 3.1 Lite")).toEqual([4, 6, 8]);
  });
});

describe("parseFlowSettingsChip", () => {
  it("Video · 10scrop_9_16x1 ozetini okur", () => {
    const chip = parseFlowSettingsChip("Video · 10scrop_9_16x1");
    expect(chip.durationSec).toBe(10);
    expect(chip.aspect).toBe("9:16");
    expect(chip.outputs).toBe(1);
    expect(chip.looksLikeSettingsChip).toBe(true);
  });

  it("Videocrop_9_16x1 (suresiz eski ozet) oranini okur", () => {
    const chip = parseFlowSettingsChip("Videocrop_9_16x1");
    expect(chip.durationSec).toBeNull();
    expect(chip.aspect).toBe("9:16");
    expect(chip.outputs).toBe(1);
    expect(chip.looksLikeSettingsChip).toBe(true);
  });

  it("16:9 ozetini okur", () => {
    const chip = parseFlowSettingsChip("Videocrop_16_9x1");
    expect(chip.aspect).toBe("16:9");
  });

  it("Metinden videoya etiketini ayarlar ozeti saymaz", () => {
    const chip = parseFlowSettingsChip("Metinden videoya");
    expect(chip.looksLikeSettingsChip).toBe(false);
    expect(chip.aspect).toBeNull();
  });
});

describe("chipNeedsRepair", () => {
  it("10s short + 8s hedefinde sureyi bozuk sayar", () => {
    const chip = parseFlowSettingsChip("Video · 10scrop_9_16x1");
    const repair = chipNeedsRepair(chip, { durationSec: 8, aspect: "9:16", outputs: 1 });
    expect(repair.duration).toBe(true);
    expect(repair.aspect).toBe(false);
    expect(repair.outputs).toBe(false);
  });

  it("oran 16:9 kalmissa short icin bozuk sayar", () => {
    const chip = parseFlowSettingsChip("Videocrop_16_9x1");
    const repair = chipNeedsRepair(chip, { durationSec: 8, aspect: "9:16" });
    expect(repair.aspect).toBe(true);
  });
});

describe("flowDurationTabPattern", () => {
  it("8s ve 8 s eslesir, 10s eslesmez", () => {
    const re = flowDurationTabPattern(8);
    expect(re.test("8s")).toBe(true);
    expect(re.test("8 s")).toBe(true);
    expect(re.test("10s")).toBe(false);
    expect(re.test("16:9")).toBe(false);
  });

  it("flow.google.com yazimi: '8 sn.' / '8 sec.' eslesir, '18 sn.' eslesmez", () => {
    const re = flowDurationTabPattern(8);
    expect(re.test("8 sn.")).toBe(true);
    expect(re.test("8 sec.")).toBe(true);
    expect(re.test("18 sn.")).toBe(false);
  });

  it("yeni ozet cipi okunur: 'Video · 720p · 8 sn. crop_16_9 x1'", () => {
    const chip = parseFlowSettingsChip("Video · 720p · 8 sn. crop_16_9 x1");
    expect(chip.durationSec).toBe(8);
    expect(chip.aspect).toBe("16:9");
    expect(chip.outputs).toBe(1);
  });
});

describe("isImageFlowModel", () => {
  it("Nano Banana gorsel, Veo video", () => {
    expect(isImageFlowModel("Nano Banana 2")).toBe(true);
    expect(isImageFlowModel("Nano Banana Pro")).toBe(true);
    expect(isImageFlowModel("Veo 3.1 Fast")).toBe(false);
  });
});

describe("resolveFlowImageModel", () => {
  it("bos veya gecersiz degerde varsayilana duser", () => {
    expect(resolveFlowImageModel("")).toBe(FLOW_IMAGE_MODEL_DEFAULT);
    expect(resolveFlowImageModel("gecersiz")).toBe(FLOW_IMAGE_MODEL_DEFAULT);
    expect(resolveFlowImageModel("Nano Banana Pro")).toBe("Nano Banana Pro");
    expect(resolveFlowImageModel({ flowImageModel: "Nano Banana 2" })).toBe("Nano Banana 2");
    expect(resolveFlowImageModel({ longformSettings: "{}" })).toBe(FLOW_IMAGE_MODEL_DEFAULT);
    // Prisma client alani yoksa (eski process) varsayilan 2'dir — uretim SQL'den okumali.
    expect(
      resolveFlowImageModel({
        flowImageModel: "",
        longformSettings: JSON.stringify({ imageModel: "Nano Banana Pro" }),
      })
    ).toBe("Nano Banana Pro");
  });
});

describe("imageModelNamesMatch", () => {
  it("Pro ile 2 karismaz", () => {
    expect(imageModelNamesMatch("Nano Banana Pro", "Nano Banana Pro")).toBe(true);
    expect(imageModelNamesMatch("Nano Banana 2", "Nano Banana 2")).toBe(true);
    expect(imageModelNamesMatch("Nano Banana Pro", "Nano Banana 2")).toBe(false);
    expect(imageModelNamesMatch("Nano Banana 2", "Nano Banana Pro")).toBe(false);
  });
});

describe("isStuckFlowResolvingText", () => {
  it("Flow'un takili hata-cozme metnini yakalar", () => {
    expect(isStuckFlowResolvingText("Hatayı çözüyoruz, lütfen bekleyin")).toBe(true);
    expect(isStuckFlowResolvingText("Hatayı böyle çöz")).toBe(true);
    expect(isStuckFlowResolvingText("Yeniden deneniyor")).toBe(true);
    expect(isStuckFlowResolvingText("Uretim tamamlandi")).toBe(false);
  });
});

describe("shouldTreatVisibleFailureAsNew", () => {
  const policy = "Bu icerik politikalarimizi ihlal ediyor olabilir";

  it("ayni eski kart metnini 25 sn ilerleme yoksa yeni red sayar", () => {
    expect(
      shouldTreatVisibleFailureAsNew({
        errorText: policy,
        staleFailureText: policy,
        inPageRetryUsed: false,
        msSinceRetry: 0,
        elapsedMs: 25_000,
        progressSeen: false,
        progressGone: true,
        generateEnabled: true,
      })
    ).toBe(true);
  });

  it("uretim surerken (ilerleme var) eski karti yutmaz", () => {
    expect(
      shouldTreatVisibleFailureAsNew({
        errorText: policy,
        staleFailureText: policy,
        inPageRetryUsed: false,
        msSinceRetry: 0,
        elapsedMs: 40_000,
        progressSeen: true,
        progressGone: false,
        generateEnabled: false,
      })
    ).toBe(false);
  });

  it("Yeniden dene sonrasi 2. ayni politika reddini hemen yeni sayar", () => {
    expect(
      shouldTreatVisibleFailureAsNew({
        errorText: policy,
        staleFailureText: policy,
        inPageRetryUsed: true,
        msSinceRetry: 8_000,
        elapsedMs: 40_000,
        progressSeen: true,
        progressGone: true,
        generateEnabled: true,
      })
    ).toBe(true);
  });

  it("politika metni degilse eski karti 25 sn'de yeni saymaz", () => {
    expect(
      shouldTreatVisibleFailureAsNew({
        errorText: "Eski basarisiz kart",
        staleFailureText: "Eski basarisiz kart",
        inPageRetryUsed: false,
        msSinceRetry: 0,
        elapsedMs: 40_000,
        progressSeen: false,
        progressGone: true,
        generateEnabled: true,
      })
    ).toBe(false);
  });

  it("politika metnini tanir", () => {
    expect(isFlowPolicyBlockText(policy)).toBe(true);
    expect(isFlowPolicyBlockText("Uretim tamamlandi")).toBe(false);
  });
});

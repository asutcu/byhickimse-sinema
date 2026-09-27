import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  finishLongformJob,
  getLongformJob,
  longformJobFilePath,
  readPersistedLongformJob,
  startLongformJob,
} from "@/server/services/longform-jobs";
import { DEFAULT_LONGFORM_SETTINGS } from "@/lib/longform-catalog";
import {
  buildLongformFingerprint,
  imageSourceChanged,
  isLongformProduceStep,
  longformPhaseLabel,
  parseLongformFingerprint,
  retryAsync,
  shouldRebuildBeats,
  shouldRebuildMix,
  shouldRebuildStills,
  shouldRebuildSegments,
  shouldRebuildVoice,
  simpleTextHash,
  stillFileName,
} from "@/lib/longform-pipeline";

describe("longform pipeline parmak izi", () => {
  it("ayni ayar ve metinde beatleri yeniden istemez", () => {
    const settings = { ...DEFAULT_LONGFORM_SETTINGS };
    const first = buildLongformFingerprint({ settings, storyText: "Sarayda bir kutu acildi." });
    const second = buildLongformFingerprint({ settings, storyText: "Sarayda bir kutu acildi." });
    expect(shouldRebuildBeats(first, second)).toBe(false);
    expect(shouldRebuildVoice(first, second)).toBe(false);
    expect(shouldRebuildMix(first, second)).toBe(false);
  });

  it("ozel tur adi degisince beatleri yeniler", () => {
    const previous = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, genreId: "ozel", customGenre: "ikinci es" },
      storyText: "Metin",
    });
    const next = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, genreId: "ozel", customGenre: "evlatlik sirri" },
      storyText: "Metin",
    });
    expect(shouldRebuildBeats(previous, next)).toBe(true);
  });

  it("10/15/20 aralik degisince beatleri yeniler", () => {
    const previous = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, stillIntervalSeconds: 15 },
      storyText: "Metin",
    });
    const next = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, stillIntervalSeconds: 10 },
      storyText: "Metin",
    });
    expect(shouldRebuildBeats(previous, next)).toBe(true);
    expect(shouldRebuildVoice(previous, next)).toBe(true);
  });

  it("yalniz ses degisince beat degil TTS ister", () => {
    const previous = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, voiceId: "female" },
      storyText: "Metin",
    });
    const next = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, voiceId: "male" },
      storyText: "Metin",
    });
    expect(shouldRebuildBeats(previous, next)).toBe(false);
    expect(shouldRebuildVoice(previous, next)).toBe(true);
  });

  it("yalniz hareket degisince mix ister, beat istemez", () => {
    const previous = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, stillMotion: "hold" },
      storyText: "Metin",
    });
    const next = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, stillMotion: "kenburns" },
      storyText: "Metin",
    });
    expect(shouldRebuildBeats(previous, next)).toBe(false);
    expect(shouldRebuildVoice(previous, next)).toBe(false);
    expect(shouldRebuildMix(previous, next)).toBe(true);
  });

  it("onceki iz yoksa her seyi yeniler", () => {
    const next = buildLongformFingerprint({ settings: DEFAULT_LONGFORM_SETTINGS, storyText: "A" });
    expect(shouldRebuildBeats(null, next)).toBe(true);
    expect(shouldRebuildVoice(null, next)).toBe(true);
    expect(shouldRebuildMix(null, next)).toBe(true);
  });

  it("gorsel kaynagi degince kareleri yeniler, beatleri degil", () => {
    const previous = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, imageProvider: "flow", imageModel: "Nano Banana 2" },
      storyText: "Metin",
    });
    const next = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, imageProvider: "flow", imageModel: "Nano Banana Pro" },
      storyText: "Metin",
    });
    expect(shouldRebuildBeats(previous, next)).toBe(false);
    expect(shouldRebuildVoice(previous, next)).toBe(false);
    expect(shouldRebuildStills(previous, next)).toBe(true);
    expect(shouldRebuildMix(previous, next)).toBe(true);
    expect(imageSourceChanged(previous, next)).toBe(true);
  });

  it("iz yoksa hazir kareler silinmez (yarida iptalde bastan baslamaz)", () => {
    const next = buildLongformFingerprint({ settings: DEFAULT_LONGFORM_SETTINGS, storyText: "Metin" });
    expect(imageSourceChanged(null, next)).toBe(false);
    expect(imageSourceChanged(next, next)).toBe(false);
  });

  it("render bicimi degince mix ister, kare istemez", () => {
    const previous = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, outputResolution: "1080" },
      storyText: "Metin",
    });
    const next = buildLongformFingerprint({
      settings: { ...DEFAULT_LONGFORM_SETTINGS, outputResolution: "1440", renderFps: 30 },
      storyText: "Metin",
    });
    expect(shouldRebuildStills(previous, next)).toBe(false);
    expect(shouldRebuildSegments(previous, next)).toBe(true);
    expect(shouldRebuildMix(previous, next)).toBe(true);
  });

  it("altyazi stili degince sadece mix ister", () => {
    const previous = buildLongformFingerprint({
      settings: DEFAULT_LONGFORM_SETTINGS,
      storyText: "Metin",
    });
    const next = buildLongformFingerprint({
      settings: {
        ...DEFAULT_LONGFORM_SETTINGS,
        subtitles: { ...DEFAULT_LONGFORM_SETTINGS.subtitles, enabled: true, color: "#FFEE00" },
      },
      storyText: "Metin",
    });
    expect(shouldRebuildBeats(previous, next)).toBe(false);
    expect(shouldRebuildVoice(previous, next)).toBe(false);
    expect(shouldRebuildMix(previous, next)).toBe(true);
  });

  it("parmak izini yuvarlak serilestirir", () => {
    const built = buildLongformFingerprint({ settings: DEFAULT_LONGFORM_SETTINGS, storyText: "Hash" });
    const parsed = parseLongformFingerprint(JSON.stringify(built));
    expect(parsed).toEqual(built);
    expect(parseLongformFingerprint("{")).toBeNull();
    expect(parseLongformFingerprint("")).toBeNull();
  });
});

describe("longform yardimcilari", () => {
  it("gorsel dosya adini 3 haneli yazar", () => {
    expect(stillFileName(1)).toBe("001.png");
    expect(stillFileName(15)).toBe("015.png");
    expect(stillFileName(120)).toBe("120.png");
  });

  it("uretim adimini dogrular", () => {
    expect(isLongformProduceStep("stills")).toBe(true);
    expect(isLongformProduceStep("all")).toBe(true);
    expect(isLongformProduceStep("video")).toBe(false);
  });

  it("faz etiketleri gorsel slayt dilindedir", () => {
    expect(longformPhaseLabel("stills")).toBe("Gorseller");
    expect(longformPhaseLabel("mix")).toBe("Slayt montaj");
  });

  it("ayni metin ayni hash, farkli metin farkli hash", () => {
    expect(simpleTextHash("abc")).toBe(simpleTextHash("abc"));
    expect(simpleTextHash("abc")).not.toBe(simpleTextHash("abd"));
  });

  it("retryAsync basariya kadar dener", async () => {
    let n = 0;
    const value = await retryAsync(async () => {
      n += 1;
      if (n < 3) throw new Error("gecici");
      return 42;
    }, 3, 1);
    expect(value).toBe(42);
    expect(n).toBe(3);
  });

  it("retryAsync tukenince son hatayi atar", async () => {
    await expect(
      retryAsync(async () => {
        throw new Error("kalici");
      }, 2, 1)
    ).rejects.toThrow("kalici");
  });
});

describe("longform is kaliciligi", () => {
  const persistId = "vitest-longform-job-persist";
  const recoverId = "vitest-longform-job-recover";

  afterEach(() => {
    for (const id of [persistId, recoverId]) {
      const filePath = longformJobFilePath(id);
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    }
  });

  it("baslayan isi diske yazar ve bitince gunceller", () => {
    startLongformJob(persistId);
    const started = readPersistedLongformJob(persistId);
    expect(started?.phase).toBe("story");
    expect(started?.finishedAt).toBeNull();
    finishLongformJob(persistId, "done", { outputPath: "output/final.mp4" });
    const done = readPersistedLongformJob(persistId);
    expect(done?.phase).toBe("done");
    expect(done?.outputPath).toBe("output/final.mp4");
    expect(done?.message).toMatch(/gorsel slayt/i);
  });

  it("yeniden baslayan calisan isi failed olarak isaretler", () => {
    const filePath = longformJobFilePath(recoverId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        projectId: recoverId,
        phase: "stills",
        step: 4,
        totalSteps: 6,
        message: "calisiyor",
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        outputPath: null,
        cancelRequested: false,
      }),
      "utf8"
    );
    const recovered = getLongformJob(recoverId);
    expect(recovered?.phase).toBe("failed");
    expect(recovered?.error).toMatch(/yeniden basladi/i);
  });
});

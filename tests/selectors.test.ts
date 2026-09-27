import { describe, expect, it } from "vitest";
import {
  flowSelectorSchema,
  DEFAULT_SELECTORS,
  SEMANTIC_FALLBACKS,
  brokenSelectorReasons,
  mergeCandidates,
  parseCandidates,
} from "@/server/automation/selectors";
import { buildSelectorCandidates, pickBestSelector } from "@/server/automation/calibration";

describe("Flow secici yapilandirmasi dogrulama", () => {
  it("gecerli yapilandirmayi kabul eder", () => {
    const result = flowSelectorSchema.safeParse({
      key: "promptInput",
      strategy: "role",
      value: "textbox",
      roleName: "prompt",
      description: "",
      required: true,
    });
    expect(result.success).toBe(true);
  });

  it("gecersiz stratejiyi reddeder", () => {
    const result = flowSelectorSchema.safeParse({ key: "x", strategy: "xpath", value: "//div" });
    expect(result.success).toBe(false);
  });

  it("bos anahtari reddeder", () => {
    const result = flowSelectorSchema.safeParse({ key: "", strategy: "css", value: ".btn" });
    expect(result.success).toBe(false);
  });

  it("varsayilan secici seti sartnamedeki zorunlu anahtarlari icerir", () => {
    const keys = DEFAULT_SELECTORS.map((s) => s.key);
    for (const required of [
      "promptInput",
      "generateButton",
      "modelMenu",
      "durationMenu",
      "aspectRatioMenu",
      "audioToggle",
      "uploadReferenceButton",
      "generationProgress",
      "generationComplete",
      "errorBanner",
      "assetMenuButton",
      "downloadMenuItem",
      "downloadVideoItem",
      "newProjectButton",
    ]) {
      expect(keys).toContain(required);
    }
  });
});

describe("Kalibrasyon: en iyi secici secimi (oncelik sirasi)", () => {
  const base = {
    tag: "button",
    id: "",
    testId: "",
    ariaLabel: "",
    role: "",
    accessibleName: "",
    placeholder: "",
    text: "",
    cssPath: "div > button:nth-of-type(2)",
    editable: false,
  };

  it("role + erisilebilir ad varsa role stratejisini secer", () => {
    const config = pickBestSelector("generateButton", { ...base, role: "button", ariaLabel: "Generate video" }, true);
    expect(config.strategy).toBe("role");
    expect(config.value).toBe("button");
    expect(config.roleName).toContain("Generate");
  });

  it("yalnizca placeholder varsa placeholder secer", () => {
    const config = pickBestSelector("promptInput", { ...base, tag: "textarea", placeholder: "Describe your video" }, true);
    expect(config.strategy).toBe("placeholder");
  });

  it("gorunur metin varsa text secer", () => {
    const config = pickBestSelector("downloadMenuItem", { ...base, tag: "div", text: "Download" }, true);
    expect(config.strategy).toBe("text");
    expect(config.value).toBe("Download");
  });

  it("testid varsa css'ten once testid secer", () => {
    const config = pickBestSelector("assetMenuButton", { ...base, testId: "asset-menu" }, true);
    expect(config.strategy).toBe("testid");
    expect(config.value).toBe("asset-menu");
  });

  it("hicbiri yoksa css yoluna duser", () => {
    const config = pickBestSelector("x", base, false);
    expect(config.strategy).toBe("css");
    expect(config.value).toBe("div > button:nth-of-type(2)");
  });

  it("regex ozel karakterlerini kacirir", () => {
    const config = pickBestSelector("x", { ...base, tag: "div", text: "Download (720p)" }, false);
    expect(config.strategy).toBe("text");
    expect(config.value).toBe("Download \\(720p\\)");
  });

  it("metin kutusunda icerik metninden role adi turetmez (kirilgan olur), kalici css secer", () => {
    const config = pickBestSelector(
      "promptInput",
      {
        ...base,
        tag: "div",
        role: "textbox",
        editable: true,
        text: "Generate a video with text",
        accessibleName: "Generate a video with text",
        cssPath: '[contenteditable="true"]',
      },
      true
    );
    expect(config.strategy).toBe("css");
    expect(config.value).toBe('[contenteditable="true"]');
  });

  it("metin kutusunda aria-label varsa role stratejisini kullanir", () => {
    const config = pickBestSelector(
      "promptInput",
      { ...base, tag: "textarea", role: "textbox", editable: true, ariaLabel: "Prompt", cssPath: "textarea" },
      true
    );
    expect(config.strategy).toBe("role");
    expect(config.value).toBe("textbox");
    expect(config.roleName).toBe("Prompt");
  });

  it("kalici css secici uretildiyse nth-of-type zinciri kullanmaz", () => {
    const config = pickBestSelector("promptInput", { ...base, tag: "textarea", editable: true, cssPath: "textarea" }, true);
    expect(config.strategy).toBe("css");
    expect(config.value).toBe("textarea");
    expect(config.value).not.toContain("nth-of-type");
  });
});

describe("Kalibrasyon: aday listesi (dogrulama icin)", () => {
  const base = {
    tag: "button",
    id: "",
    testId: "",
    ariaLabel: "",
    role: "",
    accessibleName: "",
    placeholder: "",
    text: "",
    cssPath: "button.generate",
    editable: false,
  };

  it("oncelik sirasina gore birden fazla aday uretir ve css'i sona koyar", () => {
    const candidates = buildSelectorCandidates(
      "generateButton",
      { ...base, role: "button", accessibleName: "Olustur", text: "Olustur" },
      true
    );
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates[0].strategy).toBe("role");
    expect(candidates[candidates.length - 1].strategy).toBe("css");
  });

  it("ayni adayi tekrar eklemez", () => {
    const candidates = buildSelectorCandidates("x", { ...base, role: "button", accessibleName: "Indir", text: "Indir" }, false);
    const signatures = candidates.map((c) => `${c.strategy}|${c.value}|${c.roleName}`);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("uzun etiketlerde en uzun kelimeyi kullanir (regex kismi eslesme yapar)", () => {
    const longLabel = "Bu cok uzun bir dugme etiketidir ve kirk karakterden fazladir kesinlikle";
    const candidates = buildSelectorCandidates("x", { ...base, role: "button", accessibleName: longLabel }, false);
    const roleCandidate = candidates.find((c) => c.strategy === "role");
    expect(roleCandidate).toBeDefined();
    expect(roleCandidate!.roleName.length).toBeLessThanOrEqual(40);
    expect(longLabel).toContain(roleCandidate!.roleName);
  });

  it("hicbir bilgi yoksa en azindan etiket adiyla css adayi uretir", () => {
    const candidates = buildSelectorCandidates("x", { ...base, cssPath: "" }, false);
    expect(candidates.length).toBe(1);
    expect(candidates[0].strategy).toBe("css");
    expect(candidates[0].value).toBe("button");
  });
});

describe("Dayanikli secici zinciri", () => {
  it("kritik ogeler icin yerlesik yedek tarifi bulunur (kalibrasyonsuz calisabilme)", () => {
    for (const key of ["promptInput", "generateButton", "assetMenuButton", "downloadMenuItem", "referenceConfirmButton"]) {
      expect(SEMANTIC_FALLBACKS[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("prompt kutusu yedekleri metin kutusu kaliplarini kapsar", () => {
    const values = SEMANTIC_FALLBACKS.promptInput.map((c) => c.value);
    expect(values).toContain("textarea");
    expect(values).toContain("[contenteditable='true']");
  });

  it("referans onay dugmesi yedegi 'isteme ekle' ve 'isleme ekle' yazimlarini kapsar", () => {
    const pattern = SEMANTIC_FALLBACKS.referenceConfirmButton[0].roleName;
    expect(new RegExp(pattern, "i").test("İsteme ekle")).toBe(true);
    expect(new RegExp(pattern, "i").test("İşleme ekle")).toBe(true);
    expect(new RegExp(pattern, "i").test("Add to prompt")).toBe(true);
  });

  it("Turkce buyuk I ile baslayan etiketleri yakalar (JS 'i' bayragi bunu yapmaz)", () => {
    // Kontrol: sade bir 'i' kalibi Turkce buyuk I ile eslesmez
    expect(/indir/i.test("İndir")).toBe(false);

    const download = SEMANTIC_FALLBACKS.downloadMenuItem[0].roleName;
    expect(new RegExp(download, "i").test("İndir")).toBe(true);
    expect(new RegExp(download, "i").test("Download")).toBe(true);
  });

  it("hata banner'i yedegi adsiz role=alert kullanmaz (yanlis alarm riski)", () => {
    const hasBareAlert = SEMANTIC_FALLBACKS.errorBanner.some((c) => c.strategy === "role" && !c.roleName);
    expect(hasBareAlert).toBe(false);
  });

  it("hata banner'i Flow'un kalici 'hata yapabileceginden' uyarisina takilmaz", () => {
    const pattern = new RegExp(SEMANTIC_FALLBACKS.errorBanner[0].value, "i");
    // Sayfada surekli duran zararsiz metinler:
    expect(pattern.test("Google Flow hata yapabileceğinden verdiği yanıtları doğrulayın")).toBe(false);
    expect(pattern.test("Hata raporu gönder")).toBe(false);
    // Gercek hata durumlari:
    expect(pattern.test("Bir hata oluştu, lütfen tekrar deneyin")).toBe(true);
    expect(pattern.test("Video oluşturulamadı")).toBe(true);
    expect(pattern.test("Generation failed")).toBe(true);
    expect(pattern.test("Kredi yetersiz")).toBe(true);
  });

  it("Flow'un 'uretim basarisiz' kartini yakalar (ucret alinmaz mesaji)", () => {
    // [0] genel hata, [1] icerik politikasi, [2] ucret alinmaz karti, [3] tek basina durum etiketi
    const cardPattern = new RegExp(SEMANTIC_FALLBACKS.errorBanner[2].value, "i");
    expect(
      cardPattern.test(
        "Oluşturma işlemi beklenenden uzun sürüyor olabilir. Lütfen kısa bir süre sonra tekrar kontrol edin. Oluşturma işlemi başarısız olduğunda ücret alınmaz."
      )
    ).toBe(true);
    expect(cardPattern.test("You will not be charged for failed generations")).toBe(true);
    // Zararsiz metinlere takilmaz:
    expect(cardPattern.test("Google Flow hata yapabileceğinden verdiği yanıtları doğrulayın")).toBe(false);

    const statusPattern = new RegExp(SEMANTIC_FALLBACKS.errorBanner[3].value, "i");
    expect(statusPattern.test("Başarısız")).toBe(true);
    expect(statusPattern.test(" Failed ")).toBe(true);
    expect(statusPattern.test("İşlem başarısız oldu")).toBe(false); // yalnizca tek basina durum etiketi
  });

  it("zincir birlestirmede sira korunur ve tekrarlar atilir", () => {
    const merged = mergeCandidates(
      [{ strategy: "role", value: "button", roleName: "Olustur" }],
      [
        { strategy: "role", value: "button", roleName: "Olustur" },
        { strategy: "css", value: "button.generate", roleName: "" },
      ]
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].roleName).toBe("Olustur");
    expect(merged[1].strategy).toBe("css");
  });

  it("bos degerli adaylar zincire alinmaz", () => {
    const merged = mergeCandidates([{ strategy: "css", value: "", roleName: "" }], [{ strategy: "css", value: "textarea", roleName: "" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe("textarea");
  });

  it("bozuk JSON aday listesi cokme yaratmaz", () => {
    expect(parseCandidates("bozuk")).toEqual([]);
    expect(parseCandidates("")).toEqual([]);
    expect(parseCandidates('[{"strategy":"css","value":"textarea","roleName":""}]')).toHaveLength(1);
  });
});

describe("Bozuk secici tespiti", () => {
  it("tum sayfayi kapsayan css secicilerini reddeder", () => {
    expect(brokenSelectorReasons({ strategy: "css", value: "html", roleName: "" }).length).toBeGreaterThan(0);
    expect(brokenSelectorReasons({ strategy: "css", value: "body", roleName: "" }).length).toBeGreaterThan(0);
  });

  it("ikon fontu metniyle birlesmis adlari reddeder", () => {
    expect(brokenSelectorReasons({ strategy: "role", value: "button", roleName: "arrow_forwardOlustur" }).length).toBeGreaterThan(0);
    expect(brokenSelectorReasons({ strategy: "role", value: "button", roleName: "Videocrop_9_16x1" }).length).toBeGreaterThan(0);
  });

  it("bosluksuz birlesmis etiketleri reddeder", () => {
    expect(brokenSelectorReasons({ strategy: "role", value: "menuitem", roleName: "downloadProjeyi indir" }).length).toBeGreaterThan(0);
  });

  it("cok dilli yerlesik kaliplari (| iceren) gecerli sayar", () => {
    for (const [, candidates] of Object.entries(SEMANTIC_FALLBACKS)) {
      for (const candidate of candidates) {
        expect(brokenSelectorReasons(candidate)).toEqual([]);
      }
    }
  });

  it("saglikli secicileri gecerli sayar", () => {
    expect(brokenSelectorReasons({ strategy: "css", value: "textarea", roleName: "" })).toEqual([]);
    expect(brokenSelectorReasons({ strategy: "role", value: "button", roleName: "Olustur" })).toEqual([]);
  });
});

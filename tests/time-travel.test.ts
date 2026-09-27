import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CharacterProfile, Clip, Project } from "@prisma/client";
import {
  DEFAULT_TIME_TRAVEL_SETTINGS,
  companionSpeciesForFlow,
  isOnCameraShot,
  normalizeFlowProjectUrl,
  normalizeTimeTravelResearch,
  parseTimeTravelSettings,
  serializeTimeTravelSettings,
  softenFamousFiguresForFlow,
  timeTravelLocalLimit,
  companionLookFor,
  HOST_LOOK_PRESETS,
  HOST_WARDROBE_PRESETS,
  randomHostPreset,
  resolveCompanionLook,
  resolveHostPresets,
} from "@/lib/time-travel";
import { sameFlowProject } from "@/lib/flow-project-url";
import { pageIsOnTarget } from "@/server/automation/browser";
import {
  isListedNarration,
  isSupportedTemplateType,
  isTimeTravel,
  projectWorkspaceHref,
  usesCinemaClipPipeline,
} from "@/lib/templates";
import {
  buildTimeTravelClipPrompt,
  buildTimeTravelSheetPrompt,
  parseTimeTravelClipPlan,
  timeTravelReferencePaths,
} from "@/server/services/time-travel";
import { compactPromptForFlow, extractSpokenQuote, FLOW_PROMPT_MAX } from "@/lib/flow-prompt-compact";
import { speechFillRatioFor, NARRATOR_SPEECH_FILL_RATIO } from "@/server/services/splitter";

const project = {
  id: "p1",
  slug: "keops",
  templateType: "time_travel",
  speechLanguage: "Turkish",
  timeTravelSettings: serializeTimeTravelSettings(DEFAULT_TIME_TRAVEL_SETTINGS),
} as unknown as Project;

const host = {
  id: "h",
  role: "main",
  name: "Defne",
  gender: "female",
  age: 27,
  faceFeatures: DEFAULT_TIME_TRAVEL_SETTINGS.hostLook,
  wardrobe: DEFAULT_TIME_TRAVEL_SETTINGS.hostWardrobe,
  voiceCharacter: DEFAULT_TIME_TRAVEL_SETTINGS.hostVoice,
  baseAppearancePrompt: "",
  referenceImagePath: null,
  dnaCard: "{}",
} as unknown as CharacterProfile;

const companion = {
  id: "c",
  role: "side",
  name: "Susam",
  storyRole: "yol arkadaşı · kedi",
  baseAppearancePrompt: DEFAULT_TIME_TRAVEL_SETTINGS.companionLook,
  referenceImagePath: null,
  dnaCard: JSON.stringify({ timeTravelRole: "companion", species: "kedi" }),
} as unknown as CharacterProfile;

const local = {
  id: "l",
  role: "side",
  name: "Henu",
  gender: "male",
  storyRole: "taş ustası",
  baseAppearancePrompt: "sun-tanned stonemason in a white linen kilt, copper chisel in hand",
  referenceImagePath: null,
  dnaCard: JSON.stringify({ timeTravelRole: "local" }),
} as unknown as CharacterProfile;

function clip(partial: Partial<Clip>): Clip {
  return {
    id: "k1",
    index: 3,
    dialogue: "Bakın, Henu bakır keskiyle granitin yüzeyini düzeltiyor. Keops için çalışıyorlar.",
    shotType: "tt_local",
    characterId: "l",
    emotionLabel: "hayranlık",
    imagePrompt:
      "[TT SETTING] the stone quarry beside the half-built pyramid of Khufu at mid-morning\n[TT ACTION] Henu shapes a limestone block\n[TT COMPANION] yes",
    ...partial,
  } as Clip;
}

describe("Zaman Yolcusu sablonu", () => {
  it("ayri bolumde listelenir, sinema klip hattini kullanir", () => {
    expect(isSupportedTemplateType("time_travel")).toBe(true);
    expect(isTimeTravel("time_travel")).toBe(true);
    expect(isListedNarration("time_travel")).toBe(false);
    expect(usesCinemaClipPipeline("time_travel")).toBe(true);
    expect(projectWorkspaceHref({ id: "abc", templateType: "time_travel" })).toBe("/zaman-yolcusu/abc");
    expect(speechFillRatioFor("time_travel")).toBe(NARRATOR_SPEECH_FILL_RATIO);
  });

  it("ayarlar bozuk JSON'da varsayilana doner, alanlari korur", () => {
    expect(parseTimeTravelSettings("bozuk").hostName).toBe("Defne");
    const parsed = parseTimeTravelSettings(JSON.stringify({ hostName: "Kerem", hostGender: "male", hostAge: 5, companionEnabled: false }));
    expect(parsed.hostName).toBe("Kerem");
    expect(parsed.hostGender).toBe("male");
    expect(parsed.hostAge).toBe(DEFAULT_TIME_TRAVEL_SETTINGS.hostAge);
    expect(parsed.companionEnabled).toBe(false);
    expect(companionSpeciesForFlow("Kedi")).toBe("cat");
    expect(companionSpeciesForFlow("zürafa")).toBe("zürafa");
  });

  it("unlu tarihi kisi adlarini gorsel tarifte unvana cevirir", () => {
    expect(softenFamousFiguresForFlow("the pyramid of Khufu and Keops' barge")).toBe("the Great Pyramid and the pharaoh' barge");
    expect(softenFamousFiguresForFlow("MÖ 2560, Keops Piramidi inşa edilirken")).toBe("MÖ 2560, the Great Pyramid inşa edilirken");
    expect(softenFamousFiguresForFlow("İskender ve Fatih Sultan Mehmet")).toBe("the young king ve the sultan");
    expect(softenFamousFiguresForFlow("Henu the stonemason")).toBe("Henu the stonemason");
  });

  it("yerli sahnesinde soz, sunucu, kedi, yerli ve donem kilidi prompta girer", () => {
    const prompt = buildTimeTravelClipPrompt({ project, host, companion, local, clip: clip({}), previousClip: null });
    expect(extractSpokenQuote(prompt)).toContain("Henu bakır keskiyle");
    expect(prompt).toMatch(/lips in sync/);
    expect(prompt).toContain("Host Defne");
    expect(prompt).toMatch(/Companion Susam: a real cat/);
    expect(prompt).toContain("Local Henu");
    expect(prompt).toContain("Gize, Antik Mısır");
    expect(prompt).not.toMatch(/Khufu/);
    expect(prompt).toContain("the Great Pyramid");
    // Sozlu metin ayni kalir; unvana yalnizca gorsel tarif cevrilir.
    expect(prompt).toContain("Keops için çalışıyorlar");
    expect(prompt).not.toMatch(/\[STORY CAST\]|\[GENDER LOCK\]|\[WARDROBE COVER\]/);
  });

  it("goz hizasi ve genis planda sunucu dis sestir, kedi istenmezse yazilmaz", () => {
    const pov = buildTimeTravelClipPrompt({
      project,
      host,
      companion,
      local: null,
      clip: clip({ shotType: "tt_pov", characterId: null, imagePrompt: "[TT SETTING] market stalls\n[TT ACTION] bread\n[TT COMPANION] no" }),
      previousClip: null,
    });
    expect(isOnCameraShot("tt_pov")).toBe(false);
    expect(pov).toMatch(/Off-screen voice of Defne/);
    expect(pov).not.toMatch(/Companion Susam/);
    const wide = buildTimeTravelClipPrompt({
      project,
      host,
      companion,
      local: null,
      clip: clip({ shotType: "tt_wide", characterId: null }),
      previousClip: clip({ index: 2 }),
    });
    expect(wide).toMatch(/Wide establishing shot/);
    expect(wide).toMatch(/previous shot:/);
  });

  it("Flow kisaltmasindan soz ve kimlik kaybolmadan gecer", () => {
    const prompt = buildTimeTravelClipPrompt({ project, host, companion, local, clip: clip({}), previousClip: clip({ index: 2 }) });
    expect(prompt.length).toBeLessThan(FLOW_PROMPT_MAX);
    const { text } = compactPromptForFlow(prompt, "Turkish");
    expect(text.length).toBeLessThanOrEqual(FLOW_PROMPT_MAX);
    expect(text).toContain("Henu bakır keskiyle");
    expect(text).toContain("Host Defne");
    expect(text).toMatch(/\[NO ON-SCREEN TEXT/);
  });

  it("plan etiketleri okunur", () => {
    const plan = parseTimeTravelClipPlan("[TT SETTING] quay\n[TT ACTION] barge arrives\n[TT COMPANION] no");
    expect(plan).toEqual({ setting: "quay", action: "barge arrives", companion: false, famous: "" });
    expect(parseTimeTravelClipPlan("").companion).toBe(true);
  });

  it("arastirma: atif linkleri, ENGLISH oneki ve utm temizlenir; bos arastirma null", () => {
    const research = normalizeTimeTravelResearch({
      era: "14–15 Nisan 1912 gecesi",
      place: "RMS Titanic",
      stops: [
        {
          time: "23:40",
          location: "Pruva",
          happening: "Çarpışma",
          facts: ["Çarpışma 23:40'ta oldu. ([titanicinquiry.org](https://www.titanicinquiry.org/x?utm_source=openai))"],
        },
      ],
      visualWorld: "ENGLISH: Riveted steel hull and teak decks.",
      anachronisms: ["ENGLISH: smartphones", "LED panels"],
      famousFigures: [{ name: "Edward J. Smith", role: "the captain", staging: "ENGLISH: from behind on the bridge" }],
      sources: [{ title: "TIP", url: "https://www.titanicinquiry.org/x?utm_source=openai" }, { title: "bad", url: "ftp://x" }],
    });
    expect(research?.stops[0].facts[0]).toBe("Çarpışma 23:40'ta oldu.");
    expect(research?.visualWorld).toBe("Riveted steel hull and teak decks.");
    expect(research?.anachronisms).toEqual(["smartphones", "LED panels"]);
    expect(research?.famousFigures[0].staging).toBe("from behind on the bridge");
    expect(research?.sources).toEqual([{ title: "TIP", url: "https://www.titanicinquiry.org/x" }]);
    expect(normalizeTimeTravelResearch({})).toBeNull();
    expect(normalizeTimeTravelResearch("x")).toBeNull();
  });

  it("arastirmali promptta donem dunyasi arastirmadan gelir, unlu kisi yuzsuz sahnelenir", () => {
    const researched = {
      ...project,
      timeTravelSettings: serializeTimeTravelSettings({
        ...DEFAULT_TIME_TRAVEL_SETTINGS,
        era: "14 Nisan 1912 gecesi",
        place: "RMS Titanic, Kuzey Atlantik",
        research: normalizeTimeTravelResearch({
          era: "14 Nisan 1912 gecesi",
          place: "RMS Titanic",
          stops: [{ time: "23:40", location: "Güverte", happening: "Çarpışma", facts: [] }],
          visualWorld: "Riveted steel hull, teak decks, Edwardian lamps.",
          allowedTech: "Marconi wireless telegraph, electric lighting",
          anachronisms: ["smartphones", "LED panels"],
          famousFigures: [{ name: "Edward J. Smith", role: "the captain", staging: "from behind on the bridge wing, face hidden by the cap" }],
        }),
      }),
    } as unknown as Project;
    const prompt = buildTimeTravelClipPrompt({
      project: researched,
      host,
      companion,
      local: null,
      clip: clip({
        shotType: "tt_wide",
        characterId: null,
        dialogue: "Kaptan Edward J. Smith köprü üstünde.",
        imagePrompt:
          "[TT SETTING] the bridge wing where Edward J. Smith stands\n[TT ACTION] officers look forward\n[TT COMPANION] yes\n[TT FAMOUS] the captain — from behind on the bridge wing, face hidden by the cap",
      }),
      previousClip: null,
    });
    expect(prompt).toContain("Riveted steel hull");
    expect(prompt).toContain("Marconi wireless telegraph");
    expect(prompt).toContain("Must NOT appear");
    expect(prompt).toContain("smartphones");
    expect(prompt).not.toMatch(/no cars, no plastic/);
    expect(prompt).toMatch(/never shown face to face/);
    expect(prompt).toMatch(/exactly once — never twins/);
    // Gorsel tarifte ad yok, sozde var.
    const visual = prompt.replace(/"[^"]*"/g, "");
    expect(visual).not.toMatch(/Edward J\. Smith/);
    expect(prompt).toContain("Kaptan Edward J. Smith köprü üstünde.");
  });

  it("arastirmasiz promptta dunya kilidi donemden sonraki her seyi yasaklar", () => {
    const prompt = buildTimeTravelClipPrompt({ project, host, companion, local, clip: clip({}), previousClip: null });
    expect(prompt).toMatch(/Nothing that was invented or built after this moment/);
    expect(prompt).toMatch(/Henu is a different person from Defne/);
  });

  it("yol arkadasi gorunumu secilen turle celisirse turun tarifi kullanilir", () => {
    const kitten = DEFAULT_TIME_TRAVEL_SETTINGS.companionLook;
    expect(resolveCompanionLook("papağan", kitten)).toMatch(/parrot/);
    expect(resolveCompanionLook("papağan", kitten)).not.toMatch(/kitten|tabby/);
    expect(resolveCompanionLook("köpek", kitten)).toMatch(/puppy/);
    expect(resolveCompanionLook("kedi", kitten)).toBe(kitten);
    expect(resolveCompanionLook("papağan", "")).toMatch(/parrot/);
    // Elle yazilmis ve ture uyan metin korunur
    expect(resolveCompanionLook("papağan", "big red macaw with blue wings")).toBe("big red macaw with blue wings");
    expect(companionLookFor("kaplumbağa")).toMatch(/tortoise/);
  });

  it("sunucu cinsiyetiyle celisen hazir metinler duzelir, elle yazilan kalir", () => {
    const male = resolveHostPresets({ ...DEFAULT_TIME_TRAVEL_SETTINGS, hostGender: "male" });
    expect(HOST_LOOK_PRESETS.male).toContain(male.hostLook);
    expect(HOST_WARDROBE_PRESETS.male).toContain(male.hostWardrobe);
    expect(male.hostVoice).toMatch(/young man/);
    const custom = resolveHostPresets({ ...DEFAULT_TIME_TRAVEL_SETTINGS, hostGender: "male", hostLook: "bald, gray beard" });
    expect(custom.hostLook).toBe("bald, gray beard");
    const female = resolveHostPresets(DEFAULT_TIME_TRAVEL_SETTINGS);
    expect(female.hostLook).toBe(DEFAULT_TIME_TRAVEL_SETTINGS.hostLook);
  });

  it("rastgele sunucu gorunumu cinsiyete uyar ve mevcut gorunumu tekrar secmez", () => {
    for (let i = 0; i < 20; i++) {
      const current = { hostLook: HOST_LOOK_PRESETS.female[0], hostWardrobe: HOST_WARDROBE_PRESETS.female[0], hostVoice: "raspy low voice" };
      const p = randomHostPreset("female", current);
      expect(HOST_LOOK_PRESETS.female).toContain(p.hostLook);
      expect(p.hostLook).not.toBe(current.hostLook);
      // Kiyafet de her oneride degisir
      expect(HOST_WARDROBE_PRESETS.female).toContain(p.hostWardrobe);
      expect(p.hostWardrobe).not.toBe(current.hostWardrobe);
      // Elle yazilmis ses korunur
      expect(p.hostVoice).toBe("raspy low voice");
      expect(randomHostPreset("male").hostVoice).toMatch(/young man/);
    }
  });

  it("yerli sayisi sureyle sinirlanir (kredi)", () => {
    expect(timeTravelLocalLimit(60)).toBe(2);
    expect(timeTravelLocalLimit(180)).toBe(3);
    expect(timeTravelLocalLimit(300)).toBe(4);
    expect(timeTravelLocalLimit(600)).toBe(6);
    expect(timeTravelLocalLimit(840)).toBe(7);
    expect(timeTravelLocalLimit(3600)).toBe(8);
  });

  it("Flow proje adresi dogrulanir ve sade bicime getirilir", () => {
    expect(
      normalizeFlowProjectUrl("https://labs.google/fx/tr/tools/flow/project/f2d9093c-5944-44ff-920e-78f7036541d8/edit/abc?x=1")
    ).toBe("https://labs.google/fx/tr/tools/flow/project/f2d9093c-5944-44ff-920e-78f7036541d8");
    expect(normalizeFlowProjectUrl("https://labs.google/fx/tools/flow/project/f2d9093c-5944")).toBe(
      "https://labs.google/fx/tools/flow/project/f2d9093c-5944"
    );
    expect(normalizeFlowProjectUrl("https://labs.google/fx/tr/tools/flow")).toBeNull();
    expect(normalizeFlowProjectUrl("https://evil.example/fx/tools/flow/project/f2d9093c-5944")).toBeNull();
    expect(normalizeFlowProjectUrl("http://labs.google/fx/tools/flow/project/f2d9093c-5944")).toBeNull();
    expect(normalizeFlowProjectUrl("")).toBeNull();
  });

  it("yeni flow.google.com proje adresini kabul eder ve eski adresle ayni proje sayar", () => {
    const fresh = "https://flow.google.com/project/3ebc258c-7f86-4d1e-9df5-cd8ad971af9a";
    expect(normalizeFlowProjectUrl(fresh)).toBe(fresh);
    expect(normalizeFlowProjectUrl(`${fresh}/edit/abc?utm_source=x`)).toBe(fresh);
    expect(normalizeFlowProjectUrl("flow.google.com/project/3ebc258c-7f86-4d1e-9df5-cd8ad971af9a")).toBe(fresh);
    expect(normalizeFlowProjectUrl("https://flow.google.com/")).toBeNull();
    expect(normalizeFlowProjectUrl("https://flow.google.com.evil.io/project/3ebc258c-7f86")).toBeNull();
    const legacy = "https://labs.google/fx/tr/tools/flow/project/3ebc258c-7f86-4d1e-9df5-cd8ad971af9a";
    expect(sameFlowProject(fresh, legacy)).toBe(true);
    expect(sameFlowProject(`${fresh}/characters`, legacy)).toBe(true);
    expect(sameFlowProject(fresh, "https://flow.google.com/project/0000aaaa-1111-2222-3333-444455556666")).toBe(false);
    expect(sameFlowProject("", "")).toBe(false);
    expect(pageIsOnTarget(`${fresh}/edit/x`, legacy)).toBe(true);
    expect(pageIsOnTarget("https://flow.google.com/", legacy)).toBe(false);
  });

  it("unlu kisi adini arastirma unvanina cevirir", () => {
    expect(softenFamousFiguresForFlow("Osman Bey rides past", [{ name: "Osman Bey", role: "the bey" }])).toBe("the bey rides past");
  });

  it("referans: sunucu + kedi + yerli; goz hizasinda sunucu yok", () => {
    const root = path.join(process.cwd(), "projects", "__tt_test__");
    fs.mkdirSync(root, { recursive: true });
    const write = (name: string) => {
      const file = path.join(root, name);
      fs.writeFileSync(file, "x");
      return file;
    };
    try {
      const cast = [
        { ...host, referenceImagePath: write("host.png") },
        { ...companion, referenceImagePath: write("cat.png") },
        { ...local, referenceImagePath: write("henu.png") },
      ];
      const localRefs = timeTravelReferencePaths(clip({}), cast);
      expect(localRefs.labels).toEqual(["sunucu", "yol arkadaşı", "yerli"]);
      const povRefs = timeTravelReferencePaths(
        clip({ shotType: "tt_pov", characterId: null, imagePrompt: "[TT COMPANION] no" }),
        cast
      );
      expect(povRefs.paths).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("kedi sheet'i insan / cinsiyet kilidi tasimaz", () => {
    const sheet = buildTimeTravelSheetPrompt(project, companion);
    expect(sheet).toMatch(/ONE real cat/);
    expect(sheet).toMatch(/No humans/);
    expect(sheet).not.toMatch(/\[GENDER LOCK\]|adult woman/);
    const hostSheet = buildTimeTravelSheetPrompt(project, host);
    expect(hostSheet).toMatch(/adult woman/);
    expect(hostSheet).toMatch(/crescent-and-star necklace/);
    expect(hostSheet).not.toMatch(/mini skirt|short dress/i);
  });
});

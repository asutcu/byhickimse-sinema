import { z } from "zod";
import { structuredCall } from "@/server/services/openai";
import { recordEvent } from "@/server/lib/logger";
import {
  normalizeTimeTravelResearch,
  TIME_TRAVEL_IDEA_CATEGORIES,
  timeTravelLocalLimit,
  type TimeTravelResearch,
} from "@/lib/time-travel";

/**
 * Zaman Yolcusu konu arastirmasi.
 * Kullanici istedigi tarihi / olayi yazar; model (mumkunse web aramasiyla)
 * dogru tarih, yer, durak durak gun plani, gercek bilgiler, donem yerlileri,
 * gorsel dunya ve o yilda OLMAMASI gerekenleri cikarir.
 */

const researchSchema = z.object({
  title: z.string(),
  era: z.string(),
  place: z.string(),
  eraEnglish: z.string(),
  placeEnglish: z.string(),
  summary: z.string(),
  hostAngle: z.string(),
  stops: z.array(
    z.object({ time: z.string(), location: z.string(), happening: z.string(), facts: z.array(z.string()) })
  ),
  locals: z.array(z.object({ name: z.string(), role: z.string(), gender: z.enum(["male", "female"]), look: z.string() })),
  famousFigures: z.array(z.object({ name: z.string(), role: z.string(), staging: z.string() })),
  visualWorld: z.string(),
  allowedTech: z.string(),
  anachronisms: z.array(z.string()),
  cautions: z.array(z.string()),
  thumbnailText: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

const RESEARCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "YouTube basligi, birinci tekil, konusma dilinde (or. 'Titanik'e Zaman Yolculugu Yaptim!')" },
    era: { type: "string", description: "Kesin tarih/yil + o anki olay, Turkce (or. '14 Nisan 1912 gecesi, Titanik buzdagina carparken')" },
    place: { type: "string", description: "Kesin yer, Turkce (or. 'RMS Titanic, Kuzey Atlantik')" },
    eraEnglish: {
      type: "string",
      description: "era in plain English for the video model, with AD/BC written out (e.g. 'AD 79, the morning before Mount Vesuvius erupted')",
    },
    placeEnglish: { type: "string", description: "place in plain English (e.g. 'Pompeii, Roman Campania, Italy')" },
    summary: { type: "string", description: "Turkce 4-6 cumle tarihsel baglam; yalnizca dogrulanmis bilgi" },
    hostAngle: { type: "string", description: "Turkce: sunucunun bu yolculuktaki derdi / kancasi (or. yolculari uyarmaya calisir)" },
    stops: {
      type: "array",
      description: "Kronolojik 6-10 durak; gunun / olayin akisi",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          time: { type: "string", description: "Turkce saat/an (or. 'Sabah 07:00', 'Gece 23:40')" },
          location: { type: "string", description: "Turkce kesin mekan" },
          happening: { type: "string", description: "Turkce: o durakta ne oluyor, sunucu ne yapiyor" },
          facts: { type: "array", items: { type: "string" }, description: "Turkce 1-3 dogrulanmis bilgi (sayi, tarih, teknik)" },
        },
        required: ["time", "location", "happening", "facts"],
      },
    },
    locals: {
      type: "array",
      description: "Sunucunun tanisacagi SIRADAN donem insanlari (gercek unlu kisi DEGIL); sayisi sistem mesajinda. Doneme ve cografyaya uygun isimler.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "Turkce meslek / rol" },
          gender: { type: "string", enum: ["male", "female"] },
          look: { type: "string", description: "In English: age, face, hair, era-accurate clothing and props" },
        },
        required: ["name", "role", "gender", "look"],
      },
    },
    famousFigures: {
      type: "array",
      description: "Hikayede anilan gercek unlu kisiler (yoksa bos). Bunlar ASLA yakin plan yuzle gosterilmez.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Gercek adi (metinde gectigi gibi)" },
          role: { type: "string", description: "In English: generic title without the name (the sultan, the commander, the captain)" },
          staging: {
            type: "string",
            description: "In English: how to show them without a readable face (far away, from behind, in a crowd, silhouette)",
          },
        },
        required: ["name", "role", "staging"],
      },
    },
    visualWorld: {
      type: "string",
      description: "In English, 3-5 sentences: architecture, materials, clothing, colors, light, crowd, sounds of this exact time and place",
    },
    allowedTech: { type: "string", description: "In English: vehicles, tools, devices and lighting that DID exist then" },
    anachronisms: {
      type: "array",
      items: { type: "string" },
      description: "In English: 6-12 things that must NOT appear because they did not exist yet (or are wrong for this place)",
    },
    cautions: {
      type: "array",
      items: { type: "string" },
      description: "Turkce: tartismali / emin olunmayan bilgiler ve hassas konular (nasil anlatilmali)",
    },
    thumbnailText: { type: "string", description: "Kapak icin 2-4 kelimelik dev yazi, konusma dilinde (or. '1912 GECESI')" },
    sources: {
      type: "array",
      description: "Kullanilan guvenilir kaynaklar (web aramasi yapildiysa gercek URL)",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, url: { type: "string" } },
        required: ["title", "url"],
      },
    },
  },
  required: [
    "title",
    "era",
    "place",
    "eraEnglish",
    "placeEnglish",
    "summary",
    "hostAngle",
    "stops",
    "locals",
    "famousFigures",
    "visualWorld",
    "allowedTech",
    "anachronisms",
    "cautions",
    "thumbnailText",
    "sources",
  ],
};

export async function researchTimeTravelTopic(input: {
  topic: string;
  speechLanguage: string;
  targetDurationSeconds: number;
  hostName?: string;
  companion?: string;
  projectId?: string;
}): Promise<TimeTravelResearch> {
  const topic = input.topic.replace(/\s+/g, " ").trim();
  if (topic.length < 3) throw new Error("Araştırma için bir konu yazın (ör. 'Titanik batarken', '29 Ekim 1923 Ankara').");
  const minutes = Math.max(1, Math.round(input.targetDurationSeconds / 60));
  const stopCount = Math.max(4, Math.min(10, Math.round(minutes / 1.6)));
  if (input.projectId) {
    await recordEvent({ projectId: input.projectId, step: "story", message: `Konu arastiriliyor: ${topic}` });
  }
  let citations: Array<{ title: string; url: string }> = [];
  let searched = false;
  const payload = await structuredCall<z.infer<typeof researchSchema>>({
    system: [
      "Sen bir tarih arastirmacisi ve belgesel yapimcisisin. 'Zaman Yolcusu' YouTube vlogu icin arastirma dosyasi hazirlarsin.",
      "Once konuyu internette arastir; yalnizca guvenilir kaynaklardaki (ansiklopedi, muze, akademik, resmi) bilgileri kullan.",
      "Tarih, yer, sayi ve adlarda KESINLIK: emin olmadigin seyi kesinmis gibi yazma, cautions alanina yaz.",
      "Kullanici konuyu belirsiz yazdiysa en ikonik ve gorsel olarak en zengin ani sec (or. 'Titanik' → 14-15 Nisan 1912 gecesi).",
      "Sunucu modern bir gezgindir, o ana isinlanir; tarihi DEGISTIRMEZ, tanik olur.",
      "Yerliler siradan donem insanlaridir (gercek unlu kisi degil); isimleri o cografya ve donem icin gercekci olsun.",
      "Gercek unlu kisiler (padisah, lider, kaptan) famousFigures'a yazilir ve yalnizca uzaktan / arkadan / kalabalik icinde gosterilir.",
      "Siddet, olum, felaket konularinda saygili ol: kan, yarali yakin plan, ceset yok; duyguyu insanlarin tepkisinden anlat.",
      `Durak sayisi: ${stopCount}. Yerli sayisi: en fazla ${timeTravelLocalLimit(input.targetDurationSeconds)}. Video suresi yaklasik ${minutes} dakika.`,
    ].join("\n"),
    user: [
      `Konu: ${topic}`,
      `Konusma dili: ${input.speechLanguage}`,
      input.hostName ? `Sunucu: ${input.hostName}` : "",
      input.companion ? `Yol arkadasi: ${input.companion}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    schemaName: "time_travel_research",
    jsonSchema: RESEARCH_JSON_SCHEMA,
    zodSchema: researchSchema,
    reasoningEffort: "medium",
    // Web aramali derin arastirma 6-9 dk surebiliyor; 8 dk sinir kenarda kaliyordu.
    timeoutMs: 12 * 60_000,
    webSearch: true,
    onSources: (sources) => {
      searched = true;
      citations = sources;
    },
  });

  const sources = [...citations];
  for (const s of payload.sources) {
    if (/^https?:\/\//i.test(s.url) && !sources.some((c) => c.url === s.url)) sources.push(s);
  }
  const research = normalizeTimeTravelResearch({
    ...payload,
    topic,
    sources,
    webSearched: searched || citations.length > 0,
    researchedAt: new Date().toISOString(),
  });
  if (!research) throw new Error("Araştırma sonucu boş geldi; konuyu biraz daha açık yazıp tekrar deneyin.");
  if (input.projectId) {
    await recordEvent({
      projectId: input.projectId,
      step: "story",
      message: `Arastirma hazir: ${research.era} · ${research.place} (${research.stops.length} durak, ${research.sources.length} kaynak${research.webSearched ? ", web" : ""})`,
    });
  }
  return research;
}

const ideasSchema = z.object({
  ideas: z.array(z.object({ topic: z.string(), era: z.string(), place: z.string(), hook: z.string() })),
});

export async function suggestTimeTravelIdeas(input: {
  category?: string;
  speechLanguage: string;
  exclude?: string[];
}): Promise<Array<{ topic: string; era: string; place: string; hook: string }>> {
  const category = input.category && (TIME_TRAVEL_IDEA_CATEGORIES as readonly string[]).includes(input.category)
    ? input.category
    : "Karisik";
  const result = await structuredCall<z.infer<typeof ideasSchema>>({
    system: [
      "Zaman yolculugu YouTube vlog kanali icin bolum fikirleri uretirsin.",
      "Her fikir tek bir gercek tarihsel ana / gune gider; gorsel olarak zengin, merak uyandiran, dogrulanabilir olsun.",
      "Ornek tarz: 'Titanik'e zaman yolculugu (insanlari uyarmayi denedim)', '29 Ekim 1923 Ankara', 'Kanuni doneminde bir gun', '1996'da bir gun'.",
      "topic alani kullanicinin arastirma kutusuna yazilacak kisa cumledir, konusma dilinde.",
    ].join("\n"),
    user: [
      `Kategori: ${category}`,
      `Konusma dili: ${input.speechLanguage}`,
      input.exclude?.length ? `Bunlari tekrar etme: ${input.exclude.slice(0, 20).join(" | ")}` : "",
      "8 farkli fikir ver.",
    ]
      .filter(Boolean)
      .join("\n"),
    schemaName: "time_travel_ideas",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              topic: { type: "string" },
              era: { type: "string" },
              place: { type: "string" },
              hook: { type: "string", description: "Tek cumlelik merak kancasi" },
            },
            required: ["topic", "era", "place", "hook"],
          },
        },
      },
      required: ["ideas"],
    },
    zodSchema: ideasSchema,
    reasoningEffort: "low",
    timeoutMs: 3 * 60_000,
  });
  return result.ideas.filter((i) => i.topic.trim()).slice(0, 8);
}

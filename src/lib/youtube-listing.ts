import { languageTagFor } from "@/lib/tts-catalog";

export type ListingBrief = {
  storyTitle: string;
  projectTitle: string;
  setup: string;
  nouns: string[];
  tagSeeds: string[];
  genreLabel: string;
  language: string;
};

const SPOILER_LINE =
  /geschäftsführer|kommissarisch|\bceo\b|usb[- ]?stick|\bkickback\b|rückvergütung|hissedar|aktieninhaber|fristlos|kündigung|entpuppte|zweite chance|ich blieb\b|beweise gegen|machtverhältnisse|geschäftsführer der|entpuppte sich|pr[- ]paket|rückkehr|grafiken|zahlen\.|monitor/i;

const GENERIC_ATMOSPHERE =
  /\b(kalte luft|ein schritt,? der atmet|leise wut|höflichen stimmen|hoeflichen stimmen|hava değişiyor|sis incelirken|die luft ändert sich|ein abend,? eine firma|bir an her şey|ne olacağını izleyince)\b/gi;

const DIALOGUE_VERB =
  /\b(sagte|legte|war|ging|sah|zog|rief|stellte|sperrte|fror|griff|atmete|lachte|nickte|fragte|heiratete)\b/i;

const WEAK_NOUN =
  /^(Display|Tresen|Kaffee|Glas|Luft|Blick|Stimme|Hand|Jacke|Tür|Auto|Kombi|Sofa|Tee|Fenster|Stadt|Logo|Tisch|Saal|Folie|Akte|Maske|Linie|Platte|Name|Wort|Schritt|Stille|Trotz|Telefon|Fremden|Fantasie|Stunde|Heirate|Heute|Jetzt)$/i;

const STOP_NOUN = new Set(
  [
    "ich",
    "du",
    "er",
    "sie",
    "wir",
    "mein",
    "meine",
    "sein",
    "seine",
    "eine",
    "einer",
    "eines",
    "dieser",
    "diese",
    "dann",
    "heute",
    "keine",
    "alles",
    "nach",
    "vor",
    "beim",
    "und",
    "der",
    "die",
    "das",
    "ein",
    "im",
    "am",
    "mit",
    "aus",
    "von",
    "für",
    "nicht",
    "noch",
    "nur",
    "aber",
    "oder",
    "auch",
    "sehr",
    "hier",
    "dort",
    "wenn",
    "weil",
    "dass",
    "the",
    "and",
    "video",
    "youtube",
    "yeni",
  ].map((s) => s.toLowerCase())
);

const SITUATION_PHRASES: Array<{ re: RegExp; de: string; tr: string; en: string }> = [
  { re: /suite\s*908/i, de: "Suite 908", tr: "Suite 908", en: "Suite 908" },
  { re: /blitzhochzeit|yıldırım\s*nik[aâ]h|yildirim\s*nikah/i, de: "Blitzhochzeit", tr: "yıldırım nikâhı", en: "lightning wedding" },
  { re: /standesamt/i, de: "Standesamt", tr: "nikâh dairesi", en: "registry office" },
  { re: /hotelbuchung|reservierung/i, de: "Hotelbuchung", tr: "otel rezervasyonu", en: "hotel booking" },
  { re: /sekretärin|secretary/i, de: "Sekretärin", tr: "sekreter", en: "secretary" },
  { re: /\bhandy\b|telefon/i, de: "Handy", tr: "telefon", en: "phone" },
];

const GENRE_SEARCH: Array<{ re: RegExp; de: string; tr: string; en: string }> = [
  { re: /yildirim|yıldırım|blitzhochzeit|lightning wedding|nikah/i, de: "Blitzhochzeit", tr: "yıldırım nikâhı", en: "lightning wedding" },
  { re: /aldatma|affair|fremdgeh|infidel/i, de: "Fremdgehen", tr: "aldatma", en: "cheating" },
  { re: /ihanet|verrat|betray/i, de: "Verrat", tr: "ihanet", en: "betrayal" },
  { re: /aile|family|familie|ehe/i, de: "Familiendrama", tr: "aile draması", en: "family drama" },
];

export function listingLangTag(language?: string | null): string {
  return languageTagFor(language) || "tr";
}

export function genreSearchLabel(genre: string | null | undefined, language?: string | null): string {
  const g = String(genre || "").trim();
  if (!g) return "";
  const tag = listingLangTag(language);
  for (const row of GENRE_SEARCH) {
    if (row.re.test(g)) {
      if (tag === "de") return row.de;
      if (tag === "en") return row.en;
      return row.tr;
    }
  }
  return g;
}

export function splitListingSentences(text: string): string[] {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 8);
}

export function stripSpoilerSentences(text: string): string {
  const kept: string[] = [];
  for (const s of splitListingSentences(text)) {
    if (SPOILER_LINE.test(s)) continue;
    kept.push(s);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

export function spoilerSafeSetup(texts: Array<string | null | undefined>, maxChars = 480): string {
  const kept: string[] = [];
  let n = 0;
  for (const text of texts) {
    if (!text?.trim()) continue;
    for (const s of splitListingSentences(text)) {
      if (SPOILER_LINE.test(s)) break;
      if (kept.some((k) => k.toLowerCase() === s.toLowerCase())) continue;
      kept.push(s);
      n += s.length + 1;
      if (n >= maxChars) {
        return kept.join(" ").slice(0, maxChars).replace(/\s+\S*$/, "").trim();
      }
    }
  }
  return kept.join(" ").slice(0, maxChars).trim();
}

function pickPhraseLabel(row: { de: string; tr: string; en: string }, tag: string): string {
  if (tag === "de") return row.de;
  if (tag === "en") return row.en;
  return row.tr;
}

function addUnique(list: string[], value: string) {
  const t = value.replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 36) return;
  if (STOP_NOUN.has(t.toLowerCase()) || WEAK_NOUN.test(t)) return;
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  if (list.some((x) => x.toLowerCase() !== t.toLowerCase() && x.toLowerCase().includes(t.toLowerCase()))) {
    return;
  }
  const shorter = list.findIndex(
    (x) => x.toLowerCase() !== t.toLowerCase() && t.toLowerCase().includes(x.toLowerCase())
  );
  if (shorter >= 0) list.splice(shorter, 1);
  list.push(t);
}

export function extractListingNouns(text: string, language?: string | null): string[] {
  const tag = listingLangTag(language);
  const nouns: string[] = [];
  const blob = String(text || "");

  for (const row of SITUATION_PHRASES) {
    if (row.re.test(blob)) addUnique(nouns, pickPhraseLabel(row, tag));
  }

  const suite = blob.match(/\bSuite\s*\d+\b/gi);
  if (suite) addUnique(nouns, suite[0].replace(/\s+/g, " "));

  for (const w of blob.match(/\b[A-ZÄÖÜ][a-zäöüß]{3,20}\b/g) || []) {
    if (STOP_NOUN.has(w.toLowerCase())) continue;
    if (/^(Heute|Keine|Alles|Diese|Dieser|Meine|Seine|Deine|Einen|Einer|Beim|Nach|Dann)$/i.test(w)) continue;
    addUnique(nouns, w);
  }

  return nouns.slice(0, 12);
}

export function isWeakListingToken(tag: string): boolean {
  const t = String(tag || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (WEAK_NOUN.test(t)) return true;
  if (STOP_NOUN.has(t.toLowerCase())) return true;
  return false;
}

export function looksLikeDialogueTag(tag: string): boolean {
  const t = String(tag || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 6) return true;
  if (t.length > 42) return true;
  if (/[„""]/.test(t)) return true;
  if (/^(ich|er|sie|wir|du|sein|seine|meine)\b/i.test(t) && DIALOGUE_VERB.test(t)) return true;
  if (/,/.test(t) && words.length >= 5) return true;
  if (/^(das|die|der|und|ein|im|am)\s/i.test(t) && words.length <= 2) return true;
  return false;
}

export function isKeywordSaladTitle(title: string): boolean {
  const t = String(title || "").trim();
  if (!t) return true;
  const slashGroups = t.match(/\s\/\s/g) || [];
  if (slashGroups.length >= 2) return true;
  if ((t.match(/\//g) || []).length >= 3) return true;
  if (/^[^.]{0,48}\/[^.]{0,36}\//.test(t)) return true;
  return false;
}

/** "Suite 908, Blitzhochzeit, Standesamt:" veya "A — B, C" fiilsiz yigin. */
export function isStackedKeywordCopy(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (isKeywordSaladTitle(t)) return true;
  const lead = t.split(":")[0] || "";
  const leadParts = lead.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  if (leadParts.length >= 3 && leadParts.every((p) => p.split(/\s+/).length <= 3)) return true;
  const hasVerb = /\b(ich|sagte|heirat|ging|erwisch|buch|stand|sperrte|legte|dann|nach|handy|fremd|ja)\b/i.test(t);
  if (/[—–]/.test(t) && /,/.test(t) && !hasVerb) return true;
  return false;
}

export function stripKeywordListLead(text: string): string {
  return String(text || "")
    .replace(/^((?:[A-ZÄÖÜ0-9][^,:\n/]{1,28}[,/]\s*){2,}[A-ZÄÖÜ0-9][^,:\n/]{1,28})\s*[:–—-]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function countNounHits(text: string, nouns: string[]): number {
  const hay = String(text || "").toLowerCase();
  return nouns.filter((n) => n.length >= 3 && hay.includes(n.toLowerCase())).length;
}

export function extractListingBrief(input: {
  storyTitle?: string | null;
  projectTitle?: string | null;
  topic?: string | null;
  summary?: string | null;
  hook?: string | null;
  genre?: string | null;
  language?: string | null;
}): ListingBrief {
  const language = input.language || "Turkish";
  const storyTitle = String(input.storyTitle || "").replace(/\s+/g, " ").trim();
  const projectTitle = String(input.projectTitle || "").replace(/\s+/g, " ").trim();
  const genreLabel = genreSearchLabel(input.genre, language);
  const topic = String(input.topic || "").trim();
  const shortTopic = topic.length <= 220 ? topic : "";

  const setup = spoilerSafeSetup(
    [input.hook, input.summary, storyTitle, shortTopic, topic.slice(0, 900)],
    480
  );

  const nounSource = [storyTitle, projectTitle, genreLabel, setup].join(" ");
  const nouns = extractListingNouns(nounSource, language);
  if (genreLabel) addUnique(nouns, genreLabel);

  const tagSeeds = [...nouns].filter((t) => !looksLikeDialogueTag(t));
  if (storyTitle && storyTitle.length <= 42 && !looksLikeDialogueTag(storyTitle)) {
    addUnique(tagSeeds, storyTitle);
  }

  return {
    storyTitle,
    projectTitle,
    setup,
    nouns: nouns.slice(0, 10),
    tagSeeds: tagSeeds.slice(0, 12),
    genreLabel,
    language,
  };
}

export function isUsableListingTitle(title: string, brief: ListingBrief): boolean {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (t.length < 12 || t.length > 90) return false;
  if (isKeywordSaladTitle(t) || isStackedKeywordCopy(t)) return false;
  if (/^(yeni video|new video|kurzfilm|drama|youtube)\b/i.test(t)) return false;
  if (brief.nouns.length === 0) return t.length >= 16;
  return countNounHits(t, brief.nouns) >= 1;
}

export function fitListingTitle(title: string): string {
  let t = String(title || "")
    .replace(/\s+/g, " ")
    .replace(/[!?]{2,}/g, "?")
    .replace(/[.]{3,}/g, "…")
    .trim();
  if (t.length > 70) {
    t = t.slice(0, 70).replace(/\s+\S*$/, "").replace(/[-–—,:;]+$/g, "").trim();
  }
  return t;
}

export function ensureTopicInFirst40(title: string, brief: ListingBrief): string {
  const t = fitListingTitle(title);
  if (!brief.nouns.length) return t;
  if (countNounHits(t.slice(0, 40), brief.nouns) >= 1) return t;
  const head = brief.nouns[0];
  const rest = t.replace(/^[:\-–—]\s*/, "");
  return fitListingTitle(`${head} — ${rest}`);
}

export function craftTitleFromBrief(brief: ListingBrief, salt = 0): string {
  const n = brief.nouns;
  const n0 = n[0] || brief.storyTitle || brief.projectTitle || "Kurzfilm";
  const n1 = n[1] || "";
  const n2 = n[2] || "";
  const tag = listingLangTag(brief.language);

  const de = [
    n1 ? `${n1} nach ${n0} — ich sagte einem Fremden Ja` : `${n0} — ich sagte Ja`,
    n1 ? `${n0} auf seinem Handy — dann ${n1}` : `${n0} — ich ging nicht zurück`,
    n2 ? `Nach ${n0} ging ich zum ${n2}` : `${n0} — eine Stunde später`,
    n1 ? `Hotelbuchung ${n0} — dann ${n1}` : `${n0} — die Entscheidung`,
    n2 ? `${n0}: ich heiratete einen Fremden` : `${n0} — ich sagte einem Fremden Ja`,
  ];
  const tr = [
    n1 ? `${n0} — ${n1}${n2 ? `, ${n2}` : ""}` : `${n0} — o karar`,
    n1 ? `${n1}: ${n0} ve bir yabancı` : `${n0} — sonra evet dedim`,
    `${n0} — otel rezervasyonu, sonra nikâh`,
  ];
  const en = [
    n1 ? `${n0} — ${n1}${n2 ? `, ${n2}` : ""}` : `${n0} — the decision`,
    n1 ? `${n1} after ${n0} — I said yes to a stranger` : `${n0} — I said yes`,
    `${n0} — hotel booking, then the registry`,
  ];

  const pack = tag === "de" ? de : tag === "en" ? en : tr;
  const picked = pack[Math.abs(salt) % pack.length] || pack[0];
  return ensureTopicInFirst40(fitListingTitle(picked), brief);
}

export function groundListingTitle(raw: string, brief: ListingBrief): string {
  const cleaned = fitListingTitle(raw);
  if (isUsableListingTitle(cleaned, brief)) return ensureTopicInFirst40(cleaned, brief);

  const fallbacks = [brief.storyTitle, brief.projectTitle, craftTitleFromBrief(brief, 0)];
  for (const f of fallbacks) {
    const g = fitListingTitle(f);
    if (isUsableListingTitle(g, brief)) return ensureTopicInFirst40(g, brief);
  }
  return craftTitleFromBrief(brief, 0);
}

const WEAK_COVER_HOOK =
  /\b(heirate mich|was ist passiert|neler oldu|şimdi ne|bak buna|vay canına|sakın kaçırma|bunu kaçırma|nicht zu fassen|was jetzt|schau genau hin)\b/i;

export function isWeakCoverHook(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && WEAK_COVER_HOOK.test(t)) return true;
  return false;
}

export function fitFlashCover(text: string): string {
  let t = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[!?]{3,}/g, "!")
    .replace(/[.]{3,}/g, "…")
    .trim();
  if (SPOILER_LINE.test(t)) return "";
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 10) t = words.slice(0, 10).join(" ");
  if (t.length > 56) t = t.slice(0, 56).replace(/\s+\S*$/, "").replace(/[-–—,:;]+$/g, "").trim();
  if (t.split(/\s+/).filter(Boolean).length < 3 || t.length < 14) return "";
  return t;
}

/** Kapak: flaş / sok baslik — resmi gorunce "neymis bu?" densin. */
export function craftFlashCoverHeadlines(brief: ListingBrief, count = 5): string[] {
  const n = brief.nouns;
  const n0 = n[0] || "";
  const n1 = n[1] || "";
  const blob = `${brief.setup} ${n.join(" ")} ${brief.genreLabel}`.toLowerCase();
  const tag = listingLangTag(brief.language);
  const hotel = /suite|handy|hotel|reserv|telefon|sekretär|sekreter/i.test(blob);
  const wedding = /blitz|standesamt|heirat|nikah|yıldırım|yildirim|fremd/i.test(blob);
  const boss = /chef|firma|holding|patron|ceo/i.test(blob);

  const de: string[] = [
    hotel && n0 ? `${n0} — auf seinem Handy` : "",
    hotel ? "Handy auf. Sie sah alles." : "",
    hotel && n0 ? `Er buchte ${n0}` : "",
    wedding ? "Ich heiratete einen Fremden" : "",
    wedding && n0 ? `${n0}. Dann sagte ich Ja.` : "",
    n0 && n1 ? `${n0} — dann ${n1}` : "",
    boss && n0 ? `${n0}: wer lügt hier?` : "",
    "Eine Stunde später war nichts mehr wahr",
    n0 ? `${n0}. Kein Zurück.` : "Kein Zurück. Nicht mehr.",
  ];
  const tr: string[] = [
    hotel && n0 ? `${n0} — telefonunda yazıyordu` : "",
    hotel ? "Telefonu açtı. Her şey bitti." : "",
    wedding ? "Yabancıya evet dedim. O gece." : "",
    wedding && n0 ? `${n0}. Sonra evet.` : "",
    n0 && n1 ? `${n0} — sonra ${n1}` : "",
    boss && n0 ? `${n0}: kim yalan söylüyor?` : "",
    "Bunu görünce donacaksın",
    n0 ? `${n0}. Geri yok.` : "O gece her şey bitti.",
  ];
  const en: string[] = [
    hotel && n0 ? `${n0} — on his phone` : "",
    hotel ? "She opened the phone. It was over." : "",
    wedding ? "I married a stranger that night" : "",
    n0 && n1 ? `${n0} — then ${n1}` : "",
    "One hour later nothing was true",
    n0 ? `${n0}. No going back.` : "No going back.",
  ];

  const pack = tag === "de" ? de : tag === "en" ? en : tr;
  const out: string[] = [];
  for (const raw of pack) {
    const fitted = fitFlashCover(raw);
    if (fitted && !out.some((x) => x.toLowerCase() === fitted.toLowerCase())) out.push(fitted);
    if (out.length >= count) break;
  }
  return out;
}

export function watchCloser(language?: string | null): string {
  const tag = listingLangTag(language);
  if (tag === "de") return "Was danach geschah, siehst du im Film.";
  if (tag === "en") return "What happens next is in the film.";
  return "Devamı filmde; izleyince anlarsın.";
}

export function curiosityFallback(input: {
  title?: string;
  language?: string | null;
  setup?: string;
  nouns?: string[];
}): string {
  const setupHead = splitListingSentences(input.setup || "")[0] || "";
  if (setupHead.length >= 20) {
    const head = setupHead.length > 180 ? `${setupHead.slice(0, 170).replace(/\s+\S*$/, "").trim()}…` : setupHead;
    return `${head} ${watchCloser(input.language)}`.replace(/\s+/g, " ").trim();
  }
  const hook = String(input.title || "").replace(/[.!?…]+$/g, "").trim() || (input.nouns?.[0] ?? "");
  const tag = listingLangTag(input.language);
  if (tag === "de") {
    return `${hook}: eine Entscheidung, die man nicht zurücknimmt. ${watchCloser("German")}`;
  }
  if (tag === "en") {
    return `${hook}: one decision changes the room. ${watchCloser("English")}`;
  }
  return `${hook} — bir an, sonra her şey değişiyor. Ne olduğunu söylemiyoruz. İzle, gör.`;
}

export function stripGenericAtmosphere(text: string): string {
  return String(text || "")
    .replace(GENERIC_ATMOSPHERE, " ")
    .replace(/#\S+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/^[,.;:\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function first150HasNoun(text: string, nouns: string[]): boolean {
  return countNounHits(text.slice(0, 150), nouns) >= 1;
}

export function craftListingDescription(brief: ListingBrief): string {
  const sentences = splitListingSentences(brief.setup).slice(0, 2);
  const body = sentences.join(" ").replace(/\s+/g, " ").trim();
  if (body.length >= 40) return `${body} ${watchCloser(brief.language)}`.replace(/\s+/g, " ").trim();
  return curiosityFallback({
    title: brief.storyTitle || brief.projectTitle,
    language: brief.language,
    setup: brief.setup,
    nouns: brief.nouns,
  });
}

export function groundListingBody(raw: string, brief: ListingBrief): string {
  const cleaned = stripKeywordListLead(stripSpoilerSentences(raw));
  const storySentences = splitListingSentences(cleaned)
    .map((s) => stripGenericAtmosphere(s))
    .filter((s) => s.length >= 16 && !isStackedKeywordCopy(s) && countNounHits(s, brief.nouns) >= 1);

  let text = storySentences.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();
  if (isStackedKeywordCopy(text) || text.length < 40 || countNounHits(text, brief.nouns) < 2) {
    text = craftListingDescription(brief);
  }
  if (!first150HasNoun(text, brief.nouns) && brief.setup) {
    text = craftListingDescription(brief);
  }
  return text.replace(/\s+/g, " ").trim();
}

export function storyLockedSearchPhrase(raw: string, brief: ListingBrief): string {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  const fromNouns = brief.nouns.slice(0, 4).join(" ");
  if (!t || isKeywordSaladTitle(t) || isStackedKeywordCopy(t)) return fromNouns;
  const words = t.split(/\s+/).filter((w) => w.length >= 4);
  const extra = words.filter(
    (w) => !brief.nouns.some((n) => n.toLowerCase().includes(w.toLowerCase()) || w.toLowerCase().includes(n.toLowerCase()))
  );
  if (extra.length > 0) return fromNouns;
  return t;
}

export function listingPromptBlock(brief: ListingBrief): string {
  return [
    "LISTELEME KILIDI — BU FILMIN KURULUMU (spoiler yok):",
    brief.setup || "(kurulum yok)",
    "",
    `FILM BASLIGI: ${brief.storyTitle || brief.projectTitle || "-"}`,
    `ARAMA ISKELETI (basligin ILK 40 karakterinde bunlardan en az biri): ${brief.nouns.join(", ") || "-"}`,
    `TUR ARAMA: ${brief.genreLabel || "-"}`,
    "",
    "ZORUNLU:",
    "- Baslik BU hikayeyi bir CUMLE ile anlatsin. Slash/virgül yigini YASAK: \"Suite 908 / Blitzhochzeit / Hotel-Affäre\".",
    "- Jenerik kova kelime YASAK (Firma/Ehe/Geheimnis/Chef/Hotel-Affäre) — yalnizca bu filmde gercekten varsa.",
    "- Aciklama dogal kurulum cumlesi. \"Suite 908, Blitzhochzeit, Standesamt:\" yigini YASAK. Bos atmosfer (\"Kalte Luft\", \"ein Schritt, der atmet\") YASAK.",
    "- Sonu / CEO / USB / ifşa / \"ich blieb\" YASAK.",
    "- Etiketler kisa arama ifadesi (2-5 kelime). Diyalog cumlesi yapistirma.",
  ].join("\n");
}

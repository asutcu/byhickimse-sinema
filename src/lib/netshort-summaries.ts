/**
 * NetShort ozet bankasi — kalici kayit (sohbet hafizasi DEGIL).
 * Dosya: src/data/netshort-summaries.json
 * Kullanim: hikaye + sahne uretirken duygu/dusunce/beat ruhunu al; baslik/isim CALMA.
 */

import bankJson from "@/data/netshort-summaries.json";

export type NetShortSummaryEntry = {
  title: string;
  genres: string[];
  summary: string;
  url?: string;
  episodes?: number | null;
  emotions: string[];
  thoughts: string[];
  beats: string[];
  source?: string;
};

type BankFile = {
  version: number;
  updatedAt: string;
  note: string;
  count: number;
  entries: NetShortSummaryEntry[];
};

const bank = bankJson as BankFile;

export function listNetShortSummaries(): NetShortSummaryEntry[] {
  return bank.entries || [];
}

export function netShortSummaryCount(): number {
  return bank.entries?.length || 0;
}

/** Rastgele N ozet (uretim cesitliligi). */
export function sampleNetShortSummaries(n = 3): NetShortSummaryEntry[] {
  const list = [...(bank.entries || [])];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, Math.max(1, Math.min(n, list.length)));
}

/** Tur etiketine yakin ozetler. */
export function summariesMatchingGenres(genreHints: string[], n = 3): NetShortSummaryEntry[] {
  const hints = genreHints.map((g) => g.toLowerCase());
  const scored = (bank.entries || [])
    .map((e) => {
      const tags = (e.genres || []).map((g) => g.toLowerCase());
      const hit = hints.reduce((acc, h) => acc + (tags.some((t) => t.includes(h) || h.includes(t)) ? 1 : 0), 0);
      return { e, hit };
    })
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit);
  const picked = scored.slice(0, Math.max(n * 2, n)).map((x) => x.e);
  if (picked.length >= n) return picked.slice(0, n);
  return [...picked, ...sampleNetShortSummaries(n - picked.length)];
}

/**
 * Hikaye/sahne promptuna yapisan ozet ruhu blogu.
 * Isimleri ornek olarak gosterir ama CALMA diye kilitler.
 */
export function netShortSummaryPromptBlock(options?: { genreHints?: string[]; samples?: number }): string {
  const samples = options?.samples ?? 3;
  const picks = options?.genreHints?.length
    ? summariesMatchingGenres(options.genreHints, samples)
    : sampleNetShortSummaries(samples);

  if (picks.length === 0) {
    return "NETSHORT OZET BANKASI: henuz kayit yok — klasik merdiven kullan (asagilanma → sakin karar → donus → pismanlik).";
  }

  const lines = picks.map((p, i) => {
    return [
      `(${i + 1}) Turler: ${(p.genres || []).join(", ") || "—"}`,
      `Duygular: ${(p.emotions || []).join("; ")}`,
      `Dusunce ruhu: ${(p.thoughts || []).join(" / ")}`,
      `Sahne darbeleri: ${(p.beats || []).join(" → ")}`,
      `Ozet ruhu (yeniden yaz, isim/baslik CALMA): ${p.summary}`,
    ].join("\n");
  });

  return [
    `NETSHORT OZET BANKASI (${bank.count} kayit — ornek ${picks.length} adet; isim/baslik/ozet metnini CALMA, duygu+dusunce+beat ruhunu YAZ):`,
    ...lines,
    "URET: kendi karakterlerin + kendi olaylarin; ayni merdiven ve duygusal sicaklik.",
  ].join("\n");
}

/** Film plani icin kisa beat listesi. */
export function netShortBeatsPromptBlock(n = 8): string {
  const beats = new Set<string>();
  for (const e of sampleNetShortSummaries(12)) {
    for (const b of e.beats || []) beats.add(b);
    if (beats.size >= n) break;
  }
  return `NETSHORT SAHNE DARBELERI (ozetlerden): ${[...beats].slice(0, n).join(" | ")} | etki→tepki | 1-2 yuz | match-on-action`;
}

/**
 * Gorsel / Flow uretimi: ozet bankasindaki duygular yuz+beden+atmosfere gececek.
 * Film plani + prompt-builder HARD_EMOTION / PERFORMANCE icin.
 */
export function netShortEmotionsVisualLock(samples = 6): string {
  const picks = sampleNetShortSummaries(samples);
  const emotions = new Set<string>();
  const thoughts = new Set<string>();
  for (const p of picks) {
    for (const e of p.emotions || []) emotions.add(e);
    for (const t of p.thoughts || []) thoughts.add(t);
  }
  const emoList = [...emotions].slice(0, 10);
  const thoughtList = [...thoughts].slice(0, 6);
  return [
    "NETSHORT DUYGU → GORSEL (zorunlu — yalnizca hikaye metni degil, KAREDE gorunsun):",
    emoList.length ? `Duygu paleti (ozet bankasi): ${emoList.join("; ")}.` : "",
    thoughtList.length
      ? `Ic ses ruhu (yuzde oyna, altyazi yazma): ${thoughtList.join(" / ")}.`
      : "",
    "INGILIZCE oyunculuk karsiliklari: cold resolve, bitter controlled smile, humiliation lowered gaze then lift, status-flip walk-in, regret crack on the betrayer's face, turning away in quiet victory, luxury-vs-empty contrast.",
    "emotion alani konusma dilinde NetShort etiketi olsun (Turkce filmde Turkce, Almanca filmde Almanca). 'biraz uzgun' / notr YASAK.",
    "performance alani bu duyguyu BEDENDE yazsin (eyes, jaw, breath, hands, distance). Surekli bagirma yuzu YASAK.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Flow prompt icine kisa Ingilizce duygu kilidi (emotionLabel varsa onu da tasir). */
export function netShortFlowEmotionCue(emotionLabel?: string | null): string {
  const label = emotionLabel?.replace(/\s+/g, " ").trim();
  const base =
    "NETSHORT VISUAL EMOTION: play short-drama POWER — humiliation crush, look-down dominance, status superiority, cold revenge, bitter control. Occasional slap/shove/slammed door OK. Not soft melancholy postcard. Not endless shouting montage. NO blood/weapons/killing.";
  if (!label) return base;
  return `${base} This take's emotion beat: "${label}" — translate into visible acting (eyes/jaw/breath/distance/power pose), never as on-screen text.`;
}

/** Kadro adi ↔ klip metni eslesmesi (istemci + sunucu ortak). */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function textMentionsCastName(text: string, name: string): boolean {
  const hay = text.replace(/\s+/g, " ");
  const n = name.replace(/\s+/g, " ").trim();
  if (n.length < 2) return false;
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(n)}(?:$|[^\\p{L}\\p{N}])`, "iu");
  return re.test(hay);
}

export function resolveCastMemberByName<T extends { name: string }>(
  rawName: string | null | undefined,
  members: T[]
): T | undefined {
  const name = rawName?.replace(/\s+/g, " ").trim().toLowerCase();
  if (!name) return undefined;
  const exact = members.find((m) => m.name.trim().toLowerCase() === name);
  if (exact) return exact;
  const contains = members.filter((m) => {
    const n = m.name.trim().toLowerCase();
    return n.includes(name) || name.includes(n);
  });
  return contains.length === 1 ? contains[0] : undefined;
}

export function findCastInText<T extends { name: string }>(
  text: string,
  members: T[],
  primary?: T | null
): T[] {
  const hay = text || "";
  const found: T[] = [];
  const push = (m: T | undefined) => {
    if (!m || found.some((x) => x.name === m.name)) return;
    found.push(m);
  };
  push(primary ?? undefined);
  const ranked = [...members].sort((a, b) => b.name.length - a.name.length);
  for (const m of ranked) {
    const n = m.name.trim();
    if (n.length < 2) continue;
    if (textMentionsCastName(hay, n)) {
      push(m);
      continue;
    }
    const first = n.split(/\s+/)[0] || "";
    if (first.length < 3 || !textMentionsCastName(hay, first)) continue;
    const sameFirst = members.filter((x) => x.name.trim().split(/\s+/)[0]?.toLowerCase() === first.toLowerCase());
    if (sameFirst.length === 1) push(m);
  }
  return found;
}

function firstMentionIndex(hay: string, needle: string): number {
  const n = needle.replace(/\s+/g, " ").trim();
  if (n.length < 2) return -1;
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(n)}(?:$|[^\\p{L}\\p{N}])`, "iu");
  const m = re.exec(hay.replace(/\s+/g, " "));
  return m ? m.index : -1;
}

/** Hikaye anında (klip VO) adı veya tekil rolü geçen kadro — rastgele degil, metin sirasi. */
export function findCastInStoryBeat<T extends { name: string; storyRole?: string | null }>(
  beatText: string,
  members: T[]
): T[] {
  const hay = beatText || "";
  const named = findCastInText(hay, members);
  const found: T[] = [...named];
  const ranked = [...members].sort((a, b) => (b.storyRole || "").length - (a.storyRole || "").length);
  for (const m of ranked) {
    if (found.some((x) => x.name === m.name)) continue;
    const role = (m.storyRole || "").replace(/\s+/g, " ").trim();
    if (role.length < 4 || !textMentionsCastName(hay, role)) continue;
    const sameRole = members.filter(
      (x) => (x.storyRole || "").replace(/\s+/g, " ").trim().toLowerCase() === role.toLowerCase()
    );
    if (sameRole.length === 1) found.push(m);
  }
  const idx = (m: T) => {
    const n = m.name.trim();
    const first = n.split(/\s+/)[0] || "";
    const role = (m.storyRole || "").trim();
    const positions = [firstMentionIndex(hay, n), firstMentionIndex(hay, first), role ? firstMentionIndex(hay, role) : -1].filter(
      (i) => i >= 0
    );
    return positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
  };
  return found.sort((a, b) => idx(a) - idx(b));
}

/** Zamir / "o" devamı: bu cümlede isim yok ama önceki anda kim varsa o. */
const STORY_BEAT_PRONOUN =
  /(?:^|[^\p{L}\p{N}])(o|onu|ona|onun|ondan|kendisi|kendisini|kendine)(?:$|[^\p{L}\p{N}])/iu;

/** Bir klip VO'sunda kadrajdaki isimli yuz ust siniri (hikayede kac kisi geciyorsa, en fazla bu). */
export const MAX_ON_SCREEN_CAST = 4;

/**
 * Bu klipte kadrajda kim olmalı: o anın hikaye metninde adı geçenler — kac kisiyse (max 4).
 * Plan / sıra / rastgele atama yok.
 */
export function onScreenCastForClipBeat<T extends { name: string; storyRole?: string | null }>(
  beatText: string,
  members: T[],
  previousBeatText?: string
): T[] {
  const here = findCastInStoryBeat(beatText, members);
  if (here.length > 0) return here.slice(0, MAX_ON_SCREEN_CAST);
  const prev = previousBeatText ? findCastInStoryBeat(previousBeatText, members) : [];
  if (prev.length > 0 && STORY_BEAT_PRONOUN.test((beatText || "").replace(/\s+/g, " "))) {
    return prev.slice(0, MAX_ON_SCREEN_CAST);
  }
  return [];
}

export function clipReferencesCastMember(
  clip: {
    characterId?: string | null;
    sceneDescription?: string | null;
    dialogue?: string | null;
    imagePrompt?: string | null;
  },
  member: { id: string; name: string }
): boolean {
  if (clip.characterId === member.id) return true;
  return findCastInText(
    `${clip.sceneDescription || ""}\n${clip.dialogue || ""}\n${clip.imagePrompt || ""}`,
    [member]
  ).length > 0;
}

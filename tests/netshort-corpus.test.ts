import { describe, expect, it } from "vitest";
import { NETSHORT_TROPES, NETSHORT_EMOTIONS, NETSHORT_CORPUS_STORY_LOCK } from "@/lib/netshort-corpus";
import { narratorGenreStoryBlock } from "@/lib/narrator-genres";

describe("NetShort corpus", () => {
  it("en az 40 trop ve duygu paleti tasir", () => {
    expect(NETSHORT_TROPES.length).toBeGreaterThanOrEqual(40);
    expect(NETSHORT_EMOTIONS.length).toBeGreaterThanOrEqual(8);
    expect(NETSHORT_CORPUS_STORY_LOCK).toContain("TROP BANKASI");
    expect(NETSHORT_CORPUS_STORY_LOCK).toMatch(/18|yas alti/i);
  });

  it("aldatma tur kilidine corpus ve gorsel darbe gomulur", () => {
    const block = narratorGenreStoryBlock("aldatma");
    expect(block).toContain("NETSHORT CORPUS DNA");
    expect(block).toContain("CORPUS GORSEL DARBELER");
    expect(block).toContain("sakin yikici");
  });
});

import { describe, expect, it } from "vitest";
import {
  listNetShortSummaries,
  netShortSummaryCount,
  netShortSummaryPromptBlock,
} from "@/lib/netshort-summaries";
import { narratorGenreStoryBlock } from "@/lib/narrator-genres";

describe("NetShort ozet bankasi", () => {
  it("en az 100 ozet kaydi tasir", () => {
    expect(netShortSummaryCount()).toBeGreaterThanOrEqual(100);
    expect(listNetShortSummaries().length).toBe(netShortSummaryCount());
  });

  it("Unutulan Oz Kiz ozeti duygularla kayitli", () => {
    const hit = listNetShortSummaries().find((e) => /unutulan öz kız/i.test(e.title));
    expect(hit).toBeTruthy();
    expect(hit!.summary).toMatch(/Ethan Carter|Emily|zaman 5 yıl/i);
    expect(hit!.emotions.length).toBeGreaterThan(0);
    expect(hit!.thoughts.length).toBeGreaterThan(0);
    expect(hit!.beats.length).toBeGreaterThan(0);
  });

  it("hikaye kilidine ozet bankasi ornekleri girer", () => {
    const block = narratorGenreStoryBlock("aldatma");
    expect(block).toContain("NETSHORT OZET BANKASI");
    expect(block).toContain("isim/baslik");
    expect(netShortSummaryPromptBlock({ samples: 2 })).toContain("Ozet ruhu");
  });
});

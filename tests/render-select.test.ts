import { describe, expect, it } from "vitest";
import { clipFileName, clipFrameFileName } from "@/server/lib/paths";
import { clipDialoguesForRender, selectClipsForRender } from "@/server/services/render";

describe("clipFileName", () => {
  it("index + clipId ile carpismasiz ad uretir", () => {
    expect(clipFileName(1, "clxyz123456789")).toMatch(/^001-[a-zA-Z0-9]+\.mp4$/);
    expect(clipFileName(1, "aaa")).not.toBe(clipFileName(1, "bbb"));
    expect(clipFileName(12)).toBe("012.mp4");
  });

  it("frame adi da id tasir", () => {
    expect(clipFrameFileName(3, "idABCDEF1234", "last")).toMatch(/^003-.*-last\.png$/);
  });
});

describe("selectClipsForRender", () => {
  it("videosu olanlari sirayla alir, olmayanlari atlar", () => {
    // Gercek dosya yok — existsSync false → hepsi atlanir; mantigi unit olarak yollarla test etmek zor.
    // Bos videoPath atlanir:
    const { included, skipped } = selectClipsForRender([
      { index: 1, status: "draft", videoPath: null },
      { index: 2, status: "completed", videoPath: null },
    ]);
    expect(included).toHaveLength(0);
    expect(skipped.map((s) => s.index)).toEqual([1, 2]);
  });

  it("gomulu altyazi icin konusma metnini final sirasina dizer", () => {
    const dialogues = clipDialoguesForRender(
      [{ index: 2 }, { index: 4 }],
      [
        { index: 1, dialogue: "Ilk cumle." },
        { index: 2, dialogue: "  Ikinci sahne.  " },
        { index: 3, dialogue: "Atlanan." },
        { index: 4, dialogue: "Son soz." },
      ]
    );
    expect(dialogues).toEqual(["Ikinci sahne.", "Son soz."]);
  });
});

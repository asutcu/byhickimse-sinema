import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bufferLooksLikeCharacterSheet, bufferLooksLikeStorySlide } from "@/lib/still-sheet-detect";
import { decodePngRgba } from "@/lib/png-rgba";

describe("turnaround sheet tespiti", () => {
  it("kaydedilen sahte Flow karesini sheet olarak tanir", () => {
    const p = path.join("tests", "fixtures", "turnaround-still.png");
    if (!fs.existsSync(p)) return;
    const buf = fs.readFileSync(p);
    const decoded = decodePngRgba(buf);
    expect(decoded?.width).toBeGreaterThan(1000);
    expect(bufferLooksLikeCharacterSheet(buf)).toBe(true);
  });

  it("gri stüdyo MCU katalog karesini sheet olarak tanir", () => {
    const p = path.join("tests", "fixtures", "mcu-catalog-still.png");
    if (!fs.existsSync(p)) return;
    const buf = fs.readFileSync(p);
    expect(bufferLooksLikeCharacterSheet(buf)).toBe(true);
  });

  it("4:3 yuz karesini 16:9 slayt saymaz", () => {
    const p = path.join("tests", "fixtures", "id-headshot-still.png");
    if (!fs.existsSync(p)) return;
    const buf = fs.readFileSync(p);
    expect(bufferLooksLikeStorySlide(buf)).toBe(false);
  });
});

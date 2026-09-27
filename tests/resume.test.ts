import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickNextClipIndex, retryStrategyForAttempt, isValidClipTransition } from "@/server/automation/state-machine";

describe("Yeniden baslatinca kaldigi yerden devam", () => {
  it("tamamlanmis klipleri atlayip ilk eksik klibi bulur", () => {
    const clips = [
      { index: 1, status: "completed" },
      { index: 2, status: "completed" },
      { index: 3, status: "pending" },
      { index: 4, status: "draft" },
    ];
    expect(pickNextClipIndex(clips)).toBe(3);
  });

  it("siralama karisik gelse bile index sirasina gore ilerler", () => {
    const clips = [
      { index: 3, status: "pending" },
      { index: 1, status: "completed" },
      { index: 2, status: "failed" },
    ];
    expect(pickNextClipIndex(clips)).toBe(2);
  });

  it("hepsi tamamlandiysa null doner", () => {
    expect(
      pickNextClipIndex([
        { index: 1, status: "completed" },
        { index: 2, status: "completed" },
      ])
    ).toBeNull();
  });
});

describe("Yeniden deneme merdiveni", () => {
  it("deneme sirasina gore strateji secer", () => {
    expect(retryStrategyForAttempt(1, 3)).toBe("same_prompt");
    expect(retryStrategyForAttempt(2, 3)).toBe("reload_page");
    expect(retryStrategyForAttempt(3, 3)).toBe("reopen_project");
    expect(retryStrategyForAttempt(4, 3)).toBe("manual");
  });

  it("maxRetries ayarina saygi duyar", () => {
    expect(retryStrategyForAttempt(5, 5)).toBe("reopen_project");
    expect(retryStrategyForAttempt(6, 5)).toBe("manual");
  });
});

describe("Politika bonusu sert tavanda durur ve klip atlanir", () => {
  const source = readFileSync(
    new URL("../src/server/automation/engine.ts", import.meta.url),
    "utf8"
  );

  it("toplam deneme tavani 4", () => {
    expect(source).toMatch(/const CLIP_ATTEMPT_HARD_CAP = 4;/);
  });

  it("politika bekleyen klip yalnizca tavana kadar bypass edilir", () => {
    expect(source).toContain(
      'if (strategy === "manual" && (!policyRetryPending || attempt > CLIP_ATTEMPT_HARD_CAP))'
    );
  });

  it("tavana takilan klip isi durdurmaz, kuyruk ilerler", () => {
    // "skipped" duraklatma dalinda DEGIL, bekleme/ilerleme dalinda islenir.
    expect(source).toContain('if (result === "completed" || result === "failed" || result === "skipped")');
    expect(source).toMatch(/return "skipped";/);
    const pauseBranch = source.slice(source.indexOf('if (result === "manual")'));
    expect(pauseBranch.slice(0, 400)).not.toContain("skipped");
  });
});

describe("Durum makinesi gecisleri", () => {
  it("gecerli gecislere izin verir", () => {
    expect(isValidClipTransition("preparing", "opening_flow")).toBe(true);
    expect(isValidClipTransition("downloading", "validating_download")).toBe(true);
    expect(isValidClipTransition("failed", "retrying")).toBe(true);
  });

  it("gecersiz gecisleri reddeder", () => {
    expect(isValidClipTransition("completed", "generating")).toBe(false);
    expect(isValidClipTransition("draft", "downloading")).toBe(false);
  });

  it("ayni duruma gecis her zaman gecerlidir", () => {
    expect(isValidClipTransition("generating", "generating")).toBe(true);
  });
});

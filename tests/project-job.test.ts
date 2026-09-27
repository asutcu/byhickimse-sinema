import { describe, expect, it } from "vitest";
import { ProjectJobBusyError, runExclusiveProjectJob } from "@/server/lib/project-job";

describe("Proje is kilidi", () => {
  it("ayni split istegini birlestirir, ikinci cagri ayni sonucu alir", async () => {
    let calls = 0;
    let release!: (value: string) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const work = async () => {
      calls += 1;
      markStarted();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    const first = runExclusiveProjectJob("p-coalesce", "split", work);
    await started;
    const second = runExclusiveProjectJob("p-coalesce", "split", async () => "nope");
    release("ok");
    await expect(first).resolves.toBe("ok");
    await expect(second).resolves.toBe("ok");
    expect(calls).toBe(1);
  });

  it("split bitince bekleyen film plani calisir", async () => {
    let release!: (value: string) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const split = runExclusiveProjectJob("p-wait", "split", async () => {
      markStarted();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    await started;
    const plan = runExclusiveProjectJob("p-wait", "film-plan", async () => "plan");
    release("clips");
    await expect(split).resolves.toBe("clips");
    await expect(plan).resolves.toBe("plan");
  });

  it("film plani calisirken split reddedilir", async () => {
    let release!: (value: string) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const first = runExclusiveProjectJob("p-busy", "film-plan", async () => {
      markStarted();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    await started;
    await expect(runExclusiveProjectJob("p-busy", "split", async () => "nope")).rejects.toBeInstanceOf(
      ProjectJobBusyError
    );
    release("ok");
    await expect(first).resolves.toBe("ok");
  });

  it("farkli projeleri kilitlemez", async () => {
    const [a, b] = await Promise.all([
      runExclusiveProjectJob("a", "film-plan", async () => 1),
      runExclusiveProjectJob("b", "film-plan", async () => 2),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});

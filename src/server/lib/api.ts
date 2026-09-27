import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/server/lib/logger";
import { maskSecrets } from "@/server/lib/mask";
import { ProjectJobBusyError } from "@/server/lib/project-job";

/**
 * API yardimcilari: tutarli hata bicimi + gizli bilgi maskeleme.
 * Ham stack trace kullaniciya donmez; loglara yazilir.
 */

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

/** Prisma / Turbopack dökümünü toast'a taşıma. */
export function publicApiErrorMessage(raw: string): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (/Unknown argument `flowImageModel`/i.test(text) || /Unknown argument `/i.test(text)) {
    return "Kayit sirasinda alan uyusmazligi oldu. Sayfayi yenileyip tekrar deneyin.";
  }
  if (/Invalid `.*prisma|__TURBOPACK__imported__module__/i.test(text)) {
    return "Kayit basarisiz. Sayfayi yenileyip tekrar deneyin.";
  }
  if (text.length > 180) return `${text.slice(0, 160).trim()}…`;
  return text || "Islem basarisiz";
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: maskSecrets(message) }, { status });
}

/**
 * Kayit bulunamadi hatasi mi?
 * Prisma `findUniqueOrThrow` / `update` cagrilari silinmis kayitta P2025 firlatir.
 * Bu bir sunucu hatasi DEGIL — 404 olarak donmeli (or. silinmis bir projenin linki).
 */
function isBusyConflict(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "FlowCharacterBusyError" ||
    err.name === "FlowImageBusyError" ||
    err.name === "AutomationBusyError"
  );
}

function isRecordNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025";
}

/** Route handler sarmalayici: hatalari yakalar, loglar, guvenli mesaj doner. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const data = await fn();
    return ok(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return fail(`Gecersiz istek: ${message}`, 422);
    }
    if (err instanceof ProjectJobBusyError || isBusyConflict(err)) {
      return fail(err instanceof Error ? err.message : String(err), 409);
    }
    if (isRecordNotFound(err)) {
      return fail("Kayit bulunamadi (silinmis veya adres gecersiz)", 404);
    }
    const raw = err instanceof Error ? err.message : String(err);
    logger.error({ err }, `API hatasi: ${raw}`);
    return fail(publicApiErrorMessage(raw), 500);
  }
}

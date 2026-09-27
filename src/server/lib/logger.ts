import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { LOGS_ROOT } from "@/server/lib/paths";
import { maskObject, maskSecrets } from "@/server/lib/mask";
import { prisma } from "@/server/db";
import { publishEvent } from "@/server/lib/events";

/**
 * Uygulama loglayicisi:
 * - Dosyaya yazar (logs/app.log)
 * - Otomasyon olaylarini veritabanina (AutomationEvent) kaydeder
 * - SSE veriyoluna yayinlar (panelde canli goruntuleme)
 * - Tum mesaj ve detaylar maskelenir
 */

const globalForLogger = globalThis as unknown as { pinoLogger?: pino.Logger };

function createPino(): pino.Logger {
  if (!fs.existsSync(LOGS_ROOT)) fs.mkdirSync(LOGS_ROOT, { recursive: true });
  const destination = pino.destination({
    dest: path.join(LOGS_ROOT, "app.log"),
    sync: false,
    mkdir: true,
  });
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "debug",
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      hooks: {
        logMethod(args, method) {
          const masked = args.map((a) => (typeof a === "string" ? maskSecrets(a) : maskObject(a)));
          method.apply(this, masked as Parameters<typeof method>);
        },
      },
    },
    destination
  );
}

export const logger: pino.Logger = globalForLogger.pinoLogger ?? createPino();
if (process.env.NODE_ENV !== "production") {
  globalForLogger.pinoLogger = logger;
}

export type EventLevel = "debug" | "info" | "warning" | "error";

export interface AutomationEventInput {
  projectId?: string | null;
  clipId?: string | null;
  jobId?: string | null;
  level?: EventLevel;
  step?: string;
  message: string;
  detail?: unknown;
  screenshotPath?: string | null;
  pageUrl?: string | null;
  attempt?: number;
}

/**
 * Otomasyon olayini uc kanala birden isler: dosya logu, DB, SSE.
 * DB yazimi basarisiz olsa bile dosya logu calismaya devam eder.
 */
export async function recordEvent(input: AutomationEventInput): Promise<void> {
  const level = input.level ?? "info";
  const message = maskSecrets(input.message);
  const detailString =
    input.detail === undefined ? null : maskSecrets(typeof input.detail === "string" ? input.detail : JSON.stringify(input.detail));

  const logPayload = {
    projectId: input.projectId,
    clipId: input.clipId,
    jobId: input.jobId,
    step: input.step,
    detail: detailString ?? undefined,
    attempt: input.attempt,
  };
  if (level === "error") logger.error(logPayload, message);
  else if (level === "warning") logger.warn(logPayload, message);
  else if (level === "debug") logger.debug(logPayload, message);
  else logger.info(logPayload, message);

  try {
    const event = await prisma.automationEvent.create({
      data: {
        projectId: input.projectId ?? null,
        clipId: input.clipId ?? null,
        jobId: input.jobId ?? null,
        level,
        step: input.step ?? "",
        message,
        detail: detailString,
        screenshotPath: input.screenshotPath ?? null,
        pageUrl: input.pageUrl ? maskSecrets(input.pageUrl) : null,
        attempt: input.attempt ?? 0,
      },
    });
    publishEvent(input.projectId ?? null, {
      type: "event",
      payload: {
        id: event.id,
        projectId: event.projectId,
        clipId: event.clipId,
        jobId: event.jobId,
        level: event.level,
        step: event.step,
        message: event.message,
        detail: event.detail,
        screenshotPath: event.screenshotPath,
        pageUrl: event.pageUrl,
        attempt: event.attempt,
        createdAt: event.createdAt.toISOString(),
      },
    });
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    // Proje/klip silindiginde FK hatasi beklenen bir durum; hata seviyesinde spam yapma
    if (code === "P2003" || code === "P2025") {
      logger.warn({ err, projectId: input.projectId }, "Otomasyon olayi atlandi (kayit silinmis olabilir)");
    } else {
      logger.error({ err }, "Otomasyon olayi veritabanina yazilamadi");
    }
  }
}

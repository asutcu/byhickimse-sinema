import fs from "node:fs";
import OpenAI from "openai";
import { z } from "zod";
import { resolveOpenAiKey, getSettings } from "@/server/services/settings";
import { logger } from "@/server/lib/logger";

/**
 * OpenAI erisim katmani.
 * - Anahtar yalnizca sunucu tarafinda cozulur
 * - Yapilandirilmis JSON ciktilar Responses API + json_schema ile alinir
 * - Zod ile dogrulanir; bozuk cikti gelirse bir kez yeniden denenir
 */

export class OpenAiKeyMissingError extends Error {
  constructor() {
    super("OpenAI API anahtari ayarlanmamis. Ayarlar ekranindan anahtari girin.");
    this.name = "OpenAiKeyMissingError";
  }
}

export async function getOpenAiClient(): Promise<OpenAI> {
  const key = await resolveOpenAiKey();
  if (!key) throw new OpenAiKeyMissingError();
  return new OpenAI({ apiKey: key });
}

async function getClient(): Promise<OpenAI> {
  return getOpenAiClient();
}

/** Anahtar ve model ile kucuk bir baglanti testi yapar. */
export async function testOpenAiConnection(): Promise<{ ok: boolean; model: string; message: string }> {
  const settings = await getSettings();
  try {
    const client = await getClient();
    const response = await client.responses.create({
      model: settings.openaiModel,
      input: "Yanit olarak yalnizca OK yaz.",
      max_output_tokens: 16,
    });
    const text = (response.output_text ?? "").trim();
    return { ok: true, model: settings.openaiModel, message: `Baglanti basarili (${text.slice(0, 20) || "yanit alindi"})` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, model: settings.openaiModel, message };
  }
}

export interface StructuredCallOptions<T> {
  system: string;
  user: string;
  schemaName: string;
  /** OpenAI json_schema bicimi (strict) */
  jsonSchema: Record<string, unknown>;
  /** Sunucu tarafi dogrulama. Girdi tipi serbest: varsayilanli (.default) alanlar da kabul edilir. */
  zodSchema: z.ZodType<T, z.ZodTypeDef, unknown>;
  model?: string;
  maxOutputTokens?: number;
  /**
   * Akil yurutme derinligi (yalnizca gpt-5 / o-serisi).
   * "low" belirgin sekilde hizlidir; cok parcali yapilandirilmis ciktilarda
   * ("medium") tutarlilik artar.
   */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Istek zaman asimi; asilirsa anlasilir bir hata doner (varsayilan 4 dk). */
  timeoutMs?: number;
  /** Model cevaplamadan once internette arama yapabilir (Responses web_search). */
  webSearch?: boolean;
  /** Web aramasinda kullanilan kaynaklar (url_citation) — varsa cagrilir. */
  onSources?: (sources: Array<{ title: string; url: string }>) => void;
}

function citationsOf(response: OpenAI.Responses.Response): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      for (const note of part.annotations ?? []) {
        if (note.type === "url_citation" && note.url && !out.some((s) => s.url === note.url)) {
          out.push({ title: note.title || note.url, url: note.url });
        }
      }
    }
  }
  return out;
}

/** Akil yurutme parametresini kabul eden model aileleri. */
const REASONING_MODELS = /^(gpt-5|o1|o3|o4)/i;

const DEFAULT_CALL_TIMEOUT_MS = 240_000;

function isBillingOrQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code = String((err as { code?: string })?.code || "").toLowerCase();
  return (
    code === "insufficient_quota" ||
    /insufficient_quota|billing|exceeded your current quota|you exceeded your.*quota|payment|bakiy/i.test(message)
  );
}

function friendlyOpenAiError(err: unknown, schemaName: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/timed?\s*out|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return new Error(
      `OpenAI yaniti zaman asimina ugradi (${schemaName}). Uzun hikaye on bilgisi veya cok sahne icin tekrar deneyin; sorun surerse Ayarlar'dan daha hizli bir model secin.`
    );
  }
  // Bakiye/kota bitince OpenAI bazen 429 doner — once bunu yakala
  if (isBillingOrQuotaError(err)) {
    return new Error(
      `OpenAI bakiyesi / kotasi yetersiz (${schemaName}). platform.openai.com uzerinden faturalandirmayi kontrol edip bakiye yukleyin.`
    );
  }
  if (/rate limit|429|too many requests/i.test(message)) {
    return new Error(`OpenAI hiz siniri asildi (${schemaName}). Birkac saniye sonra tekrar deneyin.`);
  }
  return new Error(`OpenAI cagrisi basarisiz (${schemaName}): ${message}`);
}

/**
 * Yapilandirilmis JSON cagrisi. Model ciktisi Zod'dan gecmezse
 * hata mesajiyla birlikte bir kez daha denenir.
 */
export async function structuredCall<T>(options: StructuredCallOptions<T>): Promise<T> {
  const settings = await getSettings();
  const client = await getClient();
  const model = options.model ?? settings.openaiModel;

  const timeout = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  let useReasoning = REASONING_MODELS.test(model);
  let useWebSearch = Boolean(options.webSearch);

  let lastError: string | null = null;
  /*
   * Responses API'de AKIL YURUTME jetonlari da max_output_tokens butcesinden
   * harcanir. Butce yetmezse yanit "incomplete" doner ve JSON yarida kesilir
   * ("Gecersiz JSON" hatasi). Bu durumda ikinci denemede butce buyutulur ve
   * akil yurutme bir kademe dusurulur — boylece cagri kendi kendini toparlar.
   */
  let budget: number = options.maxOutputTokens ?? 16_000;
  let effort: NonNullable<StructuredCallOptions<T>["reasoningEffort"]> = options.reasoningEffort ?? "low";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now();
    // Acik tip: "evolving let" cikarimi, asagidaki response.* kullanimlarinda
    // dairesel cikarim hatasina yol aciyor.
    let response: OpenAI.Responses.Response;
    try {
      response = await client.responses.create(
        {
          model,
          instructions: options.system,
          input:
            attempt === 1
              ? options.user
              : `${options.user}\n\nONCEKI CIKTI SU HATAYLA REDDEDILDI, DUZELTEREK TEKRAR URET: ${lastError}`,
          max_output_tokens: budget,
          text: {
            format: {
              type: "json_schema",
              name: options.schemaName,
              strict: true,
              schema: options.jsonSchema,
            },
          },
          ...(useReasoning ? { reasoning: { effort } } : {}),
          ...(useWebSearch ? { tools: [{ type: "web_search" as const, search_context_size: "medium" as const }] } : {}),
        },
        { timeout }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Model / hesap web aramasini desteklemiyorsa arastirmasiz devam et
      if (useWebSearch && /web_search|tool|not supported|unsupported/i.test(message) && !isBillingOrQuotaError(err)) {
        logger.warn({ model, schema: options.schemaName, message }, "Web aramasi kullanilamadi; model bilgisiyle devam ediliyor");
        useWebSearch = false;
        attempt--;
        continue;
      }
      // Model akil yurutme parametresini kabul etmiyorsa parametresiz tekrar dene
      if (useReasoning && /reasoning|unsupported parameter|unknown parameter/i.test(message)) {
        logger.warn({ model, schema: options.schemaName }, "Model reasoning parametresini kabul etmedi; parametresiz denenecek");
        useReasoning = false;
        attempt--;
        continue;
      }
      throw friendlyOpenAiError(err, options.schemaName);
    }
    const usage = response.usage;
    logger.info(
      {
        schema: options.schemaName,
        model,
        attempt,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        status: response.status,
        budget,
        effort: useReasoning ? effort : "-",
        outputTokens: usage?.output_tokens,
        reasoningTokens: usage?.output_tokens_details?.reasoning_tokens,
      },
      "OpenAI cagrisi tamamlandi"
    );

    // Butce/durdurma nedeniyle YARIM kalan yanit: JSON'u ayristirmaya calismak
    // yaniltici "Gecersiz JSON" hatasi verir. Nedeni acikca bildir ve toparla.
    if (response.status === "incomplete") {
      const incompleteReason: string = response.incomplete_details?.reason ?? "bilinmiyor";
      lastError = `yanit tamamlanmadi (${incompleteReason})`;
      logger.warn({ schema: options.schemaName, attempt, incompleteReason, budget, effort }, "OpenAI yaniti yarim kaldi");
      if (incompleteReason === "max_output_tokens") {
        budget = Math.min(budget * 2, 64_000);
        if (useReasoning && effort === "high") effort = "medium";
        else if (useReasoning && effort === "medium") effort = "low";
      }
      continue;
    }

    const raw = response.output_text ?? "";
    if (!raw.trim()) {
      lastError = "model bos yanit dondurdu";
      logger.warn({ schema: options.schemaName, attempt, status: response.status }, "OpenAI bos yanit dondurdu");
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const validated = options.zodSchema.safeParse(parsed);
      if (validated.success) {
        if (useWebSearch) options.onSources?.(citationsOf(response));
        return validated.data;
      }
      lastError = validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      logger.warn({ schema: options.schemaName, attempt, lastError }, "OpenAI ciktisi Zod dogrulamasindan gecemedi");
    } catch {
      lastError = `gecersiz JSON (${raw.length} karakter alindi)`;
      logger.warn({ schema: options.schemaName, attempt, rawLength: raw.length }, "OpenAI ciktisi JSON olarak ayristirilamadi");
      // Yarim kesilmis olabilir: butceyi buyut, akil yurutmeyi dusur
      budget = Math.min(budget * 2, 64_000);
      if (useReasoning && effort === "medium") effort = "low";
    }
  }
  throw new Error(
    `OpenAI yapilandirilmis cikti uretemedi (${options.schemaName}): ${lastError}. Ayarlar'dan jeton butcesini artirabilir veya daha kisa bir hedef sure secebilirsiniz.`
  );
}

/** Serbest metin cagrisi (kisa yardimci uretimler icin). */
export async function textCall(system: string, user: string, maxOutputTokens = 8_000): Promise<string> {
  const settings = await getSettings();
  const client = await getClient();
  try {
    const response = await client.responses.create(
      {
        model: settings.openaiModel,
        instructions: system,
        input: user,
        max_output_tokens: maxOutputTokens,
        ...(REASONING_MODELS.test(settings.openaiModel) ? { reasoning: { effort: "low" as const } } : {}),
      },
      { timeout: DEFAULT_CALL_TIMEOUT_MS }
    );
    return (response.output_text ?? "").trim();
  } catch (err) {
    throw friendlyOpenAiError(err, "text_call");
  }
}

/**
 * OpenAI resim uretimi (gpt-image-1) KALDIRILDI.
 * Sitedeki her resim Flow / Nano Banana Pro ile uretilir:
 * @see src/server/services/flow-image.ts
 */

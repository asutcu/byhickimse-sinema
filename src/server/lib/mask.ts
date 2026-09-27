/**
 * Gizli bilgilerin log ve arayuzde maskelenmesi.
 */

const SECRET_PATTERNS: RegExp[] = [
  // OpenAI anahtarlari: sk-..., sk-proj-...
  /sk-[A-Za-z0-9_-]{8,}/g,
  // Google oturum cerezleri / uzun tokenlar
  /(?:SID|HSID|SSID|APISID|SAPISID|__Secure-[A-Za-z0-9_-]+)=[^;\s"']{8,}/g,
  // Bearer tokenlar
  /Bearer\s+[A-Za-z0-9._-]{10,}/g,
];

/** Metindeki bilinen gizli desenleri yildizlarla degistirir. */
export function maskSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => maskValue(match));
  }
  return result;
}

/** Tek bir gizli degeri "ilk 4 + *** + son 2" bicimine indirger. */
export function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}${"*".repeat(6)}${value.slice(-2)}`;
}

/** API anahtarini arayuzde gostermek icin guvenli ozet uretir (or. sk-p******Ab). */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return "";
  return maskValue(key);
}

/** Nesne icindeki bilinen gizli alan adlarini maskeler (log oncesi). */
export function maskObject<T>(input: T): T {
  const SECRET_KEYS = ["apikey", "api_key", "openaiapikey", "password", "cookie", "authorization", "token", "secret"];
  const seen = new WeakSet<object>();

  function walk(value: unknown): unknown {
    if (typeof value === "string") return maskSecrets(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEYS.includes(k.toLowerCase().replace(/[^a-z_]/g, ""))) {
          out[k] = typeof v === "string" ? maskValue(v) : "********";
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return value;
  }

  return walk(input) as T;
}

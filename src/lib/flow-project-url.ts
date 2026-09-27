/**
 * Google Flow proje adresleri. Flow iki alan adinda calisir; ayni proje her
 * ikisinde de ayni kimlikle acilir (eski adres yeniye yonlenir):
 *   Yeni: https://flow.google.com/project/<id>
 *   Eski: https://labs.google/fx/<dil>/tools/flow/project/<id>
 */

export const FLOW_PROJECT_URL_EXAMPLE = "https://flow.google.com/project/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";

const PROJECT_ID = /\/project\/([0-9a-f][0-9a-f-]{7,})/i;

/** Adresi dogrular ve sade bicime getirir (alt sayfa, query haric). Gecersizse null. */
export function normalizeFlowProjectUrl(raw: string | null | undefined): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "flow.google.com" || host === "www.flow.google.com" || host === "flow.google") {
      const match = url.pathname.match(/^(\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?project\/[0-9a-f][0-9a-f-]{7,})/i);
      return match ? `https://${host}${match[1]}` : null;
    }
    if (host === "labs.google") {
      const match = url.pathname.match(/^(\/fx(?:\/[a-z]{2}(?:-[A-Za-z]{2})?)?\/tools\/flow\/project\/[0-9a-f][0-9a-f-]{7,})/i);
      return match ? `https://labs.google${match[1]}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Adresteki Flow proje kimligi (kucuk harf); yoksa "". */
export function flowProjectIdFromUrl(url: string | null | undefined): string {
  return (url || "").split(/[?#]/)[0].match(PROJECT_ID)?.[1]?.toLowerCase() || "";
}

/** Iki adres ayni Flow projesini mi gosteriyor (alan adi ve dil farki onemsiz). */
export function sameFlowProject(a: string | null | undefined, b: string | null | undefined): boolean {
  const idA = flowProjectIdFromUrl(a);
  return Boolean(idA) && idA === flowProjectIdFromUrl(b);
}

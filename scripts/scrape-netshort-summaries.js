const fs = require("fs");

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "tr" },
  });
  return res.text();
}

function decodeHtml(s) {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">");
}

function cleanSummary(raw) {
  if (!raw) return "";
  let s = decodeHtml(raw).replace(/\s+/g, " ").trim();
  s = s.replace(/Hemen incele:.*$/i, "").trim();
  s = s.replace(/İster evde, ister dışarıda.*$/i, "").trim();
  s = s.replace(/\.{3,}.*$/i, (m, offset, str) => {
    // keep if summary itself ends with ...
    if (str.length < 120) return m;
    return "";
  });
  // cut marketing tails
  const cutAt = s.search(/\s*(Hemen|NetShort|tüm bölümleri|İster evde)/i);
  if (cutAt > 80) s = s.slice(0, cutAt).trim();
  return s;
}

function extractJsonLdSeries(html) {
  const out = [];
  const scripts = [
    ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const sc of scripts) {
    try {
      const data = JSON.parse(sc[1]);
      const nodes = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const node of nodes) {
        for (const li of node.itemListElement || []) {
          const item = li.item || li;
          if (item?.name) {
            out.push({
              title: item.name,
              url: item.url,
              genres: item.genre || [],
              episodes: item.numberOfEpisodes || null,
            });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function extractSummaryFromPage(html) {
  // Prefer long prose before marketing
  const candidates = [];

  const og = html.match(/property="og:description"\s+content="([^"]+)"/i);
  if (og?.[1]) candidates.push(og[1]);

  const md = html.match(/name="description"\s+content="([^"]+)"/i);
  if (md?.[1]) candidates.push(md[1]);

  // JSON blobs often contain intro/description
  for (const key of ["description", "intro", "summary", "brief", "desc", "content"]) {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\]){80,1200})"`, "gi");
    let m;
    while ((m = re.exec(html))) {
      candidates.push(m[1].replace(/\\n/g, " ").replace(/\\"/g, '"'));
    }
  }

  // visible paragraphs near title
  const paras = [...html.matchAll(/<p[^>]*>([^<]{80,900})<\/p>/gi)].map((m) => m[1]);
  candidates.push(...paras.slice(0, 8));

  const cleaned = candidates
    .map(cleanSummary)
    .filter((s) => s.length >= 60)
    .filter((s) => !/^En popüler/i.test(s))
    .sort((a, b) => b.length - a.length);

  return cleaned[0] || cleanSummary(candidates[0] || "");
}

(async () => {
  const byTitle = new Map();

  // Load existing if present
  if (fs.existsSync("tmp-netshort-allplots.json")) {
    const prev = JSON.parse(fs.readFileSync("tmp-netshort-allplots.json", "utf8"));
    for (const d of prev.dramas || []) {
      byTitle.set(d.title.toLowerCase(), { ...d, summary: cleanSummary(d.summary || "") });
    }
  }

  // Refresh listing pages 1-15 for more URLs
  for (let p = 1; p <= 15; p++) {
    const url =
      p === 1
        ? "https://netshort.com/tr/drama/all-plots"
        : `https://netshort.com/tr/drama/all-plots/page/${p}`;
    const html = await fetchText(url);
    for (const s of extractJsonLdSeries(html)) {
      const key = s.title.toLowerCase();
      const prev = byTitle.get(key) || {};
      byTitle.set(key, {
        ...prev,
        title: s.title,
        url: s.url || prev.url,
        genres: [...new Set([...(prev.genres || []), ...(s.genres || [])])],
        episodes: s.episodes || prev.episodes || null,
        summary: prev.summary || "",
      });
    }
    console.log(`list page ${p} unique=${byTitle.size}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  const dramas = [...byTitle.values()].filter((d) => d.url);
  // Prefer those without good summary first
  dramas.sort((a, b) => (a.summary?.length || 0) - (b.summary?.length || 0));

  const TARGET = Math.min(dramas.length, 180);
  console.log(`fetching/refining summaries for ${TARGET} of ${dramas.length}`);

  let good = 0;
  for (let i = 0; i < TARGET; i++) {
    const d = dramas[i];
    try {
      const html = await fetchText(d.url);
      const sum = extractSummaryFromPage(html);
      if (sum.length > (d.summary?.length || 0)) d.summary = sum;
      if ((d.summary || "").length >= 100) good++;
    } catch (e) {
      d.error = String(e.message || e);
    }
    if ((i + 1) % 20 === 0) {
      console.log(`progress ${i + 1}/${TARGET} good>=100chars=${good}`);
    }
    await new Promise((r) => setTimeout(r, 220));
  }

  // merge back into map
  for (const d of dramas) byTitle.set(d.title.toLowerCase(), d);
  const all = [...byTitle.values()];
  const withGood = all.filter((d) => (d.summary || "").length >= 100);

  const out = {
    scrapedAt: new Date().toISOString(),
    source: "https://netshort.com/tr/drama/all-plots",
    dramaCount: all.length,
    withGoodSummary: withGood.length,
    dramas: all,
  };
  fs.writeFileSync("tmp-netshort-allplots.json", JSON.stringify(out, null, 2), "utf8");

  // Also write a compact summaries-only file for corpus encoding
  const compact = withGood.map((d) => ({
    title: d.title,
    genres: d.genres || [],
    summary: d.summary,
    episodes: d.episodes,
    url: d.url,
  }));
  fs.writeFileSync("tmp-netshort-summaries-good.json", JSON.stringify(compact, null, 2), "utf8");
  console.log("DONE total", all.length, "good summaries", withGood.length);
  console.log(
    withGood
      .slice(0, 8)
      .map((d) => `${d.title}: ${d.summary.slice(0, 140)}`)
      .join("\n---\n")
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

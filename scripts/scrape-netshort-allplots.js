const fs = require("fs");

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "tr" },
  });
  return res.text();
}

function extractJsonLdSeries(html) {
  const out = [];
  const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    try {
      const data = JSON.parse(s[1]);
      const nodes = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const node of nodes) {
        const list = node.itemListElement || [];
        for (const li of list) {
          const item = li.item || li;
          if (item && (item["@type"] === "TVSeries" || item.name)) {
            out.push({
              title: item.name,
              url: item.url,
              genres: item.genre || [],
              episodes: item.numberOfEpisodes || null,
            });
          }
        }
        if (node["@type"] === "TVSeries" && node.name) {
          out.push({
            title: node.name,
            url: node.url,
            genres: node.genre || [],
            episodes: node.numberOfEpisodes || null,
          });
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function extractDescription(html) {
  const og = html.match(/property="og:description"\s+content="([^"]+)"/i);
  if (og?.[1]) return decodeHtml(og[1]).replace(/\s+/g, " ").trim();
  const md = html.match(/name="description"\s+content="([^"]+)"/i);
  if (md?.[1]) return decodeHtml(md[1]).replace(/\s+/g, " ").trim();
  return "";
}

function decodeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractGenreFilters(html) {
  const set = new Set();
  const re = /\/tr\/drama\/([^"'\\/]+)-(\d+)/g;
  let m;
  while ((m = re.exec(html))) {
    set.add(decodeURIComponent(m[1].replace(/\+/g, " ")));
  }
  return [...set];
}

(async () => {
  const byTitle = new Map();
  const genreFilters = new Set();

  for (let p = 1; p <= 12; p++) {
    const url =
      p === 1
        ? "https://netshort.com/tr/drama/all-plots"
        : `https://netshort.com/tr/drama/all-plots/page/${p}`;
    const html = await fetchText(url);
    extractGenreFilters(html).forEach((g) => genreFilters.add(g));
    const series = extractJsonLdSeries(html);
    for (const s of series) {
      if (!s.title) continue;
      const key = s.title.toLowerCase();
      if (!byTitle.has(key)) byTitle.set(key, s);
      else {
        const prev = byTitle.get(key);
        prev.genres = [...new Set([...(prev.genres || []), ...(s.genres || [])])];
        if (!prev.url && s.url) prev.url = s.url;
      }
    }
    console.log(`page ${p}: series=${series.length} unique=${byTitle.size}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  const dramas = [...byTitle.values()];
  // Fetch summaries for first 60 with URLs
  const withUrl = dramas.filter((d) => d.url).slice(0, 60);
  console.log(`fetching summaries for ${withUrl.length}...`);
  for (let i = 0; i < withUrl.length; i++) {
    const d = withUrl[i];
    try {
      const html = await fetchText(d.url);
      d.summary = extractDescription(html);
      // also try h1 sibling paragraph-ish
      if (!d.summary || d.summary.length < 40) {
        const m = html.match(/<h1[^>]*>[\s\S]*?<\/h1>[\s\S]{0,400}?<p[^>]*>([^<]{40,600})<\/p>/i);
        if (m) d.summary = decodeHtml(m[1]).replace(/\s+/g, " ").trim();
      }
    } catch (e) {
      d.summary = "";
      d.error = String(e.message || e);
    }
    if ((i + 1) % 10 === 0) console.log(`summaries ${i + 1}/${withUrl.length}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // genre -> titles map
  const byGenre = {};
  for (const d of dramas) {
    for (const g of d.genres || []) {
      if (!byGenre[g]) byGenre[g] = [];
      byGenre[g].push(d.title);
    }
  }

  const out = {
    scrapedAt: new Date().toISOString(),
    source: "https://netshort.com/tr/drama/all-plots",
    pagesScraped: 12,
    genreFilters: [...genreFilters].sort(),
    dramaCount: dramas.length,
    withSummary: dramas.filter((d) => d.summary).length,
    byGenre,
    dramas,
  };
  fs.writeFileSync("tmp-netshort-allplots.json", JSON.stringify(out, null, 2), "utf8");
  console.log("DONE genres", out.genreFilters.length, "dramas", dramas.length, "summaries", out.withSummary);
  console.log("sample", dramas.filter((d) => d.summary).slice(0, 5));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

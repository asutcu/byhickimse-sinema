const fs = require("fs");
const path = require("path");

function cleanSummary(raw) {
  if (!raw) return "";
  let s = String(raw)
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const cut = s.search(/\s*(Hemen incele:|NetShort|İster evde, ister dışarıda)/i);
  if (cut > 60) s = s.slice(0, cut).trim();
  s = s.replace(/\.{2,}\s*$/, ".").trim();
  return s;
}

function inferEmotions(summary, genres) {
  const s = (summary + " " + (genres || []).join(" ")).toLowerCase();
  const out = [];
  if (/pişman|ölüm|yalnız|geri sar|zaman/.test(s)) out.push("geç kalmış pişmanlık", "ikinci şans aciliyeti");
  if (/aşağılan|hiç kimse|hor gör|ezil/.test(s)) out.push("aşağılanma yarası", "görünmezlik acısı");
  if (/prenses|sosyet|para peşinde|gaspet|çal/.test(s)) out.push("sahte aile öfkesi", "para avcılığı iğrenmesi");
  if (/gizli|kimlik|varis|maske/.test(s)) out.push("gizli güç gerilimi", "açılış şoku");
  if (/ihanet|aldat|sekreter|terk/.test(s)) out.push("ihanet sokü", "sakin yıkıcı karar");
  if (/hesap|intikam|ifşa/.test(s)) out.push("hesap sorma tatmini");
  if (/sözleşme|anlaşmalı/.test(s)) out.push("mesafe", "beklenmedik bağ");
  if (/dönüş|geri dön|yükseliş/.test(s)) out.push("statü zaferi");
  if (!out.length) out.push("duygusal darbe", "statü gerilimi");
  return [...new Set(out)].slice(0, 5);
}

function inferThoughts(summary) {
  const s = summary.toLowerCase();
  const out = [];
  if (/öz kız|kızım|emily|görmezden/.test(s)) out.push("Onu yıllarca görmezden geldim.", "Bu kez onu seçeceğim.");
  if (/pişman|ölüm/.test(s)) out.push("Çok geç anladım.", "Bir şans daha.");
  if (/aşağılan|hiç kimse/.test(s)) out.push("Beni hiç kimse sandılar.", "Yetişemedim.");
  if (/prenses|chloe|sosyet/.test(s)) out.push("Paranın peşindeki yüzler.", "Sahte prenses değil, özüm.");
  if (/sekreter|aldat|boşan/.test(s)) out.push("Boşanmak istiyorum.", "Bu bebek senin değil.");
  if (/hesap|çal|gaspet/.test(s)) out.push("Kalem kalem ödeyeceksin.");
  if (!out.length) out.push("Beni kim sandığınızı göreceksiniz.", "Geri getiremezsin.");
  return [...new Set(out)].slice(0, 4);
}

function inferBeats(summary) {
  const s = summary.toLowerCase();
  const beats = [];
  if (/hastane|ölüm/.test(s)) beats.push("yalnız ölüm / pişmanlık yatağı");
  if (/zaman|geri sar|yeniden doğ/.test(s)) beats.push("zaman geri sarılır / ikinci şans");
  if (/aşağılan|hiç kimse|hor/.test(s)) beats.push("herkesin önünde aşağılanma");
  if (/gala|şirket pay|hediye/.test(s)) beats.push("yanlış kişiye hediye / doğru kişiye pay");
  if (/sekreter|aldat/.test(s)) beats.push("tercih / sekreter samimiyeti");
  if (/boşan|dilekçe/.test(s)) beats.push("sakin yıkıcı karar");
  if (/dönüş|manset|varis/.test(s)) beats.push("statüyle dönüş");
  if (/pişman|yalvar/.test(s)) beats.push("pişmanlık yalvarışı");
  if (!beats.length) beats.push("aşağılanma", "karar", "dönüş");
  return [...new Set(beats)].slice(0, 6);
}

const SEED = [
  {
    title: "Unutulan Öz Kız",
    genres: ["Şehir Yaşamı", "İlham Verici"],
    summary:
      "Carter Tech’in milyarder kurucusu Ethan Carter, hastane yatağında yapayalnız ölümü bekler. Sosyetik Vanessa Reed ve kızı Chloe sadece parasının peşindedir. Ona aile gibi davranan tek kişi, yıllarca görmezden geldiği öz kızı Emily Carter’dır. Ethan pişmanlıkla ölür… ve zaman 5 yıl geri sarar. Chloe’ye alacağı hediyeyi çöpe atıp Emily’ye doğum günü için lüks bir gala ve şirket payı ayırır. Ama herkes Chloe’yi “prenses”, Emily’yi “hiç kimse” sanır; Ethan yetişemeden Emily aşağılanır.",
    url: "https://netshort.com/tr/episode/unutulan-%C3%B6z-k%C4%B1z-2082651539392782338",
    source: "user+netshort",
  },
  {
    title: "Bu Bebek Senin Değil",
    genres: ["Modern Aşk", "Aşk ve Evlilik", "Zorlu Geri Kazanış"],
    summary:
      "İris’in kocası, ilk aşkına benzeyen sekreterini eşi İris’e tercih eder. İris sakin ama yıkıcı bir kararla boşanma ister ve karnındaki bebeğin ondan olmadığını söyler. 5 yıl sonra İris, yeni aşkıyla güçlü biçimde geri döner; koca ise pişmanlığında boğulur.",
    url: "https://netshort.com/tr/episode/bu-bebek-senin-de%C4%9Fil-2085634352775294978",
    source: "netshort",
  },
  {
    title: "Bay Big, Bebek Sizin Değil",
    genres: ["Modern Aşk", "İntikam", "Güçlenme ve İntikam"],
    summary:
      "Bağımsız bir kadın, kocasının sekreterle aldatıldığını öğrenir. İntikamını, bir sperm bağışçısından hamile kalıp onunla evlenerek alır. Eski koca pişman, metres rezil olur.",
    url: "https://netshort.com/tr/full-episodes/bay-big-bebek-sizin-de%C4%9Fil-2011268967016824834",
    source: "netshort",
  },
  {
    title: "Boşanma Sonrası Varis",
    genres: ["Modern Aşk", "Zorlu Geri Kazanış", "Beklenmedik Dönüş"],
    summary:
      "Callie, Andrew’la 3 yıl evli kaldı; kusursuz eş oldu ama onun kalbini ısıtamadı. Andrew’un ilk aşkı Callie’ye iftira atınca, “bedel” diye ondan böbreğini vermesini bile istedi. Callie boşanma dilekçesini uzattı. Andrew onun onsuz yaşayamayacağını sanıyordu. Oysa ertesi gün Callie, saygın Jon ailesinin varisi olarak manşetlere çıktı. Yeniden karşılaşınca Andrew pişman oldu; ona âşık olduğunu anladı… Peki onu geri kazanabilecek mi?",
    url: "https://netshort.com/tr/full-episodes/bo%C5%9Fanma-sonras%C4%B1-varis-2080535254612066305",
    source: "netshort",
  },
];

const byTitle = new Map();
for (const s of SEED) {
  byTitle.set(s.title.toLowerCase(), s);
}

const scrapePath = path.join(process.cwd(), "tmp-netshort-allplots.json");
if (fs.existsSync(scrapePath)) {
  const scraped = JSON.parse(fs.readFileSync(scrapePath, "utf8"));
  for (const d of scraped.dramas || []) {
    const summary = cleanSummary(d.summary || "");
    if (summary.length < 80) continue;
    const key = (d.title || "").toLowerCase();
    if (!key) continue;
    const prev = byTitle.get(key);
    if (!prev || summary.length > (prev.summary?.length || 0)) {
      byTitle.set(key, {
        title: d.title,
        genres: d.genres || [],
        summary,
        url: d.url || "",
        episodes: d.episodes || null,
        source: "scrape",
      });
    }
  }
}

const bank = [...byTitle.values()].map((d) => ({
  title: d.title,
  genres: d.genres || [],
  summary: cleanSummary(d.summary),
  url: d.url || "",
  episodes: d.episodes || null,
  emotions: inferEmotions(d.summary, d.genres),
  thoughts: inferThoughts(d.summary),
  beats: inferBeats(d.summary),
  source: d.source || "scrape",
}));

bank.sort((a, b) => a.title.localeCompare(b.title, "tr"));

const outDir = path.join(process.cwd(), "src", "data");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "netshort-summaries.json");
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      note: "NetShort ozet bankasi — isim/baslik CALMA, duygu+merdiven+sahne ruhu kullan. 18+.",
      count: bank.length,
      entries: bank,
    },
    null,
    2
  ),
  "utf8"
);

console.log("wrote", outFile, "entries", bank.length);
console.log(
  "sample",
  bank
    .filter((e) => /Unutulan|Bebek Senin|Boşanma Sonrası/i.test(e.title))
    .map((e) => `${e.title} | ${e.emotions.join(", ")} | ${e.summary.slice(0, 80)}`)
);

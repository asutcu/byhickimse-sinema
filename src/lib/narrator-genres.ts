/**
 * Sinema anlatici (Flow video) hikaye turleri.
 *
 * Hedef ton: NetShort / kisa dikey dram (or. "Bu Bebek Senin Degil"):
 * ihanet → sakin ama yikici karar → zaman atlamasi → guclu geri donus → pismanlik.
 * Surekli bagirma / kufur yagmuru DEGIL; duygusal darbe + status cevirisi + cliffhanger.
 */

import {
  NETSHORT_CORPUS_STORY_LOCK,
  NETSHORT_CORPUS_VISUAL_BEATS,
  NETSHORT_CRUELTY_STORY_LOCK,
  netShortEmotionPaletteBlock,
} from "@/lib/netshort-corpus";
import { NETSHORT_GENRE_ATLAS_LOCK, formatNetShortGenreAtlasForPrompt } from "@/lib/netshort-genre-atlas";
import { netShortSummaryPromptBlock, netShortBeatsPromptBlock } from "@/lib/netshort-summaries";

export type NarratorGenreId =
  | "aldatma"
  | "ihanet"
  | "yasak-ask"
  | "kiskanclik"
  | "intikam"
  | "bosanma"
  | "aile-sirri"
  | "kayinvalide"
  | "hesap-sorma"
  | "guclu-donus"
  | "yeniden-dogus"
  | "kadin-gelisimi"
  | "gizli-kimlik"
  | "sozlesmeli-evlilik"
  | "yildirim-nikahi"
  | "zengin-aile"
  | "pismanlik"
  | "trajik-ask"
  | "aile-bagi"
  | "ahlaki-ikilem"
  | "gizem"
  | "gerilim"
  | "dram"
  | "gercek-yasam"
  | "romantik"
  | "korku"
  | "ozel";

export interface NarratorGenre {
  id: NarratorGenreId;
  label: string;
  tagline: string;
  /** Hikaye + film planina yapisir; gorselde yatak/samimi yasagi durur. */
  storyPrompt: string;
  /** Konu kutusuna yazilan kisa, profesyonel brief (2-4 cumle). */
  topicSuggestions: string[];
  /** NetShort atlas/ozet bankasi etiketleri — tur filtreli ornekleme icin. */
  netShortTags?: string[];
}

/** Hikaye turu ekrani — NetShort all-plots taksonomisiyle hizali gruplar. */
export const NARRATOR_GENRE_GROUPS: Array<{ title: string; hint: string; ids: NarratorGenreId[] }> = [
  {
    title: "Hesap ve donus",
    hint: "Hesap sorma, guclu donus, gizli kimlik — NetShort klasigi",
    ids: ["hesap-sorma", "guclu-donus", "yeniden-dogus", "gizli-kimlik", "kadin-gelisimi", "intikam", "pismanlik"],
  },
  {
    title: "Ask ve evlilik",
    hint: "Aldatma, sozlesmeli evlilik, yildirim nikahi",
    ids: ["aldatma", "yasak-ask", "sozlesmeli-evlilik", "yildirim-nikahi", "bosanma", "kiskanclik", "romantik", "trajik-ask"],
  },
  {
    title: "Aile",
    hint: "Zengin aile drami, aile bagi, kayinvalide",
    ids: ["zengin-aile", "aile-bagi", "aile-sirri", "kayinvalide", "ahlaki-ikilem", "ihanet"],
  },
  {
    title: "Klasik",
    hint: "Gizem, gerilim, dram, gercek yasam",
    ids: ["gizem", "gerilim", "dram", "gercek-yasam", "korku", "ozel"],
  },
];

export function narratorGenresInGroup(ids: readonly NarratorGenreId[]): NarratorGenre[] {
  return ids.map((id) => narratorGenreById(id)).filter((g) => ids.includes(g.id));
}

/**
 * Iliski dramasi turleri: NetShort omurgasi (ihanet → donus → pismanlik) zorunlu.
 */
export const NARRATOR_HARD_CONFLICT_GENRE_IDS: readonly NarratorGenreId[] = [
  "aldatma",
  "yasak-ask",
  "ihanet",
  "kiskanclik",
  "intikam",
  "bosanma",
  "aile-sirri",
  "kayinvalide",
  "hesap-sorma",
  "guclu-donus",
  "yeniden-dogus",
  "kadin-gelisimi",
  "gizli-kimlik",
  "sozlesmeli-evlilik",
  "yildirim-nikahi",
  "zengin-aile",
  "pismanlik",
];

export function isNarratorHardConflictGenre(raw: string | null | undefined): boolean {
  return NARRATOR_HARD_CONFLICT_GENRE_IDS.includes(resolveNarratorGenre(raw).id);
}

/**
 * NetShort / kisa dikey dram omurgasi — TUM anlatici hikayeler.
 * Referans ruh: ihanet, sakin yikici karar, zaman atlamasi, guclu donus, pismanlik.
 */
export const NARRATOR_SHORT_DRAMA_LOCK = [
  "NETSHORT KISA DRAM OMURGASI (zorunlu — bagirma yagmuru DEGIL):",
  "Amac: izleyiciyi duygusal darbelerle kilitle. Her 30-60 sn'de bir 'nasil yani?' anı.",
  "KLASIK MERDIVEN: (1) ihanet/asagilanma sahnesi (2) SAKIN ama YIKICI karar veya soz (3) dusus / ayrilik (4) zaman atlamasi veya gizli guclenme (5) gorsel/statu cevirisiyle geri donus (6) karsi tarafin PISMANLIGI.",
  "SAKIN YIKICILIK: En guclu anlar bagiris olmak zorunda degil. Ornek ruh: 'Bosanmak istiyorum.' / 'Bu bebek senin degil.' / 'Bir daha arama.' Sessiz, net, izleyiciyi donduran cumleler.",
  "STATUS CEVIRISI: Once ezilen taraf sonra guclu, zengin, yeni askli veya itibarli doner; eski partner / aile / sekreter boğulur. Luks vs bosluk tezatini kullan (araba, ofis, dugun flashback).",
  "UCUNCU KISI: sekreter, ilk aska benzeyen kadin, kayinvalide, ortagi — ucgen veya aile baskisi net olsun.",
  "FLASHBACK: mutlu dugun / ilk gece / 'seni hic birakmam' sozu ↔ bugunku sogukluk. Tezat kalp burksun.",
  "PISKINLIK: ihanet eden utanmasin; kucumsesin, tercihi gosterissin. Ama hikaye SADECE kufur/tokat yagmuru olmasin — duygusal hesap + donus asil silah.",
  "CLIFFHANGER: bolum/paragraf sonlari yarim darbe biraksin; film SONU kapansin (pismanlik + karar).",
  "Yatak / soyunuk / porno tarif YASAK. 18 yas alti, ergen, okul romantizmi YASAK.",
].join(" ");

/**
 * Film plani + Flow gorseli: NetShort'un ekranda gordugun sahne dili.
 * Referans: luks araba / ofis / magaza / dugun flashback / soguk bakis / status donusu.
 */
export const NARRATOR_NETSHORT_VISUAL_LOCK = [
  "NETSHORT GORSEL SAHNE DILI (klipler boyle GOSTERILSIN — soyut bosluk YASAK):",
  "CUTAWAY mekan: luks sedan/limuzin, ofis cam, magaza cikis, restoran, dugun FLASHBACK, penthouse, otel lobisi.",
  "Klasik darbe: sekreter samimi → camdan donuk bakis; dugun warm ↔ araba cold; yeni askla donus → eski es yuzu dusmus; kagit/anahtar masada; telefon isigi (okunur yazi YOK).",
  "Oyun: soguk bakis, kontrollu gulus, yukaridan bakis, itme/tokat/kapi carpma (kan YOK), donup gitme, status tezatı. Surekli bagirma montaji YASAK — ama EZME ve USTUNLUK karede okusun.",
  "TEMPO: her cutaway TEK net olay + hareket. Klip 2-4 HIZLI — donuk oturma/manzara YASAK. Push-in/pan + el-nesne zorunlu.",
].join(" ");

/**
 * NetShort cekim grameri — etki/tepki, 1-2 kisi, sureklilik, uyku yok.
 * Ozet bankasi + dikey kisa dram incelemeleriyle birebir.
 */
export const NARRATOR_NETSHORT_SHOT_CRAFT_LOCK = [
  "NETSHORT CEKIM GRAMERI (zorunlu — birebir kisa dram):",
  "KADRAJ: o anın hikaye metninde adı geçen herkes kadrajda (1-4 isimli yüz). Metinde olmayanı ekleme; kalabalık 'herkes' partisi YASAK.",
  "ETKI→TEPKI: bir klip EYLEM (uzatma, gulus, tercih, kapi, kagit, tokat/itme); sonraki klip TEPKI CU (goz, cene, nefes, donme). Iki-shot → insert → reaction.",
  "SUREKLILIK: klipler genelde birbirinin devamı — MATCH-ON-ACTION; ayni mekan/hava/kiyafet; telepor YASAK.",
  "UYKU YASAK: yavas bakisma, uzun yuruyus, bos manzara, oturup dusunme. Her 8 sn'de fiziksel/status darbesi.",
  "HIKAYE METNI: her darbede kim varsa OZEL ISIMLE yaz (Emre, Ayşe). 'Kocam/o' yetmez. Kac kisi varsa hepsinin adı geçsin.",
].join(" ");

/**
 * NetShort güç dinamigi: ezme, asagılama, ustunluk, kontrollu siddet (yayin-guvenli).
 * Ozet bankasindaki ihanet/hesap/donus filmlerinin ruhu.
 */
export const NARRATOR_NETSHORT_POWER_LOCK = [
  "NETSHORT GUÇ / EZME / USTUNLUK / SIDDET (zorunlu — yumusak drama YASAK):",
  "EZME: erken bolumde kahraman HOR GORULSUN — kucumseyen gulumseme, 'abartiyorsun', herkesin onunde tercih baskasina, evrak/anahtar firlatma, 'sen hicbir sey degilsin' ruhu.",
  "USTUNLUK: ihanet eden / baski yapan once pişkin USTUN dursun (luks, ses tonu, bakis yukaridan). DONUSTE ustunluk tersine cevrilsin — kahraman soguk, zengin, yeni askli veya itibarli; ezilen eski taraf kuculur.",
  "ASAGILAMA SAHNELERI: ofis, dugun, aile sofrasi, magaza, hissedar — kamu veya yari-kamu rezalet. Sessiz bakislar + tek yikici cumle yeter.",
  "SIDDET (kontrollu, yayin-guvenli): tokatsi, omuz itmesi, masaya vurma, kapi carpma, bardak/telefon firlatma, yaka silkme SERBEST ve hikayede EN AZ 1-2 kez GEC MELİ. Kan, silah, oldurme, iskence, kemik kirma, yuz parcasi YASAK.",
  "SOZEL SIDDET: kisa, keskin hakaret/kucumseme ('cik git', 'dilenci', 'metres', 'kimse seni istemez') — ama her cumle kufur olmasin; darbe gibi kullan.",
  "BEDENSEL USTUNLUK GORSELİ: ayakta vs oturan, yakina gelip egilme, kapiyi tutup birakmama, koluna baskasiyla girme, kameraya sirt donup gulus.",
  "HESAP: donuste ayni ezme dili GERI DONSUN — kahraman sakin ama yikici; karsi taraf yalvarir / yuzu dusun / herkesin onunde kuculur.",
  "DENGE: siddet + ezme + status; SADECE bagirma montaji veya SADECE yumusak aglama YASAK. Izleyici yanip 'nasil yani' desin.",
].join(" ");

/**
 * NetShort tempo: acilis akici kalsin; erken orta (2-4) ve orta bolum duraganlasmasin.
 */
export const NARRATOR_NETSHORT_TEMPO_LOCK = [
  "NETSHORT TEMPO KILIDI (zorunlu):",
  "Acilis kancasi guclu olsun — ama SONRAKI 3-4 paragraf/klip ASLA yavaslamasin. 'Oturdum dusundum', uzun duygu ozeti, tekrar sikayet YASAK.",
  "Her kisa parcada (yaklasik 8-12 sn) EN AZ bir yeni darbe: yeni kanit, pişkin soz, tercih ani, kapi/telefon, flashback kesmesi, status tezatı, karar. Yerinde sayma yok.",
  "Cumle ritmi HIZLI NetShort: uzun-uzun-KISA. Arka arkaya 3+ uzun duygusal cumle YASAK. 3-8 kelimelik soguk darbeler serbest ('Bosanmak istiyorum.' / 'Ona baktik.').",
  "Orta bolum: tempo dusmesin — yon degistiren gelisme zorunlu (yeni kanit / yanlis suclama / geri adim / ucuncu kisi).",
  "Izleyici hissi: bolum bolum tiklayan kisa dram — uzatilmis melankoli veya sakin manzara YASAK.",
].join(" ");

/**
 * Tum anlatici hikayeler: NetShort ENTRIKA — tur etiketi ne olursa olsun duz hayat yok.
 */
export const NARRATOR_NETSHORT_INTRIGUE_LOCK = [
  "NETSHORT ENTRIKA (TUM TURLER — zorunlu):",
  "Bu markanin DNA'si: ihanet, aldatma, gizem, aile sirri, ikinci hayat, sahte guven, hesap sorma, status donusu. Duz 'gunluk yasam guncesi' veya yavas duygusal ozet YASAK.",
  "Tur etiketi ne olursa olsun (aldatma / gizem / gerilim / dram / gercek yasam / romantik…): hikaye ENTRIKALI olsun — en az 2 bilgi cevirisi veya 'nasil yani?' ani.",
  "Erken: pişkin veya sakli taraf (ucuncu kisi, yalan, gizli dosya, yanlis yuz). Orta: kanit veya ifsa darbesi. Donus: status/zafer. Son: pismanlik + karar.",
  "Her paragraf entrikayi ILETSIN: yeni ipucu, celiski, tercih, tehdit veya flashback tezatı. Yerinde sayan sikayet blogu YASAK.",
  "Izleyici hep bir adim geride kalsin ama asla saskin-bos kalmasin — merak + darbe + donus.",
].join(" ");

/**
 * Dogal guzel hanimefendi kadin: ozgun kurgu yuz (etnik tip YASAK),
 * hafif mini/diz ustu zarif kiyafet serbest. 18+ zorunlu; bebek surat ve ciplaklik YASAK.
 */
export const NARRATOR_NETSHORT_FEMALE_LOOK_LOCK = [
  "NETSHORT KADIN GORUNUM (kadro + sheet — ZORUNLU):",
  "Tum KADIN karakterler: acikca YETISKIN 23-28 yas (tercihen 25). 18 alti YASAK. Cocuk/ergen yuzu ve BEBEK SURAT YASAK.",
  "YUZ: dogal guzel HANIMEFENDI — ozgun kurgu yuz. Zarif ve bakimli; cirkin/bakimsiz YASAK, plastik/asiri makyaj da YASAK. Unlu adi ve etnik tip etiketi YASAK.",
  "KIYAFET zarif ve hanimefendi: HAFIF MINI veya diz ustu etek/elbise SERBEST; zarif topuklu veya babet serbest. Dekolte, crop, ic camasir-as-kiyafet, kulup bodycon YASAK. Muhafazakar ofis/hirka/kaban zorunlu DEGIL.",
  "Ciplaklik, yatak/porno poz YASAK. Yuzler bu hikayenin OZGUN kurgu kisileri.",
  "Erkek kadro: gunluk gomlek/jean, 30-42.",
].join(" ");

/** Eski isim uyumlulugu — story/curiosity importlari. */
export const NARRATOR_SHOCK_AND_HEAT_LOCK = NARRATOR_SHORT_DRAMA_LOCK;

/**
 * Diyalog + duygu: NetShort tarzı — pişkin ihanet + sakin intikam sozleri.
 */
export const NARRATOR_MOCKING_DIALOGUE_LOCK = [
  "DIYALOG + DUYGU (NetShort — ezme + ustunluk):",
  "Ihanet eden / baski yapan: pişkin USTUN. Ornek ruh: 'Is yemegi.' / 'Sen abartiyorsun.' / 'Cik git.' / 'Kimse seni istemez.' / 'O sadece sekreterim.'",
  "Kahraman: once ezilir, sonra SAKIN ve yikici. Ornek ruh: 'Bosanmak istiyorum.' / 'Bu bebek senin degil.' / 'Bir daha arama.' / 'Simdi sen yalvar.'",
  "Donuste: soğuk zafer, yeni ask kolunda, eski partnerin yuzu dusun / herkesin onunde kuculur.",
  "Anlatici birinci tekilde aktarsin ('tokat atti', 'iti', 'kapiyi carpti' — sahne olarak soyle). 'Isim:' etiketi YOK.",
  "Kontrollu siddet + sozel ezme SERBEST (tokat/itme/kapi); kan/silah YASAK. Surekli bagirma monoton — YASAK.",
].join(" ");

/** Iliski dramasi: geri kazanış / hesap sorma formulu. */
export const NARRATOR_HARD_CONFLICT_STORY_LOCK = [
  "ILISKI KISA DRAMASI — GERI DONUS / HESAP SORMA:",
  "Omurga: asagilanma/ezme → sakin yikici karar → zaman/guc atlamasi → gosterisli donus (ustunluk tersine) → pismanlik.",
  "Izleyici kahramanla yanip tutussun; ihanet edene kisa sure empati verme.",
  "Gorselde: luks mekan, yukaridan bakis, tokat/itme/kapi, dugun flashback, ofis/araba tezatı, donuste yeni stil/yeni partner. Yumusak hüzün şiiri YASAK.",
].join(" ");

/** Iliski / ev dramasi turleri: surukleyicilik kurallari bunlarda daha keskin. */
export const NARRATOR_DRAMA_GENRE_IDS: readonly NarratorGenreId[] = [
  "aldatma",
  "yasak-ask",
  "ihanet",
  "kiskanclik",
  "intikam",
  "bosanma",
  "aile-sirri",
  "kayinvalide",
  "hesap-sorma",
  "guclu-donus",
  "yeniden-dogus",
  "kadin-gelisimi",
  "gizli-kimlik",
  "sozlesmeli-evlilik",
  "yildirim-nikahi",
  "zengin-aile",
  "pismanlik",
  "trajik-ask",
  "aile-bagi",
  "ahlaki-ikilem",
  "romantik",
  "dram",
];

/**
 * YouTube izleyici tutma kilidi — iki formatin hikaye uretimine yapisir.
 * Izleyici "dur be ne olacak" diye kalmali; bolum gecislerinde askida birakma zorunlu.
 */
export const NARRATOR_YOUTUBE_RETENTION_LOCK = [
  "YOUTUBE IZLEYICI TUTMA (zorunlu — video sonuna kadar izletsin):",
  "ILK 15 SANIYE: 'dur be' kancasi — en sok cumle/goruntu one gelsin (ifsa ani, yikici karar, tersine donmus statu). Yavas giris YASAK.",
  "HER PERDE/BOLUM GECISI: mini-cliffhanger — cevapsiz soru veya yarida kesilen darbe ('kapi acildi ve...', 'telefondaki isim...'). Izleyici cevabi almak icin kalmali.",
  "ORTA: en az bir yon degistiren ifsa (yanlis suclama, gizli kimlik, ucuncu kisi) — tahmin edilen yol kirilsin.",
  "FINAL ONCESI: hikayenin EN BUYUK sorusu acik kalsin; final bu soruyu duygusal darbeyle kapatsin.",
  "KAPANIS: pismanlik + tek cumlelik yanki (izleyicinin aklinda kalacak soguk cumle).",
  "Bagirma/tokat/kapi carpma YERINDE patlar (aldatma ifsasi, hesap ani) — surekli degil; sessiz-yikici anlar da darbe sayilir.",
].join(" ");

/** Tur kimligi VEYA etiketi ("Aldatma") kabul eder. */
export function isNarratorDramaGenre(raw: string | null | undefined): boolean {
  return NARRATOR_DRAMA_GENRE_IDS.includes(resolveNarratorGenre(raw).id);
}

export const NARRATOR_GENRES: NarratorGenre[] = [
  {
    id: "aldatma",
    label: "Aldatma",
    tagline: "Sekreter, tercih, sakin bosanma, geri donus",
    storyPrompt:
      "TUR KILIDI — ALDATMA (NetShort): Es, ilk aska benzeyen sekreter/ucuncu kisiyi tercih eder. Kahraman SAKIN ama yikici karar verir (bosanma, 'cocuk senin degil', evi terk). Zaman atlamasi; kahraman guclu/yeni askli doner; eski es pismanlikta bogulur. Kanit: mesaj, otel, ofis samimiyeti. Yatak/porno YASAK. 18+.",
    topicSuggestions: [
      "Kocam, ilk askina benzeyen sekreterini bana tercih etti. Ofiste el ele gordum; o 'is yemegi' dedi. Ben sakince bosanma istedim ve karnimdaki bebegin ondan olmadigini soyledim. Bes yil sonra yeni askimla guclu donunce yuzu dustu — otel karti ve o gece her seyi baslatmisti.",
      "Esim telefonunda silinmis konusma ve otel rezervasyonu birakti. Yuzlesmede gulumsedi. Ben aglamadim; evraklari imzalattim. Uc yil sonra sirketimin acilisinda karsi karsiya geldik — yanımda baskasi vardi, o pismanlikla bakakaldi.",
    ],
  },
  {
    id: "ihanet",
    label: "Ihanet",
    tagline: "Guvenilen biri vurur, hesap sorulur",
    storyPrompt:
      "TUR KILIDI — IHANET (NetShort): Dost/kardes/ortak arkadan vurur (imza, para, sir). Kahraman once ezilir, sonra sakin hesap: ifsa, status cevirisi, pismanlik. Pişkin 'sen hak etmiyordun' sozu erken gelsin; finalde o soz geri donusun. 18+; yatak yok.",
    topicSuggestions: [
      "Abim ortak kasadan para cekti; noterde benim adiima sahte imza vardi. 'Sen zaten hak etmiyordun' dedi. Ben sessizce delilleri topladim. Bir yil sonra herkesin onunde ifsa ettim — yuzu ayni cumleyi yutkundu.",
      "En yakin arkadasim evimi satarken aliciyla anlasti. Imza ve para ortadayken gulumsedi. Ben mahkemede degil, onun yeni is acilisinda hesabi sordum; yanımda yeni ortaklarim vardi.",
    ],
  },
  {
    id: "yasak-ask",
    label: "Yasak ask",
    tagline: "Tabu bag, aile skandali, yikici secim",
    storyPrompt:
      "TUR KILIDI — YASAK ASK (NetShort + SOK): Iki YETISKIN tabu bag (uvey/kayin/esiniin kardesi). Aciga cikinca aile yikilir. Kahraman sakin ama yikici secim yapar; zamanla status/ask cevirisi. Yumusak siir YASAK. Cinsel/soyunuk tarif YASAK; mesaj, sofra, DNA, kapi yeter. HERKES 18+.",
    topicSuggestions: [
      "Evliyim; yasak bag esimim degil — onun kardesiyle. Sofrada ayak surtundu, silinen mesajlar cikti. Ben sakince evi terk ettim: 'Bu aile bitti.' Iki yil sonra baskasiyla guclu donunce herkes ayni masada sustu — DNA sonucu daha beterdi.",
      "Uvey babam (ikimiz de yetiskiniz). Mesajlar acilinca aile 'herkes biliyor' dedi. Ben aglamadim; sehri terk ettim. Donusumde yanımda yeni hayatım vardi — onlar pişmanlik ve skandalla kaldi.",
    ],
  },
  {
    id: "kiskanclik",
    label: "Kiskanclik",
    tagline: "Suphe, tercih, yikici netlik",
    storyPrompt:
      "TUR KILIDI — KISKANCLIK (NetShort): Suphe buyur; karsi taraf 'abartiyorsun' der. Twist: yanlis VEYA daha kotusu. Kahraman sakin netlikle ayrilir veya tuzak kurar; donuste status ustunlugu. 18+.",
    topicSuggestions: [
      "Telefon ters cevriliyordu; komsu 'baska arabada' dedi. O 'kiskancligin ucuz' dedi. Ben sessizce rezervasyon kodunu actim — otelde iki isim. Bosanma kagidini masaya biraktim; bir yil sonra onun ofisinde musteri olarak durdum.",
      "Is yemegi iki kisilikti. Kapida bekledim; iceride gulusmeler. Ertesi gun esyalarimi aldim. Uc yil sonra ayni restoranda yanımda baskasi vardi — o camdan bizi gordü.",
    ],
  },
  {
    id: "intikam",
    label: "Intikam",
    tagline: "Ezilme, guclenme, hesap sorma",
    storyPrompt:
      "TUR KILIDI — INTIKAM (NetShort hesap sorma): Once public asagilanma. Sonra sessiz guclenme (para, kanit, yeni ittifak). Donuste ifsa + pismanlik. Cinayet/iskence pornosu YASAK. 18+.",
    topicSuggestions: [
      "Ortagim beni isten atti; herkese 'kendisi birakti' dedi. Ben kayitlari biriktirdim. Bir yil sonra onun yatırımcı toplantısında ekranı actim — yuzu dustu, ben kapidan gulumseyerek ciktım.",
      "Eski esim birikimimi aldi, beni 'deli' ilan etti. Avukat yetmedi; kanit ve timing yetti. Mahkeme degil, onun yeni dugun salonunda hesap soruldu — sessiz, yikici.",
    ],
  },
  {
    id: "bosanma",
    label: "Bosanma",
    tagline: "Imza, soguk karar, sonra ustun donus",
    storyPrompt:
      "TUR KILIDI — BOSANMA (NetShort): Imza oncesi son darbe sozu. Kahraman sakin imzalar. Zaman atlamasi; hayatı güzellesir, eski es batmistir veya yalvarir. Cocuk sahnede yok. 18+.",
    topicSuggestions: [
      "Bosanma kagidi mutfak masasinda. O 'sen hicbir sey degilsin' dedi. Ben imzaladim, anahtari biraktim. Dort yil sonra eski evimizin onunden yeni arabamla gectim — o kira evindeydi.",
      "Cuma 'gidiyorum' dedi. Ben aglamadim; pazartesi evraklar hazirdi. Iki yil sonra ortak arkadas dugununde yanımda baskasi vardi; o tek basina baktı.",
    ],
  },
  {
    id: "aile-sirri",
    label: "Aile sirri",
    tagline: "Gizli hayat, acilan kutu, secim",
    storyPrompt:
      "TUR KILIDI — AILE SIRRI (NetShort): Ikinci hayat, sahte babalik, gizli evlilik. Sir acilinca kahraman sakin mesafe koyar; sonra kendi gucuyle doner. 'Herkes biliyor' pişkinligi erken gelsin. 18+.",
    topicSuggestions: [
      "Annemin cekmecesinde ikinci evlilik cuzdani. 'Amcam' dedigim adam — yasak bag. Sofrada 'herkes biliyor' dediler. Ben evi terk ettim. Donusumde kendi param, kendi adım vardi; onlar skandalla kaldi.",
      "Esimin ikinci telefonunda baska sehir kira sozlesmesi. Sir acilinca gulumsedi. Ben sessizce cektim; uc yil sonra ayni sehirde sirketimle karsilastim — yanımda yeni ortaklarim, o pismanlikla bakakaldi.",
    ],
  },
  {
    id: "kayinvalide",
    label: "Kayinvalide / aile baskisi",
    tagline: "Ezme, 'ya biz ya o', guclu donus",
    storyPrompt:
      "TUR KILIDI — AILE BASKISI (NetShort): Kayinvalide/aile ezer ('sen kadin degilsin'). Esim susar veya taraf. Kahraman sakin ayrilir; zamanla guclu doner — aile ezilmis bakakalir. 18+.",
    topicSuggestions: [
      "Kayinvalidem dolabimi bosaltti: 'Sen kadin degilsin.' Esim sustu. Ben o gece valizi aldim. Iki yil sonra eski salonlarinda davetliydim — yanımda kendi isimligim vardi.",
      "Tapu kayinpederde, her pazar asagilama. 'Ya biz ya o.' Ben 'o'yu sectim: kendimi. Donuste eski evlerinin kapisinda degil, kendi ofisimde hesap sordum.",
    ],
  },
  {
    id: "hesap-sorma",
    label: "Hesap sorma",
    tagline: "Iyilik gasbedildi, kalem kalem odenecek",
    netShortTags: ["Hesap Sorma", "İntikam", "Yasal Adalet"],
    storyPrompt:
      "TUR KILIDI — HESAP SORMA (NetShort ana turu): Kahramanin iyiligi/emegi/organi/parasi gasbedilir (bobrek, tekne, imza, sirket). Gasp eden pişkin USTUN durur: 'sen zaten hak etmiyordun'. Kahraman aglamaz — sessiz delil biriktirir. Final: herkesin onunde KALEM KALEM hesap (toplanti, dugun, aile sofrasi); gasp edenin yuzu duser, pismanlik geri getirmez. 18+; kan/silah yok.",
    topicSuggestions: [
      "Ablama bobregimi verdim; iyilesince beni evden atti, mirasi uzerine gecirdi. 'Sen zaten fazlaliktin' dedi. Ben sessizce belgeleri topladim. Iki yil sonra noterde karsilastik — tapu, kayitlar ve doktor raporu masadaydi. Bu kez kalem kalem odedi.",
      "Ortagim teknemi 'emanet' aldi, sirketi uzerine gecirdi. Herkese 'o zaten batiriyordu' dedi. Bir yil sessiz kaldim; yatirimci toplantisinda imza kayitlarini actim. Ayni cumleyi yutkundu — 'sen hak etmiyordun' diyememisti.",
    ],
  },
  {
    id: "guclu-donus",
    label: "Guclu donus",
    tagline: "Hor gorulen, maskeyi yirtar",
    netShortTags: ["Güçlü Dönüş", "Diriliş ve Zafer", "Beklenmedik Dönüş"],
    storyPrompt:
      "TUR KILIDI — GUCLU DONUS (NetShort): Kahraman herkesin onunde hor gorulur, surulur veya silinir. Sessiz guclenme (para, itibar, ittifak, gizli miras). DONUS gosterisli: ayni salon, ayni insanlar — bu kez herkes ayaga kalkar; ezenler kuculur. 'Beni kim sandiginizi gordunuz' ruhu. Pismanlik yalvarir, kahraman soguk. 18+.",
    topicSuggestions: [
      "Dugunumde terk edildim; salondaki herkes guldu. Sehri terk ettim. Bes yil sonra ayni salona davetli degil, SAHIBI olarak girdim — beni terk eden adam vale fisini bana uzatti, eli titredi.",
      "Sirketten 'yetersiz' diye atildim; kutumu tasirken guvenlik esyalarimi dokturdu. Uc yil sonra o sirketi satin alan fonun basindaydim. Ilk toplantida ayni guvenlik kapiyi actı — bu kez basini egdi.",
    ],
  },
  {
    id: "yeniden-dogus",
    label: "Yeniden dogus",
    tagline: "Ikinci sans, bu kez kurallar farkli",
    netShortTags: ["Yeniden Doğuş", "Beklenmedik Dönüş", "Kadın Gelişimi"],
    storyPrompt:
      "TUR KILIDI — YENIDEN DOGUS (NetShort, modern): Kahraman hayatinin enkazindan (ihanet, iflas, terk) ikinci sansla doner — bu kez ayni hatalari YAPMAZ: once kariyer/gurur, eski sevgili/aile altta. Eski hayat karsisina cikinca sakin ve net: 'O ben artik yok.' Fantastik reenkarnasyon yerine gercekci sifirdan kurulus. 18+.",
    topicSuggestions: [
      "Her seyimi esime yazdirmistim; bosanmada sifir kaldim. O gece kendime soz verdim. Kucuk bir tezgahtan sirkete uc yil — eski esim is gorusmesine geldiginde masanin diger tarafinda ben vardim. 'Eski gunlerin hatrina' dedi. 'O gunler bitti' dedim.",
      "Iflasta herkes kacti; bir tek ben kaldim. Enkazdan marka cikardim. Eski ortaklarim yatirim istemeye geldiginde ayni kafede bulustuk — bu kez hesabi ben odemedim.",
    ],
  },
  {
    id: "kadin-gelisimi",
    label: "Kadin gelisimi",
    tagline: "Ezilen kadin, kendi ayaklarinda yukselir",
    netShortTags: ["Kadın Gelişimi", "Güçlenme ve İntikam", "Kariyer Yaşamı"],
    storyPrompt:
      "TUR KILIDI — KADIN GELISIMI (NetShort): Kahraman kadin; ev/aile/is hayatinda sistematik ezilir ('sen yapamazsin', 'kadin basina'). Kirilma aninda sakin karar: kendi isini/hayatini kurar. Yukselis somut adimlarla (ilk musteri, ilk dukkan, ilk manset). Ezenler donuste kucuk kalir; kahraman kimseye donmek zorunda degil. Erkek dusmanligi yok — mesele guc dengesi. 18+.",
    topicSuggestions: [
      "Kocam 'senin maasin benim cebimde durur' derdi. Bosanmada cantami bile birakti. Mutfakta baslayan pasta siparisleri uc yilda zincir oldu. Eski kayinvalidem subeme is basvurusu yaptiginda formu ben okudum.",
      "Babam okutmadi, abim calistirmadi, esim 'evinde otur' dedi. Gece kurslari, gizli birikim, kucuk bir dukkan. Acilis gunu hepsi kapidaydi — kurdeleyi ben kestim, makasi kimseye vermedim.",
    ],
  },
  {
    id: "gizli-kimlik",
    label: "Gizli kimlik",
    tagline: "Sofor sanilan patron, dilenci sanilan varis",
    netShortTags: ["Gizli Kimlik", "Yanlış Kimlik", "Servet ve Başarı"],
    storyPrompt:
      "TUR KILIDI — GIZLI KIMLIK (NetShort klasigi): Kahraman ASLINDA guclu (CEO, varis, patron) ama sade gorunur (sofor, temizlikci, kurye, dilenci). Cevre onu ezer, asagilar, kovar. Kriz aninda kimlik ACILIR: korumalar, imza yetkisi, mansetler. Ezenler tasla kalir; samimi davranan tek kisi odullenir. Kimlik acilisi finale yakin — erken harcama. 18+.",
    topicSuggestions: [
      "Sirkete sofor olarak girdim — kimse bilmiyordu, sirket benimdi. Muduru calisanlari ezerken izledim; beni de kovdu. Ertesi sabah yonetim kurulunda kimin oturdugunu gorunce kahvesi elinden dustu.",
      "Kuzenimin dugununde 'kapida dur, ayip olmasin' dediler — kurye kiyafetimle gelmisim. Nikah masasindaki otel benim cikinca once kimse inanmadi. Hesabi isteyen kayinpedere fisi ben imzaladim.",
    ],
  },
  {
    id: "sozlesmeli-evlilik",
    label: "Sozlesmeli evlilik",
    tagline: "Kontrat sogugu, beklenmedik bag",
    netShortTags: ["Sözleşmeli Aşk", "Önce Evlilik Sonra Aşk", "Zoraki Aşk"],
    storyPrompt:
      "TUR KILIDI — SOZLESMELI EVLILIK (NetShort): Iki yetiskin cikar icin evlenir (miras sarti, sirket birlesmesi, borc, gorunum). Kurallar nettir: 'duygu yok'. Birlikte yasam buzlari eritir — ama tam o anda eski sevgili/aile krizi patlar: 'o seni para icin aldi'. Final: sozlesme yirtilir — ya gercek ask ya sakin ayrilik + status cevirisi. Yatak sahnesi yok; ayri odalar, kiyafetli. 18+.",
    topicSuggestions: [
      "Dedemin vasiyeti: alti ayda evlilik, yoksa miras vakfa. Is ortagimla kagit ustunde evlendik — kural: duygu yok. Kurali once o bozdu sandim; megerse sozlesmeye 'gercek olursa gecersizdir' maddesini o eklemis.",
      "Borcumu kapatan adamla anlasmali evlendim; herkes 'satildi' dedi. Bir yil rol yaptik. Eski sevgilim dugunumuzu basip 'o seni sozlesmeyle aldi' diye bagirdiginda kocam sozlesmeyi herkesin onunde yirtti.",
    ],
  },
  {
    id: "yildirim-nikahi",
    label: "Yildirim nikahi",
    tagline: "Ani evlilik, sonra gercekler",
    netShortTags: ["Yıldırım Nikahı", "Önce Evlilik Sonra Aşk", "Tek Gecelik Aşk"],
    storyPrompt:
      "TUR KILIDI — YILDIRIM NIKAHI (NetShort): Taniskligin ilk gunlerinde ani nikah (inat, kacis, sarhos cesaret, aileye rest). Sonra gercekler acilir: es sanildigi kisi degil (daha guclu VEYA tehlikeli sir). Cevre 'iptal et' baskisi yapar; kahraman kendi gozüyle karar verir. Final: ya derin bag ya sakin cikis + ustunluk. 18+; yatak yok.",
    topicSuggestions: [
      "Nisanlim dugun gunu kacinca inadima, o gun tanistigim adamla nikah masasina oturdum. 'Pisman olacaksin' dediler. Alti ay sonra eski nisanlim kapima geldiginde kocamin kim oldugunu ogrendi — pisman olan ben degildim.",
      "Aileme rest cekip bir haftalik taniskla evlendim. Kucuk bir esnaf sandigim esim, dugun fotograflarimiz mansete dusunce holding varisi cikti. Asil sok: ailem onu yillardir taniyordu.",
    ],
  },
  {
    id: "zengin-aile",
    label: "Zengin aile drami",
    tagline: "Miras, hissedar oyunu, ask ucgeni",
    netShortTags: ["Zengin Aile Dramı", "Aşk Üçgeni", "Servet Mücadelesi", "Saray Entrikaları"],
    storyPrompt:
      "TUR KILIDI — ZENGIN AILE DRAMI (NetShort): Holding ailesi; miras/hisse savasi, gelin-kaynana cephesi, ask ucgeni. Kahraman 'disaridan gelen' — ezilir, kumpasa dusurulur (sahte skandal, calinti imza). Sessiz ittifak + delil. Final hissedar toplantisi/aile yemegi: kumpas ifsa olur, taht el degistirir. Luks gorunur (malikane, limuzin) ama duygu gercek. 18+.",
    topicSuggestions: [
      "Holding varisiyle evlendim; gorumcem 'bu aileye tirnakla girdin' dedi ve imzami taklit edip zimmet kurdu. Sessizce noter kayitlarini topladim. Yilsonu toplantisinda dosyayi actim — kayinpederim once bana, sonra kizina bakti. Taht o gun el degistirdi.",
      "Iki kardes ayni anda talip oldu; ben kucuk sanilan sirketi seceni sectim. Dugunde buyuk kardes 'yanlis ata oynadin' dedi. Uc yil sonra kucuk sirket holdingi satin aldi — masada damat degil, patron oturuyordu.",
    ],
  },
  {
    id: "pismanlik",
    label: "Pismanlik",
    tagline: "Terk eden yalvarir, geri getiremez",
    netShortTags: ["Pişmanlık", "Zorlu Geri Kazanış", "Beklenmedik Dönüş"],
    storyPrompt:
      "TUR KILIDI — PISMANLIK (NetShort): Kahraman terk edilir/harcanir; karsi taraf o an pişkin ('daha iyisini buldum'). Zaman atlamasi: kahraman parlar, terk eden batar. Ikinci yari PISMANLIK SEYRI: yalvarma, kapida bekleme, 'bir sans daha'. Kahraman SOGUK: 'Cok gec.' Izleyici tatmini yalvaris sahnelerinde — uzat ama bagirtma. Final: kahraman kendi hayatina yurur. 18+.",
    topicSuggestions: [
      "Nisanlim beni herkesin icinde birakti: 'Sen sıradansın.' Kendi markami kurdum; o sirketini batirdi. Simdi her hafta magazamin kapisinda — dun cicek, bugun mektup. Cevabim ayni: 'Siradan biri icin cok ugrasiyorsun.'",
      "Esim 'ilham perisi' dedigi ortagiyla gitti. Iki yil sonra ortagi onu dolandirinca kapima geldi, yagmurda bekledi. Kapiyi actim — elinde valiziyle icimden gecti: ben de boyle beklemistim. Kapiyi kapattim.",
    ],
  },
  {
    id: "trajik-ask",
    label: "Trajik ask",
    tagline: "Buyuk ask, acimasiz engel",
    netShortTags: ["Trajik Aşk", "Karşılıklı Aşk", "Yaş Farklı Aşk"],
    storyPrompt:
      "TUR KILIDI — TRAJIK ASK (NetShort): Iki yetiskinin buyuk aski; engel acimasiz (aile dusmanligi, sinif farki, hastalik, eski borc). Ask kacamak degil onurlu — el ele tutusma, mektup, bekleyis. Kirilma ani: biri digerini KORUMAK icin birakir; gercek yillar sonra acilir. Final buruk-guclu: kavusma VEYA onurlu veda + iz birakan cumle. Melodram siiri degil; sahne sahne olay. 18+.",
    topicSuggestions: [
      "Babasi sirketimizi batiran adamdi; biz iki dusman evin cocuklariyduk. Dugunumuzden bir gece once ortadan kayboldu, 'sevmiyorum' notunu birakti. On yil sonra hastane koridorunda ogrendim: o gece babam onu tehdit etmis. Elimdeki cicekler ona degil, artik esime aitti.",
      "Ona 'bekle beni' dedim, yurtdisina ciktim. Mektuplarim hic ulasmadi — annesi saklamis. Dondugumde baskasinin nikahindaydi. Yillar sonra annesinin cenazesinde kutu dolusu mektubumu bana geri verdi: 'Hepsini dun okudum.'",
    ],
  },
  {
    id: "aile-bagi",
    label: "Aile bagi",
    tagline: "Kayip aile, gec kavusma, bedel",
    netShortTags: ["Aile Bağı", "Kayıp Ailesini Arama", "Aile Dramı"],
    storyPrompt:
      "TUR KILIDI — AILE BAGI (NetShort): Kayip/degistirilen evlat, yillar sonra bulunan anne, huzurevine atilan baba. Duygusal cekirdek: 'ait oldugum yer neresi'. Sahte aile pişkin ('biz seni buyuttuk'), gercek bag sessiz ve derin. Kavusma sahnesi buyuk ama abartisiz — bir esya (kolye, fotograf, ninni) baglari acar. Hesap sorulacaksa sakin sorulur. Cocuk karakter sahnede YOK; herkes yetiskin. 18+.",
    topicSuggestions: [
      "Huzurevindeki adam her hafta ayni ninni melodisini mirildaniyordu — benim bebekken kaydedildigim ninniyi. DNA sonucu cikinca 'oglum oldu' diyen ailem sustu: beni hastaneden degistirmislerdi. Gercek babam otuz yil beni sokak sokak aramis.",
      "Annem oldu sanmistim; mezar bile vardi. Taziye defterinde ayni el yazisini gorunce dunyam durdu. Yasiyordu — babam 'terk etti' diye buyutmustu, megerse kapidan kovmustu. Ilk kahvemizi altmis yasinda ictik.",
    ],
  },
  {
    id: "ahlaki-ikilem",
    label: "Ahlaki ikilem",
    tagline: "Iki dogru, tek secim, bedel",
    netShortTags: ["Aile Dramı", "Yasal Adalet", "Ofis Aksiyon"],
    storyPrompt:
      "TUR KILIDI — AHLAKI IKILEM (NetShort): Kahraman iki 'dogru' arasinda sikisir: kardesini ihbar etmek vs ailesini korumak; sirketi kurtarmak vs masumu harcamak. Secimin BEDELI gercek — kolay cikis yok. Karsi taraf 'aile boyle ister' pişkinligiyle bastirir. Kahraman vicdanini secer; kisa vadede kaybeder, finalde onurlu ustunluk. Vaaz yok — olay konussun. 18+.",
    topicSuggestions: [
      "Abimin sirket kasasindan para cektigini muhasebede ben yakaladim. Annem 'aileni satma' dedi, esim 'sus, evimiz yanar' dedi. Sustum — ta ki abim sucu masum bir stajyere atana kadar. O gun ifademi verdim; aile beni sildi, vicdanim beni buyuttu.",
      "Patronum 'raporu degistir, herkes maasini alsin' dedi. Degistirmedim; fabrika kapandi, herkes issiz kaldi — benim yuzumden dediler. Iki yil sonra ayni rapor mahkemede yuzlerce isciyi tazminatina kavusturdu. O gun kimse ozur dilemedi ama herkes anladi.",
    ],
  },
  {
    id: "gizem",
    label: "Gizem",
    tagline: "Ipuclari, sok cevap, duygusal darbe",
    storyPrompt:
      "TUR KILIDI — GIZEM (NetShort dokunus): Erken acma. Cevap ihanet/tabu/ikinci kimlik olsun. Acilis flashback tezatı; final duygusal darbe. Jump-scare yok. 18+.",
    topicSuggestions: [
      "Bos odadan kapi sesi, eski kiracinin mektubu. Cevap yasak bir aile bagiydi. Sofrada herkes sustu; ben sakince masadan kalktim — bir daha oturmadim.",
      "Babanin cekmecesinde silinmis numara. Gece arandi. Ikinci kimlik ve ihanet ortaya cikti. Ofiste yuzlesme: o pişmanlikla bakti, ben net bir kararla uzaklastim.",
    ],
  },
  {
    id: "gerilim",
    label: "Gerilim",
    tagline: "Tehdit, zaman baskisi, yuzlesme",
    storyPrompt:
      "TUR KILIDI — GERILIM (NetShort tempo): Tehdit artsin, zaman daralsin. Twist tanidik yuz. Finalde sakin veya sert yuzlesme; kanli iskence YASAK. 18+.",
    topicSuggestions: [
      "Siyah araba uc gece kapida bekledi. Not: 'Biliyoruz.' Tehdit, eski ortagimdi. Toplantida kanitlari actim — o boguldu, ben kapidan gulumseyerek ciktım.",
      "Arkamdan ayni yuz her sabah. Kartvizit masada. Yuzlesmede aileden biri cikti; sakin tehdidim ve toplanmis kayitlar yetti — o geri cekildi.",
    ],
  },
  {
    id: "dram",
    label: "Dram",
    tagline: "Kayip, karar, status cevirisi",
    storyPrompt:
      "TUR KILIDI — DRAM (NetShort): Tek omurga. Kayip veya ihanet sonrasi sakin karar + zamanla guclenme. Yumusak melodram şiiri YASAK. 18+.",
    topicSuggestions: [
      "Babanin mektubu baskasina yazilmisti. Sir aileyi bir anda yikti. Ben evi terk ettim; donusumde kendi adima bir hayat ve yeni itibar vardi.",
      "Yirmi yillik dost hastanede yatti. Evde bir ifsa kaydi buldum. Aglamadim; kaydi dinlettim — sonra kapıyı kapattım ve o sehirden ciktım.",
    ],
  },
  {
    id: "gercek-yasam",
    label: "Gercek yasam",
    tagline: "Para, kira, gurur, kucuk zafer",
    storyPrompt:
      "TUR KILIDI — GERCEK YASAM (NetShort dokunus): Kira, asagilama, sessiz karar, sonra kucuk ama net zafer (yeni is, yeni ev). Mucize yok. 18+.",
    topicSuggestions: [
      "Kira gecikti; 'hicbir ise yaramazsin' dedi. Ben gece vardiyasina girdim. Bir yil sonra kira kontratı benim adıma — o sustu, ben kapıyı kapattım.",
      "Veresiye defterinde kirmizi bir cizgi. O gece kavga. Uc ay sonra defteri kapattım; kendi dukkanimin anahtarı cebimdeydi ve o artik musteriydi.",
    ],
  },
  {
    id: "romantik",
    label: "Romantik",
    tagline: "Yakinlasma, ihanet soku, secim",
    storyPrompt:
      "TUR KILIDI — ROMANTIK (NetShort): Yakinlasma + ihanet/tabu darbe. Tatli final zorlama; sakin secim veya donus. Cinsel sahne yok. 18+.",
    topicSuggestions: [
      "Ayni durakta her sabah. Kahve, yagmur — sonra yuzugunde kardesimin adi. 'Ne var yani' dedi. Ben o duraga bir daha inmedim; bir yil sonra baskasiyla gectim.",
      "Eski sevgili asansorde, yeni yuzuk. Bir kahve teklifi, bir ifsa. Ben 'hayir' dedim — soguk ve net; bir yil sonra ayni binada yanımda baskasi vardi.",
    ],
  },
  {
    id: "korku",
    label: "Korku",
    tagline: "Tekinsiz ev, insan skandali",
    storyPrompt:
      "TUR KILIDI — KORKU: Tekinsiz ev + acilan insan skandali (sir, ihanet). Final duygusal/sakin yuzlesme. Kan seli YASAK. 18+.",
    topicSuggestions: [
      "Kiraci anahtari birakti ve dedi: 'Merdiven konusuyor.' Sir yasak bir bagdi. Sofrada yuzlesme; ben evi sattım ve o sehirdeki herkes sustu.",
      "Buyukanne evi. Dolap aciliyor. Sir aile skandali — 'herkes biliyordu.' Ben kapıyı kilitledim ve sehri terk ettim; donusumde kendi param vardi.",
    ],
  },
  {
    id: "ozel",
    label: "Ozel",
    tagline: "Kendi turunu yaz",
    storyPrompt: "",
    topicSuggestions: [],
  },
];

const ALIASES: Record<string, NarratorGenreId> = {
  aldatma: "aldatma",
  ihanet: "ihanet",
  "yasak ask": "yasak-ask",
  "yasak-ask": "yasak-ask",
  yasakask: "yasak-ask",
  kiskanclik: "kiskanclik",
  kıskançlık: "kiskanclik",
  intikam: "intikam",
  bosanma: "bosanma",
  boşanma: "bosanma",
  "aile sirri": "aile-sirri",
  "aile-sirri": "aile-sirri",
  kayinvalide: "kayinvalide",
  kayınvalide: "kayinvalide",
  "hesap sorma": "hesap-sorma",
  "hesap-sorma": "hesap-sorma",
  hesapsorma: "hesap-sorma",
  "guclu donus": "guclu-donus",
  "guclu-donus": "guclu-donus",
  "güçlü dönüş": "guclu-donus",
  "dirilis ve zafer": "guclu-donus",
  "diriliş ve zafer": "guclu-donus",
  "yeniden dogus": "yeniden-dogus",
  "yeniden-dogus": "yeniden-dogus",
  "yeniden doğuş": "yeniden-dogus",
  "kadin gelisimi": "kadin-gelisimi",
  "kadin-gelisimi": "kadin-gelisimi",
  "kadın gelişimi": "kadin-gelisimi",
  "guclenme ve intikam": "kadin-gelisimi",
  "gizli kimlik": "gizli-kimlik",
  "gizli-kimlik": "gizli-kimlik",
  "yanlis kimlik": "gizli-kimlik",
  "sozlesmeli evlilik": "sozlesmeli-evlilik",
  "sozlesmeli-evlilik": "sozlesmeli-evlilik",
  "sözleşmeli evlilik": "sozlesmeli-evlilik",
  "sozlesmeli ask": "sozlesmeli-evlilik",
  "sözleşmeli aşk": "sozlesmeli-evlilik",
  "zoraki ask": "sozlesmeli-evlilik",
  "once evlilik sonra ask": "sozlesmeli-evlilik",
  "önce evlilik sonra aşk": "sozlesmeli-evlilik",
  "yildirim nikahi": "yildirim-nikahi",
  "yildirim-nikahi": "yildirim-nikahi",
  "yıldırım nikahı": "yildirim-nikahi",
  "zorunlu evlilik": "yildirim-nikahi",
  "zengin aile": "zengin-aile",
  "zengin-aile": "zengin-aile",
  "zengin aile drami": "zengin-aile",
  "zengin aile dramı": "zengin-aile",
  "ask ucgeni": "zengin-aile",
  "aşk üçgeni": "zengin-aile",
  pismanlik: "pismanlik",
  pişmanlık: "pismanlik",
  "beklenmedik donus": "pismanlik",
  "beklenmedik dönüş": "pismanlik",
  "zorlu geri kazanis": "pismanlik",
  "trajik ask": "trajik-ask",
  "trajik-ask": "trajik-ask",
  "trajik aşk": "trajik-ask",
  "aile bagi": "aile-bagi",
  "aile-bagi": "aile-bagi",
  "aile bağı": "aile-bagi",
  "kayip ailesini arama": "aile-bagi",
  "ahlaki ikilem": "ahlaki-ikilem",
  "ahlaki-ikilem": "ahlaki-ikilem",
  "ahlaki ikilemler": "ahlaki-ikilem",
  gizem: "gizem",
  gerilim: "gerilim",
  dram: "dram",
  drama: "dram",
  sinema: "dram",
  "gercek yasam": "gercek-yasam",
  "gercek-yasam": "gercek-yasam",
  romantik: "romantik",
  korku: "korku",
  ozel: "ozel",
  özel: "ozel",
};

export function narratorGenreById(id: string): NarratorGenre {
  const found = NARRATOR_GENRES.find((g) => g.id === id);
  return found ?? NARRATOR_GENRES.find((g) => g.id === "ozel")!;
}

export function resolveNarratorGenre(raw: string | null | undefined): NarratorGenre {
  const value = (raw || "").replace(/\s+/g, " ").trim();
  if (!value) return narratorGenreById("dram");
  const lower = value.toLowerCase();
  const alias = ALIASES[lower];
  if (alias) return narratorGenreById(alias);
  const byId = NARRATOR_GENRES.find((g) => g.id === lower);
  if (byId) return byId;
  const byLabel = NARRATOR_GENRES.find((g) => g.label.toLowerCase() === lower);
  if (byLabel) return byLabel;
  return {
    ...narratorGenreById("ozel"),
    label: value,
    storyPrompt: narratorCustomGenreStoryPrompt(value),
  };
}

/** Kullanicinin yazdigi ozel tur adi hikayenin omurgasi olsun — katalog turune kaymasin. */
export function narratorCustomGenreStoryPrompt(value: string): string {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || /^(ozel|özel)$/i.test(name)) return "";
  return [
    `TUR KILIDI — OZEL: Kullanicinin yazdigi tur adi "${name}".`,
    `Hikayenin KONUSU, CAKISMASI, kisileri ve SONUCU bu kelimeye gore gelsin. "${name}" dekor degil, omurganin kendisi.`,
    `Katalog turune (aldatma / ihanet / belgesel / gizem) kayma YASAK; yalnizca "${name}" o motifi zorunlu kiliyorsa kullan.`,
    `NetShort tempo durabilir (sakin yikici karar → zaman/guc atlamasi → donus → pismanlik) ama ANA TEMA "${name}" olsun.`,
  ].join(" ");
}

export function narratorGenreStoryBlock(raw: string | null | undefined): string {
  const genre = resolveNarratorGenre(raw);
  let block = genre.storyPrompt;
  if (genre.id === "ozel" && !genre.storyPrompt) {
    block = narratorCustomGenreStoryPrompt(raw || genre.label);
  }
  const parts = [
    block,
    NARRATOR_SHORT_DRAMA_LOCK,
    NARRATOR_NETSHORT_INTRIGUE_LOCK,
    NARRATOR_YOUTUBE_RETENTION_LOCK,
    NARRATOR_NETSHORT_TEMPO_LOCK,
    NARRATOR_NETSHORT_SHOT_CRAFT_LOCK,
    NARRATOR_NETSHORT_POWER_LOCK,
    NARRATOR_NETSHORT_FEMALE_LOOK_LOCK,
    NARRATOR_MOCKING_DIALOGUE_LOCK,
    NARRATOR_NETSHORT_VISUAL_LOCK,
    NETSHORT_CORPUS_STORY_LOCK,
    NETSHORT_CRUELTY_STORY_LOCK,
    NETSHORT_CORPUS_VISUAL_BEATS,
    netShortEmotionPaletteBlock(),
    NETSHORT_GENRE_ATLAS_LOCK,
    formatNetShortGenreAtlasForPrompt(10),
    // Secili turun atlas etiketlerine gore ozet ruhu ornekleri (isim CALMA)
    netShortSummaryPromptBlock({ samples: 4, genreHints: genre.netShortTags }),
    netShortBeatsPromptBlock(10),
  ];
  if (isNarratorHardConflictGenre(genre.id)) {
    parts.push(NARRATOR_HARD_CONFLICT_STORY_LOCK);
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * Hikaye / konu uretiminin SYSTEM promptu — model burayi user'dan daha cok dinler.
 * Klip NetShort kilitleriyle AYNI omurga, duygu paleti, ozet bankasi, beat ve tempo.
 */
export function narratorNetShortStorySystemLock(raw?: string | null): string {
  const genre = resolveNarratorGenre(raw);
  return [
    "NETSHORT HIKAYE SISTEM KILIDI — hikaye NetShort kisa dikey dram FILMLERI gibi yazilsin (klip promptlariyla AYNI omurga/duygu/tempo):",
    NARRATOR_SHORT_DRAMA_LOCK,
    NARRATOR_NETSHORT_INTRIGUE_LOCK,
    NARRATOR_NETSHORT_TEMPO_LOCK,
    NARRATOR_NETSHORT_SHOT_CRAFT_LOCK,
    NARRATOR_NETSHORT_POWER_LOCK,
    NARRATOR_MOCKING_DIALOGUE_LOCK,
    NETSHORT_CORPUS_STORY_LOCK,
    NETSHORT_CRUELTY_STORY_LOCK,
    netShortEmotionPaletteBlock(),
    NETSHORT_GENRE_ATLAS_LOCK,
    formatNetShortGenreAtlasForPrompt(8),
    netShortSummaryPromptBlock({ samples: 4, genreHints: genre.netShortTags }),
    netShortBeatsPromptBlock(10),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Film plani icin INCE tur kilidi — hikaye blogundaki 243 ozet / atlas dokumunu TASIMAZ.
 * (Aksi halde her klip partisi dakika mertebesinde surer.)
 */
export function narratorGenreFilmBlock(raw: string | null | undefined): string {
  const genre = resolveNarratorGenre(raw);
  let block = genre.storyPrompt;
  if (genre.id === "ozel" && !genre.storyPrompt) {
    block = narratorCustomGenreStoryPrompt(raw || genre.label);
  }
  const parts = [
    block,
    NARRATOR_SHORT_DRAMA_LOCK,
    NARRATOR_NETSHORT_INTRIGUE_LOCK,
    NARRATOR_NETSHORT_TEMPO_LOCK,
    NARRATOR_NETSHORT_SHOT_CRAFT_LOCK,
    NARRATOR_NETSHORT_POWER_LOCK,
    NARRATOR_NETSHORT_FEMALE_LOOK_LOCK,
    NARRATOR_NETSHORT_VISUAL_LOCK,
    NETSHORT_CORPUS_VISUAL_BEATS,
    netShortBeatsPromptBlock(6),
    netShortSummaryPromptBlock({ samples: 1, genreHints: genre.netShortTags }),
  ];
  if (isNarratorHardConflictGenre(genre.id)) {
    parts.push(NARRATOR_HARD_CONFLICT_STORY_LOCK);
  }
  return parts.filter(Boolean).join("\n");
}

export function narratorGenreLabel(id: string, custom = ""): string {
  if (id === "ozel") return custom.replace(/\s+/g, " ").trim() || "Ozel";
  return narratorGenreById(id).label;
}

export function narratorGenreTopicSuggestions(id: string): string[] {
  return narratorGenreById(id).topicSuggestions;
}

export function isNarratorCatalogTopic(topic: string): boolean {
  const t = topic.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return NARRATOR_GENRES.some((g) => g.topicSuggestions.some((s) => s === t));
}

export function applyNarratorTopicSuggestion(
  genreId: string,
  currentTopic: string,
  forceRotate = false
): string {
  const list = narratorGenreTopicSuggestions(genreId);
  if (list.length === 0) return currentTopic;
  const cur = currentTopic.replace(/\s+/g, " ").trim();
  if (!cur) return list[0];
  if (!forceRotate && !isNarratorCatalogTopic(cur)) return cur;
  const idx = list.findIndex((s) => s === cur);
  if (idx < 0) return list[0];
  return list[(idx + 1) % list.length];
}

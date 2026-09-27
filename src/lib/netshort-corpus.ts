/**
 * NetShort kisa dikey dram — ozet corpus'undan cikarilmis DNA.
 * Kaynaklar: netshort.com TR (popular / all-episodes / full-episodes ozetleri).
 * Ornekler: Bu Bebek Senin Degil, Bay Big Bebek Sizin Degil, Bosanma Sonrasi Varis,
 * Unutulmus Evlilik, Ask Sozlesmesi, Hesap Sorma Zamani, Pismanlik Geri Getirmez,
 * Zenginligin Bedeli, Dostum Teknemi Caldi, Sahte Taki Gercek Ceza, vb. (40+ baslik).
 *
 * KURAL: 18+ yetiskin. Ergen/okul/zorbalik-yeniden-dogus YASAK (Beni Kullanan Adam tipi degil).
 */

/** Tek cumlelik trop bankasi — her hikaye 1 ANA + 1 YARDIMCI secer. */
export const NETSHORT_TROPES: readonly string[] = [
  "Sekreter / ilk aska benzeyen ucuncu kisi tercih edilir; es hor gorulur.",
  "Sakin yikici bosanma: 'Bu bebek senin degil' / dilekce masaya / anahtar birakilir.",
  "Zaman atlamasi (3-6-15 yil): kahraman guclu/yeni askli/varis olarak doner.",
  "Gizli varis: ertesi gun mansette; eski es 'onsuz yasayamaz' sanirken yuzu duser.",
  "Fedakarlik bedeli: bobrek, para, tekne, her sey — karsilik ihanet; sonra hesap.",
  "Sozlesmeli evlilik / anlasmali gelin: soguk kontrat → ask veya intikam cevirisi.",
  "Dugunde terk / asagilanma → gizemli milyarder veya yeni guclu ittifak.",
  "Fakir/dilenci/temizlikci koca veya es ASLINDA CEO / kahin / varis (gizli kimlik).",
  "Aile ATM: anne-kardes sahte hediye/para emer; kahraman delille ifsa + kopar.",
  "Ortak/dost iyiligi gasbeder (tekne, sirket, imza); kalem kalem hesap sorulur.",
  "Uvey aile surgunu (kirsal / yillar): donuste sirket koltugu / hissedar darbesi.",
  "Ilk ask iftira atar; es inanir; kahraman sessizce ceker — sonra status ustun.",
  "Pismanlik yalvarir ('affet', 'sans ver'); kahraman soguk: 'biz bittik' / yeni ask.",
  "Metres / ucuncu kisi herkesin onunde rezil; eski es bogulur.",
  "Hissedar toplantisi / ofis ifsasi / manset — public status cevirisi.",
  "Kimlik calinmis / sahte varis (yetiskinler); donuste maske yirtilir.",
  "Milyoner kocanin gizli ailesi / ikinci sehir / ikinci telefon.",
  "Hamile kacis veya hamilelik sirri (cocuk SAHNEDE YOK) — yetiskin kararlar.",
  "Yeniden dogus / ikinci sans: bu kez kariyer ve gurur once, eski sevgili altta.",
  "Herkesin onunde terk edip baskasiyla (daha guclu) evlenme — pismanlik geri getirmez.",
  "Servetin yarisi / 10 milyon kontrat teklifi; 'sen ciddi mi hissediyorsun?'",
  "Eski sevgili 'metres' der; kahraman keskin savunma + kocanin gizli gucu.",
  "Kayinvalide / aile baskisi: 'sen kadin degilsin' → sakin ayrilis → donus.",
  "DNA / gizli cocuk gercegi (yetiskin yuzlesme; cocuk kadrajda yok).",
  "Sahte imza / ortak kasa; 'sen hak etmiyordun' → ifsa.",
  "Hastane / kriz aninda metres tercih edilir; es o an karar verir.",
  "Sosyal medya karalama → delille karsi saldiri; aile bagini kesme.",
  "Isten atilma + iftira; bir yil sonra yatirimci masasinda hesap.",
  "Dugun flashback ↔ bugunku soguk araba / ofis tezatı.",
  "Luks magaza cikis → limuzin; icerde sekreter gulusu, disarida donuk bakis.",
  "Cliffhanger ruhu: 'onu geri kazanabilecek mi?' — film sonu yine de kapansin.",
  "Maske yirtma ani: tek cumleyle kimlik/guc acilir, salon susturur.",
  "Kiz kardes + nisanli ihaneti (yetiskin); surgun → sistem/guç → taht donusu.",
  "Nankorluk: her seyi veren hor gorulur; felaket gelince hesap kapanir.",
  "Zenginler listesi basligi / gizli kart / sahte fakirlik ifsasi.",
  "Yildirim nikah / zoraki yakinlastirma → sonra gercek duygu veya hesap.",
  "Gelin degisimi / sahte gelin (yetiskin) → pismanlik + zorlu geri kazanış.",
  "Ofis romantizmi ihaneti; 'is yemegi' yalani; rezervasyon kodu acilir.",
  "Bosanma sonrasi manset: varis / CEO / yeni imparatorluk.",
  "Yeni ask kolunda donus; eski partner camdan bakar, yuzu duser.",
  "Kontrollu intikam: bagirma yok, akilli tuzak + timing + kamuoyu.",
  "Luks otel tuzagi / sahte kaza / para odeme baskisi — kahraman oyunu bozar.",
  "Torpil / egitim / hediye arabasi geri alma — kalem kalem intikam.",
  "Cenaze / miras / uvey kardesler; donen lider aileyi ezer (yetiskin).",
  "Sozlesme yirtma: 'artik gercek evlilik' veya 'artik bitti' — net karar.",
  "Piskin gaslight: 'abartiyorsun', 'o sadece sekreter', 'herkes yapiyor'.",
  "Kahramanin sessiz gulusu donuste; karsi tarafin cirkin pismanlik aglami.",
  "Ucgen: es + sekreter + gizli gecmis (Elena tipi hayalet / ilk ask).",
  "Sehir gecesi, cam yansimasi, penthouse boslugu — zenginlik duygusal yokluk.",
  "Final tatmini: metres rezil + eski es pisman + kahraman secimini korur.",
  "Pismanlikla yalniz olum → zaman geri sarilir (ikinci sans); yanlis 'prenses' yerine gercek bag secilir — ama donuste hala asagilanma, kahraman yetisemez.",
  "Sahte aile sadece para pesinde; oz cocuk/gercek bag 'hic kimse' muamelesi gorur; gala/sirket payi dogru kisiye kaydirilir.",
] as const;

/** Duygu paleti — bagirma yagmuru degil; ozet bankasiyla birebir ruh. */
export const NETSHORT_EMOTIONS: readonly string[] = [
  "donuk asagilanma",
  "sakin yikici kararlilik",
  "pişkin kucumseme (ihanet eden)",
  "numb / 'bitti' netligi",
  "gizli planin soguk heyecani",
  "status zaferi (kontrollu gulus)",
  "pismanlik bogulmasi (yalvarma)",
  "flashback kirikligi (dugun ↔ simdi)",
  "kamusal rezalet gerilimi",
  "yeni askla guvenli sogukluk",
  "etki sonrasi tepki (goz kırılması)",
  "mikro-sok: dudak aralanir, nefes kesilir",
  "tercih ani: gulus baskasina, sirt donulur",
  "delil ani: kagit/telefon isigi yuzu degistirir",
  "hesap sorma tatmini (sakin, ustun)",
  "kamusal ezme / herkesin onunde kucultme",
  "fiziksel ustunluk (itme, tokat, kapi carpma)",
  "pişkin hakimiyet bakisi (yukaridan)",
  "donuste soğuk intikam ustunlugu",
  // --- Seslendirme paleti genisletmesi ---
  // Anlatim duz kalmasin: her etiket TTS'te ayri bir oyunculuk profiline
  // baglidir (bkz. src/lib/tts-performance.ts). Palet disi serbest etiket
  // yazilirsa ses sakin okur; bu yuzden yazar buradan secer.
  "bagirmaya yakin ofke (patlama esigi)",
  "hakaretle asagilama",
  "soguk kin (bastirilmis nefret)",
  "kararli ofke (bagirmadan sert)",
  "igrenme / tiksinti bakisi",
  "kibirli kucumseme",
  "piskin meydan okuma",
  "utanc / kamusal rezalet kizarmasi",
  "yakalanmis panik",
  "ihanet soku (donup kalma)",
  "dehset / nefes tutulmasi",
  "asagilanma yarasi",
  "duygusal darbe (icten kirilma)",
  "statu gerilimi",
  "gizli guc gerilimi",
  "ikilem acisi",
  "sessiz dayanma",
  "yalnizlik ve direnis",
  "hesap sorma hazirligi",
  "ezme hamlesi",
  "gec kalmis pismanlik",
  "pismanlik yalvarisi",
  "ikinci sans aciliyeti",
  "karar netligi (geri donus yok)",
  "yukun kalkmasi (rahatlama)",
  "ic ferahligi / kontrollu sevinc",
  "merakli tedirginlik",
  // --- NetShort guc/darbe paleti (genisletme) ---
  // Ozetlerdeki sahne tipleri: ifsa, delil, manset, hissedar darbesi, nikahta
  // terk, metres rezaleti, aile ATM'si, sozlesme yirtma, servet geri alma.
  "sahte sefkat maskesi (piskin)",
  "gaslight sogukkanliligi ('abartiyorsun')",
  "yalan yakalama ani (nefes kesilir)",
  "tehdit alti sessizlik",
  "delil elde: soguk sabir",
  "ihanet delilini gosterme ezme hamlesi",
  "kamusal ifsa zaferi",
  "hissedar darbesi ustunlugu",
  "yatirimci masasinda hesap sorma tatmini",
  "servetin geri alinmasi tatmini",
  "borc kapatma ustunlugu",
  "aile ATM'sini kapatma karar netligi",
  "aile onunde kucultulme utanci",
  "kayinvalide baskisinda dis sikma",
  "nikahta terk edilme sok donmasi",
  "sahte gelin ifsasi saskinligi",
  "DNA gercegi yuzlesmesi soku",
  "gizli kimligin acilma ani (donup kalma)",
  "kaybettigini anlama dehseti",
  "metresin yakalanmis panigi",
  "hastane koridorunda terk edilis acisi",
  "imza aninda el titremesi gerilimi",
  "kapida birakilan anahtarin soguk sessizligi",
  "sozlesme yirtma karar netligi",
  "manset gunu sakin gulusu",
  "eski esin yuzunun dusmesi (izlerken piskin)",
  "eski dostun ihanetine kuru gulus",
  "eski sevgilinin yeni asktan igrenmesi",
  "para teklifine tokat gibi ret",
  "sahte ozru reddetme sogukluğu",
  "yalvarmayi reddeden numb sessizlik",
  "tehdit savurma sinirliligi",
  "kamera onunde maske takma gerilimi",
  "bogazi dugumlenen kirilma",
  "sessiz gozyasiyla veda",
  "ic dokumun soguk ozeti",
  "yeni ittifakin soguk guveni",
  "yeni hayatin ilk derin nefesi",
  "kontrollu sevinc dalgasi",
] as const;

/**
 * NetShort cekim grameri: etki → tepki, 1-2 kisi, bolum bolum tiklayan ritim.
 * (Dikey kısa dram incelemeleri / ozet bankasi — kalabalik sahne yok.)
 */
export const NETSHORT_ACTION_REACTION: readonly string[] = [
  "ETKI: A bir sey yapar (kagit uzatir, sekretere gulumser, kapiyi corar, anahtar birakir).",
  "TEPKI: hemen sonraki kare/klip B'nin yuzu — goz kirilmasi, cene kilitlenmesi, donup bakma, sessiz nefes.",
  "CIFT: iki-shot → insert (kagit/telefon/anahtar, OKUNUR YAZI YOK) → reaction CU.",
  "TEK: tek kisi CU/MCU + el/nesne; kalabalik oda YASAK.",
  "MAX 1-2 isimli yuz kadrajda; ucuncu kisi arka planda flu veya yok.",
  "DEVAM: sonraki klip oncekinin son saniyesinden MATCH-ON-ACTION (ayni mekan/hava/kiyafet).",
  "UYKU YASAK: donuk oturma, yavas manzara, uzun bakisma — her 8 sn'de fiziksel darbe.",
] as const;

/**
 * Sertlik/acimasizlik kilidi — hikaye METNINE zorunlu islenir.
 * Palet listelemek yetmiyordu: model paleti gorup yine de yumusak yaziyordu.
 * Sadece hikaye/konu uretimine girer (OpenAI); Flow kutusuna yazilmaz.
 */
export const NETSHORT_CRUELTY_STORY_LOCK = [
  "SERTLIK ZORUNLU — asagidaki bes sinifin HER BIRINDEN en az BIR somut sahne yaz (NetShort DNA, yumusatma):",
  "(1) KAMUSAL ASAGILAMA: herkesin icinde kucultme; hakaret cumlesi ACIK yazilir ('Sen kimsin ki?', 'Soforsun sen, sofor kal.', 'Zavalli.').",
  "(2) EZME HAMLESI: fiziksel ustunluk gosterisi — omuz itmesi, kagit/anahtar yuze firlatma, kahve dokme, kapi carpma, yukaridan bakis.",
  "(3) ACIMASIZ PISKINLIK: ihanet eden utanmaz — gaslight ('abartiyorsun', 'herkes yapiyor'), kibirli gulus, tokat gibi kucumseme.",
  "(4) SOGUK KIN / SERT KARAR: kahraman bagirmadan keser — 'Bitti.', 'Bir daha arama.', imza, masaya birakilan anahtar.",
  "(5) EZME DONUSU: finalde ayni jestler TERSINE doner — bu kez kahraman ayni sogukluakla ezer; karsi taraf kucusur ve yalvarir.",
  "Sert replik SANSURLENMEZ: kufur yerine keskin hakaret ('zavalli', 'hicsin', 'parazit', 'sen bir hictin, hic kalacaksin').",
  "Yumusak uzlasma, 'aslinda herkes iyiydi', af dileyince affetme YASAK — pismanlik GEC kalmistir, geri getirmez.",
  "SINIR: tokat/itme/firlatma/kahve dokme SERBEST; kan, silah, oldurme, iskence, yatak YASAK.",
].join("\n");

/**
 * Hikaye + konu uretimine yapisan corpus kilidi (ozetlerden ogrenilmis).
 * Uzun ama hikaye API'sinde kalir; Flow kutusuna direkt yazilmaz.
 */
export const NETSHORT_CORPUS_STORY_LOCK = [
  "NETSHORT CORPUS DNA (200+ dizi ozetinden — ruhu kopyala, basligi/isimleri CALMA):",
  "Etiketler: Zorlu Geri Kazanis, Hesap Sorma, Guclu Donus, Pismanlik, Sozlesmeli Ask, Modern Ask, Gizli Kimlik, Beklenmedik Donus.",
  "DUYGU: " + NETSHORT_EMOTIONS.join("; ") + ".",
  "DUYGU ETIKETI = SES YONETIMI: her klibin emotionLabel/voiceTone alani yukaridaki paletten SECILIR. Seslendirme (ElevenLabs) ve Flow ses yonetmeni notu bu etiketten uretilir: sert etiket sert okunur, soguk etiket bastirilmis okunur, sok etiketinde nefes kesilir. Palet disi serbest siir etiketi yazma — ses duzlesir.",
  "AYNI ETIKET ARKA ARKAYA IKI KLIPTE TEKRARLANMAZ; duygu merdiveni yuruesun (asagilanma → sok → karar → soguk ustunluk → pismanlik).",
  "ETKI→TEPKI (ozetlerdeki isleyis): her darbe bir EYLEM + hemen ardindan YUZ/BEDEN tepkisi. Kalabalik sofra / uc kisi ayni anda konusma YASAK — 1-2 kisi karesi gibi yaz.",
  "GUÇ DNA: ezme + ustunluk + kontrollu siddet (tokat/itme/kapi) + kamusal asagılama + donuste status intikami. Yumusak 'uzuldum' guncesi YASAK.",
  "HER HIKAYE: asagidaki trop bankasindan 1 ANA + 1 YARDIMCI sec (rastgele karistir, ayni ikiyi arka arkaya tekrarlama). Sonra merdiveni isle: asagilanma → sakin yikici karar → dusus/zaman → gosterisli donus → pismanlik.",
  "TROP BANKASI: " + NETSHORT_TROPES.join(" | "),
  "OZET RUHU ORNEKLERI (yeniden yaz, birebir CALMA):",
  "(1) Es, ilk aska benzeyen sekreteri tercih eder; kahraman sakin bosanma + 'bebek senin degil'; yillar sonra yeni askla guclu doner; koca pismanlikta bogulur.",
  "(2) Kusursuz es iftira + bedel ister; dilekce uzatilir; ertesi gun varis manseti; eski es pisman, geri kazanmaya calisir.",
  "(3) Sekreter aldatmasi; kahraman baska yoldan hamile/yeni evlilikle intikam; eski koca pisman, metres rezil.",
  "(4) Sozlesmeli evlilik / 10 milyon; koca aslinda zirve zengin; eski sevgili 'metres' der; status cevirisi.",
  "(5) Iyilik gasbedilir (tekne/para/imza); 'cikarin yaninda iyilik hic'; kalem kalem hesap.",
  "(6) Herkes onunde terk + daha gucluyle evlilik; pisman yalvarir ama GERI GETIREMEZ.",
  "YASAK: ergen/okul zorbaligi, 18 alti, yatak/porno, surekli bagirma, yumusak hüzün şiiri, ayni otel karti klişesini her seferinde ayni kelimelerle.",
].join("\n");

/**
 * Klip bazli duygu secimi icin palet blogu — SINEMA ve GORSEL ANLATI ayni
 * listeden secer. Etiket paletten gelince seslendirme (ElevenLabs oyunculuk
 * profili) ve Flow ses yonetmeni notu deterministik uretilir; serbest siir
 * etiketinde ses duzlesiyordu.
 */
export function netShortEmotionPaletteBlock(): string {
  return [
    "DUYGU PALETI — emotionLabel BU LISTEDEN secilecek (birebir yaz):",
    NETSHORT_EMOTIONS.join("; ") + ".",
    "Bu etiket sadece yazi degil: seslendirmenin sertligini/sogukluguna ve yuz oyununu belirler.",
    "Ayni etiketi arka arkaya iki klipte kullanma. Palet disi 'biraz uzgun' / 'hasret siiri' YASAK.",
  ].join(" ");
}

/** Film plani icin kisa duygu/mekan + etki-tepki hatirlatmasi. */
export const NETSHORT_CORPUS_VISUAL_BEATS = [
  "CORPUS GORSEL DARBELER (etki→tepki; her 1-2 cutaway):",
  "limuzin + sekreter gulusu → camdan donuk bakis CU; dugun flashback warm → present cold reaction;",
  "bosanma kagidi uzatma (etki) → alicinin yuzu kirilir (tepki); manset isigi (okunur yazi YOK);",
  "yeni ask kolunda giris → eski es yuzu dusmus CU; pismanlik direksiyona kapanma;",
  "ofis cam: iki kisi max; insert telefon/kagit → reaction; penthouse boslugu tek yuz.",
  "ezme: yukaridan bakis / omuz itmesi / kagit firlatma → tepki CU; donuste ayni jest tersine.",
  "CEKIM: " + NETSHORT_ACTION_REACTION.slice(0, 5).join(" "),
].join(" ");

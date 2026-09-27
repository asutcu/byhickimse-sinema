/**
 * Kalibrasyon rehberi: her secicinin ne oldugu ve Google Flow arayuzunde
 * nerede arandigi. Panelde secici kartlarinda gosterilir.
 *
 * Flow arayuzu zaman icinde degisebilir; buradaki tarifler "hangi ise yarayan
 * dugmeyi aramaniz gerektigini" anlatir, birebir piksel konumu vermez.
 */

export type SelectorGroup = "zorunlu" | "onemli" | "opsiyonel";

export interface SelectorGuideEntry {
  label: string;
  /** Flow arayuzunde nerede aranacagi */
  where: string;
  /** Otomasyonda ne ise yaradigi */
  why: string;
  group: SelectorGroup;
}

export const SELECTOR_GUIDE: Record<string, SelectorGuideEntry> = {
  promptInput: {
    label: "Prompt kutusu",
    where:
      "Flow'da videoyu tarif ettiginiz buyuk metin yazma alani. Genelde ekranin alt kismindadir ve icinde soluk bir yer tutucu yazi bulunur (or. \"Ne olusturmak istiyorsunuz?\").",
    why: "Uygulama her klibin promptunu buraya yazar. Yerlesik bulucu (Generate yanindaki kutu) zaten calisir; kalibrasyon istege baglidir. Cok genis CSS (tum contenteditable) otomatik temizlenir.",
    group: "onemli",
  },
  generateButton: {
    label: "Generate (Uret) dugmesi",
    where:
      "Prompt kutusunun hemen saginda veya altinda bulunan uretimi baslatan dugme. Cogu zaman yukari ok, ucus ikonu ya da \"Generate\" yazisi tasir.",
    why: "Otomatik modda uygulama bu dugmeye basar. \"Elle basarim\" modunu sectiyseniz zorunlu degildir.",
    group: "zorunlu",
  },
  assetMenuButton: {
    label: "Video kartinin menu dugmesi (yalnizca yedek)",
    where:
      "YALNIZCA video kartinin KENDI uzerindeki uc nokta (⋮) dugmesi. Guncel Flow arayuzunde kartta dogrudan bir \"Indir\" dugmesi vardir ve uygulama once onu kullanir; bu alani bos birakabilirsiniz. Sayfanin ust seridindeki \"Diger secenekler\", \"Sirala ve Filtrele\", \"Ayarlari Goster\" gibi dugmeleri KESINLIKLE secmeyin: bunlar proje geneli menulerdir.",
    why: "Kartta dogrudan indirme dugmesi bulunamazsa yedek yol olarak kullanilir.",
    group: "opsiyonel",
  },
  downloadMenuItem: {
    label: "Indir (Download) menu ogesi (yalnizca yedek)",
    where:
      "Kartin uc nokta menusundeki \"Download\" / \"Indir\" satiri. DIKKAT: \"Projeyi indir\" / \"Download project\" satirini SECMEYIN — o, her klip icin projenin tamamini iceren AYNI arsivi indirir ve tum klipler ayni (eski) videoyu alir.",
    why: "Kartta dogrudan indirme dugmesi bulunamazsa yedek yol olarak kullanilir.",
    group: "opsiyonel",
  },
  generationProgress: {
    label: "Uretim ilerleme gostergesi",
    where:
      "Generate'e bastiktan hemen sonra beliren yuklenme animasyonu, ilerleme cubugu veya \"Generating...\" benzeri yazi. Kalibre etmek icin bir uretim baslatip bu gosterge ekrandayken tiklayin.",
    why: "Uretimin gercekten basladigini ve ne zaman bittigini anlamak icin kullanilir.",
    group: "onemli",
  },
  generationComplete: {
    label: "Uretim tamamlandi gostergesi",
    where:
      "Uretim bitince beliren video karti veya oynatma (play) dugmesi. Yeni olusan videonun onizlemesine tiklayabilirsiniz.",
    why: "Videonun hazir oldugunu dogrular. Kalibre edilirse bekleme cok daha guvenilir olur.",
    group: "onemli",
  },
  uploadReferenceButton: {
    label: "Medya ekleme (+) dugmesi",
    where:
      "PROMPT KUTUSUNUN YANINDAKI arti (+) dugmesi; tiklandiginda medya secim PENCERESI acilir. Sayfanin ust seridindeki \"Medya ekle\" dugmesini SECMEYIN: o, dosyayi yalnizca kitapliga yukler ve gorsel isteme (prompta) hic eklenmez.",
    why: "Referans gorsel bu pencereden secilip iste eklenir; karakter tutarliligi buna baglidir. Genelde kalibrasyon gerekmez, uygulama otomatik bulur.",
    group: "onemli",
  },
  referenceConfirmButton: {
    label: "Medya penceresi onay dugmesi (Isteme ekle)",
    where:
      "Gorsel yukledikten sonra Flow bir medya secim penceresi acar; alttaki beyaz \"Isteme ekle\" dugmesi. Pencere ekrandayken kalibrasyonu baslatip bu dugmeye tiklayin.",
    why: "Yuklenen referans gorselin prompt cubuguna (isteme) eklenmesini saglar. Basilmazsa pencere acik kalir ve uretim baslamaz.",
    group: "onemli",
  },
  downloadVideoItem: {
    label: "Indirme kalitesi secenegi",
    where:
      "\"Download\" satirina bastiginizda alt menu aciliyorsa oradaki kalite secenegi (or. 720p, 1080p, Original). Alt menu acilmiyorsa bos birakin.",
    why: "Indirilecek dosya kalitesini secer. Flow tek tikla indiriyorsa gerekmez.",
    group: "opsiyonel",
  },
  errorBanner: {
    label: "Hata bildirimi",
    where:
      "Uretim basarisiz oldugunda ekranda beliren kirmizi/uyari kutusu veya mesaj. Boyle bir hata gorurseniz o an kalibre edebilirsiniz.",
    why: "Hata durumunda otomasyonun bosuna beklemeyip hemen yeniden denemesini saglar.",
    group: "opsiyonel",
  },
  generationSettingsButton: {
    label: "Uretim ayarlari paneli dugmesi",
    where:
      "Prompt kutusunun yaninda, o anki ayarlarin ozetini gosteren dugme (or. \"Video · 16:9 · x1\"). Tiklaninca model/en-boy orani/cikti sayisi kontrolleri acilir. Genelde kalibrasyon gerekmez; uygulama bunu otomatik bulur.",
    why: "Model, en-boy orani ve cikti sayisi kontrolleri bu panel acilmadan sayfada gorunmez.",
    group: "opsiyonel",
  },
  modelMenu: {
    label: "Model secim dugmesi",
    where:
      "Uretim ayarlari paneli acildiginda gorunen, model adinin yazdigi dugme (or. \"Veo 3.1 - Fast\"). Genelde kalibrasyon gerekmez; uygulama bunu otomatik bulur.",
    why: "Uygulama projede sectiginiz modeli otomatik secer. Kalibre edilmezse Flow'daki mevcut secim kullanilir.",
    group: "opsiyonel",
  },
  durationMenu: {
    label: "Klip suresi menusu (eski)",
    where:
      "Artik kullanilmiyor: sure, uretim ayarlari panelindeki sekmelerden (4s / 6s / 8s / 10s) otomatik secilir, kalibrasyon gerekmez. Veo Fast/Lite icin 10s secilmez (8s'ye cekilir).",
    why: "Gecmis surumlerle uyumluluk icin listede tutulur; bos birakabilirsiniz.",
    group: "opsiyonel",
  },
  aspectRatioMenu: {
    label: "En-boy orani menusu (eski)",
    where: "Artik kullanilmiyor: en-boy orani, uretim ayarlari panelindeki sekmelerden (16:9 / 9:16) otomatik secilir, kalibrasyon gerekmez.",
    why: "Gecmis surumlerle uyumluluk icin listede tutulur; bos birakabilirsiniz.",
    group: "opsiyonel",
  },
  audioToggle: {
    label: "Ses ac/kapa anahtari",
    where: "Ayarlar bolumunde sesli uretim anahtari (hoparlor ikonu veya \"Audio\" etiketli anahtar).",
    why: "Projede sesi kapali sectiyseniz uygulama bu anahtari kapatir.",
    group: "opsiyonel",
  },
  newProjectButton: {
    label: "Yeni proje dugmesi",
    where: "Flow ana ekranindaki \"New project\" karti veya arti isaretli dugme.",
    why: "Ayni Flow projesi bulunamazsa yeni proje acmak icin kullanilir.",
    group: "opsiyonel",
  },
  modelOption: {
    label: "Model secenegi (liste satiri)",
    where: "Model menusunu actiginizda listede cikan secenek satiri. Genelde kalibrasyon gerekmez; uygulama metinle bulur.",
    why: "Nadiren, model adi metinle bulunamadiginda kullanilir.",
    group: "opsiyonel",
  },
  projectListItem: {
    label: "Proje karti (liste satiri)",
    where: "Flow ana sayfasindaki proje listesinde bir projenin karti. Genelde kalibrasyon gerekmez; uygulama proje adiyla bulur.",
    why: "Proje adiyla bulunamadiginda dogru projeyi acmak icin kullanilir.",
    group: "opsiyonel",
  },
  outputTypeMenu: {
    label: "Cikti turu menusu (video/gorsel)",
    where:
      "Prompt kutusunun yanindaki, o anki uretim modunu gosteren acilir menu (or. \"Metinden videoya\" / \"Text to video\"). Tiklaninca video ve gorsel uretim modlari listelenir.",
    why: "Karakter referans gorselini Flow'un GORSEL modunda (Nano Banana) uretmek icin kullanilir. Kalibre edilmezse karakter gorseli uretilemez (video yedek yolu kapali).",
    group: "opsiyonel",
  },
  imageModeOption: {
    label: "Gorsel modu secenegi",
    where:
      "Cikti turu menusunu actiginizda listede cikan gorsel uretim satiri (or. \"Metinden goruntuye\" / \"Text to image\" / \"Nano Banana\"). Menu acikken kalibrasyonu baslatip bu satira tiklayin.",
    why: "Karakter gorseli uretiminde Flow'u gorsel moduna gecirir.",
    group: "opsiyonel",
  },
  videoModeOption: {
    label: "Video modu secenegi",
    where:
      "Ayni menudeki video uretim satiri (or. \"Metinden videoya\" / \"Text to video\").",
    why: "Karakter gorseli uretildikten sonra Flow'u tekrar video moduna dondurur; klip otomasyonu video modunda calisir.",
    group: "opsiyonel",
  },
  characterNewButton: {
    label: "Yeni karakter dugmesi (Karakterler sayfasi)",
    where:
      "Flow projesinin KARAKTERLER sayfasinda (sol menudeki Karakterler sekmesi veya .../characters adresi) yeni karakter olusturmayi baslatan dugme.",
    why: "Karakter referans gorseli, Flow'un karakterlere ozel sayfasinda uretilir; boylece video degil dogrudan karakter olusur ve @adiyla kliplerde cagirilabilir.",
    group: "opsiyonel",
  },
  characterDescriptionInput: {
    label: "Karakter tarif kutusu",
    where: "Yeni karakter penceresinde karakteri tarif ettiginiz metin alani. Pencere acikken kalibrasyonu baslatip bu alana tiklayin.",
    why: "Uygulama karakterin tam tarifini (cinsiyet, sac, goz, kiyafet, aksesuar) bu alana yazar.",
    group: "opsiyonel",
  },
  characterGenerateButton: {
    label: "Karakter olustur dugmesi",
    where: "Yeni karakter penceresindeki olustur/generate dugmesi.",
    why: "Karakter uretimini baslatir.",
    group: "opsiyonel",
  },
};

/** Hizli kalibrasyonun sirasi: once otomasyonun calismasi icin sart olanlar. */
export const QUICK_CALIBRATION_ORDER = ["generateButton"] as const;

export const GROUP_META: Record<SelectorGroup, { title: string; description: string }> = {
  zorunlu: {
    title: "Zorunlu",
    description: "Bunlar olmadan otomasyon calismaz. Once bu dordunu kalibre edin.",
  },
  onemli: {
    title: "Onemli",
    description: "Kalibre edilmezse otomasyon calisir ama daha yavas ve daha az guvenilir olur.",
  },
  opsiyonel: {
    title: "Opsiyonel",
    description: "Bos birakabilirsiniz; bu durumda Flow'daki mevcut secimler kullanilir.",
  },
};

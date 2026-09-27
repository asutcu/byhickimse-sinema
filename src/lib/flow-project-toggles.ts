/**
 * Yeni proje / Ayarlar sekmesindeki Flow uretim anahtarlarinin
 * kullaniciya gosterilen aciklamalari.
 */
export const FLOW_TOGGLE_HELP = {
  allowSubtitles: {
    label: "Videoya gomulu altyazi",
    summary: "Kalici kapali. Dikey (9:16) ve yatay (16:9) tum kliplerde ekranda hic yazi olmaz.",
    detail:
      "Gomulu altyazi, karaoke, sarki sozu, tabela, onluk etiketi ve Ingilizce otomatik caption YASAK. YouTube icin altyazi gerekirse Yayin sekmesinden ayri SRT uretin — kareye yazilmaz.",
  },
  audioEnabled: {
    label: "Ses acik",
    summary: "Videoda konusma/sarki ve ortam sesi uretilir.",
    detail:
      "Acik: Flow/Veo klipleri sesli uretir (diyalog, sarki, ortam). Kapali: sessiz video; sadece gorsel. Cocuk animasyonu ve sarki klibinde neredeyse her zaman acik tutun — yoksa diyalog duyulmaz.",
  },
  useReference: {
    label: "Referans kullan",
    summary: "Karakter gorselini Flow'a referans olarak yukler; yuz/kostum tutarliligi artar.",
    detail:
      "Acik: Karakter sekmesindeki referans gorseller Flow'a eklenir. Cocuk animasyonunda sahnedeki [Kadro] uyelerinin (ana + yan) referanslari birden fazla yuklenir — boylece sabit hikaye kadrosu klipler arasinda bozulmaz. Kapali: model yalnizca metne guvenir; yuzler kolay bozulur. Model referansi desteklemiyorsa kapatilir.",
  },
  useFlowCharacter: {
    label: "Flow karakteri kullan",
    summary: "Kalici acik. Kadro @adi promptun basina yazilir.",
    detail:
      "Bu anahtar kapatilamaz. Karakter profilindeki Flow adi (@Markus gibi) her klip promptunun basina eklenir; yoksa isimden uretilir. Referans gorsel (sheet) ayri olarak 'Referans kullan' ile gider.",
  },
  useStartFrame: {
    label: "Baslangic karesi kullan",
    summary: "Klibe sabit bir baslangic karesi (start frame) verir.",
    detail:
      "Acik: uretim, sectiginiz/urettiginiz baslangic karesinden baslar — poz ve kompozisyon daha kontrollu olur. Kapali: model sahneyi sifirdan kurar. Bazi modeller start frame desteklemez; destek yoksa bu anahtar etkisiz kalir veya hata verir.",
  },
  usePrevLastFrame: {
    label: "Onceki son kareyi kullan",
    summary: "Onceki klibin son karesini sonraki klibin baslangici yapar (sureklilik).",
    detail:
      "Acik: her tamamlanan klibin son karesi bir sonraki klibe baslangic olarak verilir — mekan, isik ve karakter konumu klipler arasinda daha tutarli akar. Kapali: her klip bagimsiz baslar; gecislerde ziplama olabilir. Ilk klipte onceki kare olmadigi icin bu anahtar 2. klipten itibaren ise yarar.",
  },
  reuseFlowProject: {
    label: "Ayni Flow projesini kullan",
    summary: "Tum klipler ayni Google Flow projesinde uretilir.",
    detail:
      "Acik: otomasyon ayni Flow proje adini/acilmis projeyi tekrar kullanir — gecmis uretimler bir arada kalir, karakter/proje baglami korunur. Kapali: her seferinde yeni veya farkli proje acilabilir; duzen daginiklasir. Cok klipli hikayelerde acik tutmak onerilir.",
  },
} as const;

export type FlowToggleKey = keyof typeof FLOW_TOGGLE_HELP;

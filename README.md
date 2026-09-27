# Narratif — Anlatı Stüdyosu

Yerel bilgisayarınızda çalışan, web panelli anlatı-video otomasyon uygulaması:

- **OpenAI** ile hikâye, karakter ve video promptları üretir
- **Playwright**, sizin açtığınız gerçek Chrome üzerinden **Google Flow** arayüzünü kontrol eder
- Üretilen kısa klipleri indirir, **FFmpeg** ile tek uzun MP4'e birleştirir
- İki ürün: **Görsel anlatı** (TTS + slayt) ve **Sinema anlatıcı film** (Flow video klipleri)

> **Önemli:** Bu uygulama Flow'un resmî API'sini KULLANMAZ. Kullanıcı tarafından açılan gerçek tarayıcı arayüzünü Playwright ile kontrol eder. Google Flow arayüzü değiştiğinde seçiciler bozulabilir; bu durumda panele gömülü **Kalibrasyon Modu** ile seçicileri birkaç tıklamayla yeniden tanıtırsınız.

## Gereksinimler (Windows 10 / 11)

| Gereksinim | Kontrol | Kurulum |
|---|---|---|
| Node.js 22+ | `node --version` | https://nodejs.org |
| FFmpeg + ffprobe | `ffmpeg -version` | `winget install Gyan.FFmpeg` (sonra terminali yeniden açın) |
| Google Chrome | — | https://www.google.com/chrome/ |
| OpenAI API anahtarı | — | https://platform.openai.com |
| Google Flow erişimi | — | https://labs.google/fx/tools/flow |

## Kurulum

```powershell
# 1. Bagimliliklari kurun (postinstall prisma generate calistirir)
npm install

# 2. Veritabanini olusturun
npm run db:migrate

# 3. Uygulamayi baslatin
npm run dev
```

Panel: **http://localhost:3333**

Üretim modu için: `npm run build && npm start`

## İlk Kullanım (Kurulum Sihirbazı)

Panelde **Kurulum Sihirbazı** sayfasını açın; şu adımları doğrular ve yönlendirir:

1. Node / FFmpeg / Chrome / Playwright kontrolleri (otomatik)
2. **Ayarlar** ekranından OpenAI API anahtarınızı girin ve test edin
3. **Kalibrasyon** ekranından "Flow'u Aç" deyin; açılan Chrome'da Google hesabınıza **bir kez elle** giriş yapın (şifreniz uygulamaya asla girilmez/saklanmaz; oturum `chrome-profile/` klasöründe kalıcıdır)
4. Zorunlu seçicileri kalibre edin: **Kalibre Et** düğmesine basın, Flow'da hedef elemana tıklayın (promptInput, generateButton, assetMenuButton, downloadMenuItem öncelikli). Ardından **Secicileri Test Et**
5. **3 Kliplik Test Projesi Olustur** ile örnek projeyi açın, karakter görselini üretin/yükleyin, promptları oluşturun ve otomasyonu deneyin

## Güvenlik

- OpenAI anahtarı **istemciye asla gönderilmez**; varsayılan olarak yalnız çalışan oturumda bellekte tutulur. İsterseniz AES-256-GCM ile şifrelenip yerel veritabanına kaydedilir (anahtar dosyası: `config/.local-encryption-key`, git'e girmez)
- Loglarda API anahtarları, Google çerezleri ve tokenlar otomatik maskelenir
- Google şifresi hiçbir ekranda istenmez
- CAPTCHA / iki aşamalı doğrulama / güvenlik ekranı algılanırsa otomasyon **duraklar** ve panelde "Elle doğrulama gerekiyor" uyarısı gösterilir. Uygulama bu kontrolleri aşmaya çalışmaz; kredi/limit engellerini de aşmaz, açık hata gösterir

## Tipik İş Akışı (Anlatıcı şablonu)

1. **Yeni Proje** → şablon: Anlatıcı → konu, tür, süre, dil, karakter ve Flow ayarlarını doldurun
2. **Hikaye** sekmesi → "Hikaye Oluştur" → düzenleyin veya hazır eylemleri kullanın (Daha Korkutucu, Kısalt, Açılışı Güçlendir...)
3. "Hikayeyi Kliplere Böl" → **Klipler** sekmesinde düzenleyin (birleştir/böl/sürükle-sırala/CSV-JSON dışa aktar)
4. **Karakter** sekmesi → görsel yükleyin (önerilen) veya OpenAI ile üretip **onaylayın**
5. **Promptlar** sekmesi → "Tüm Promptları Oluştur" (şablon düzenlenebilir)
6. **Otomasyon** sekmesi → "Otomasyonu Başlat". Duraklat / devam / mevcut klibi iptal / başarısızları yeniden dene kontrolleri buradadır. Generate düğmesi proje ayarına göre otomatik ya da elle basılır
7. **Render** sekmesi → birleştirme yöntemi ve ses geçişi seçin → "Final Videoyu Oluştur" → kalite raporu + gömülü oynatıcı
8. **Yayın** sekmesi → YouTube meta verisi, thumbnail, SRT altyazı, dil varyantları, kanal ön ayarları

## Çocuk Animasyon Stüdyosu

Yeni projede şablon olarak **Çocuk Animasyonu** seçin; **Stüdyo** sekmesindeki 6 adımlı sihirbaz sizi yönlendirir: kanal/ders/yaş bandı → karakter DNA kartı (5 öneri + referans görsel) → başlık önerileri → duygu-merak eğrisi (grafik üzerinde düzenlenebilir) → ~20 sahne + yan karakterler → süreklilik korunan diyaloglar + çocuk içeriği güvenlik taraması. Sahne görselleri Klipler sekmesindeki kartlardan üretilir ve Flow'da başlangıç karesi/referans olarak kullanılır.

## Dosya Düzeni

```
projects/<proje-slug>/
  project.json
  story/story.txt, story.json
  clips.json
  character/reference.png
  prompts/001.txt, 002.txt ...
  clips/001.mp4, 002.mp4 ...
  frames/001-last.png (son kareler), scene-001.png (sahne gorselleri)
  screenshots/  (hata aninda ekran goruntusu + HTML snapshot)
  logs/
  output/final.mp4, final.srt, publish/
```

## Testler

```powershell
npm test
```

Kapsam: süre hesabı, cümle sınırında bölme, klip numaralandırma, prompt üretimi, dosya yolu güvenliği, FFmpeg concat listesi, ffprobe ayrıştırma, kaldığı yerden devam, anahtar maskeleme, seçici doğrulama, SRT üretimi. Playwright/Flow entegrasyonu gerçek hesaba bağlı olduğundan varsayılan testlerde çalıştırılmaz; gerçek Flow denemesi yalnızca sizin panelden başlatmanızla olur.

## Sık Karşılaşılan Sorunlar

- **"ffmpeg bulunamadi"** → `winget install Gyan.FFmpeg`, sonra terminali ve uygulamayı yeniden başlatın (PATH yenilenir)
- **"Zorunlu seciciler eksik"** → Kalibrasyon ekranından promptInput ve generateButton'ı kalibre edin, ya da projede Generate'i "elle" moduna alın
- **Otomasyon "Giris Bekliyor"da duruyor** → Chrome penceresinde Google'a giriş yapın, sonra "Devam Ettir"
- **Üretim zaman aşımı** → Ayarlar'dan `Uretim zaman asimi` değerini artırın; hata anındaki ekran görüntüsü `projects/<slug>/screenshots/` klasöründedir
- **Uygulama kapandı, iş yarım kaldı** → yeniden açın; iş "duraklatıldı" olarak görünür, "Devam Ettir" tamamlanan klipleri atlayarak sürdürür

## Bilinen Sınırlamalar

- Flow arayüzü değişirse seçici kalibrasyonu gerekir (tasarım gereği; panelden 2 dakikada yapılır)
- SRT zamanlaması konuşma hızı tahminine dayanır; kelime düzeyi hassas senkron için harici hizalama aracı gerekir
- `outputsPerGeneration > 1` seçildiğinde indirme, Flow'un varlık menüsünde son üretilen video üzerinden yapılır

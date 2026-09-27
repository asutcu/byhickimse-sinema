"use client";

import * as React from "react";
import { toast } from "sonner";
import { KeyRound, Mic, Save, ShieldCheck, Trash2 } from "lucide-react";
import { api, del, postJson, putJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";
import { TTS_PROVIDER_INFO, type TtsProvider } from "@/lib/tts-catalog";

interface SettingsData {
  openaiModel: string;
  flowUrl: string;
  chromeProfileDir: string;
  downloadDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  maxRetries: number;
  waitBetweenGenerationsMs: number;
  generationTimeoutMs: number;
  pollIntervalMs: number;
  defaultFlowModel: string;
  defaultClipSeconds: number;
  defaultAspectRatio: string;
  headless: boolean;
  slowMoMs: number;
  maxParallelProjects: number;
  wpmSlow: number;
  wpmNormal: number;
  wpmFast: number;
  modelSupportMatrix: string;
  ttsProvider: TtsProvider;
  azureSpeechRegion: string;
  elevenLabsVoiceId: string;
  piperPython: string;
  piperModelDir: string;
}

type TtsSecretFlags = Record<"google" | "azure" | "elevenlabs", boolean>;

interface KeyInfo {
  present: boolean;
  source: string;
  masked: string;
  storageMode: string;
}


export default function SettingsPage() {
  const [settings, setSettings] = React.useState<SettingsData | null>(null);
  const [keyInfo, setKeyInfo] = React.useState<KeyInfo | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [storageMode, setStorageMode] = React.useState<"memory" | "encrypted">("memory");
  const [saving, setSaving] = React.useState(false);
  const [savingKey, setSavingKey] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [ttsSecrets, setTtsSecrets] = React.useState<TtsSecretFlags | null>(null);
  // Anahtarlar sunucudan asla geri gelmez; yalnizca yeni deger yazilir.
  const [ttsKeys, setTtsKeys] = React.useState({ google: "", azure: "", elevenlabs: "" });

  React.useEffect(() => {
    api<{ settings: SettingsData; openaiKey: KeyInfo; ttsSecrets: TtsSecretFlags }>("/api/settings").then((data) => {
      setSettings(data.settings);
      setKeyInfo(data.openaiKey);
      setTtsSecrets(data.ttsSecrets);
      setStorageMode((data.openaiKey.storageMode as "memory" | "encrypted") ?? "memory");
    });
  }, []);

  function update<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      try {
        JSON.parse(settings.modelSupportMatrix || "{}");
      } catch {
        toast.error("Model destek matrisi gecerli JSON degil");
        return;
      }
      const payload: Record<string, unknown> = { ...settings };
      // Bos birakilan anahtar alani mevcut anahtari SILMEZ; sadece dolu olan gonderilir.
      if (ttsKeys.google.trim()) payload.googleTtsApiKey = ttsKeys.google.trim();
      if (ttsKeys.azure.trim()) payload.azureSpeechKey = ttsKeys.azure.trim();
      if (ttsKeys.elevenlabs.trim()) payload.elevenLabsApiKey = ttsKeys.elevenlabs.trim();
      if (ttsKeys.elevenlabs.trim() || ttsSecrets?.elevenlabs) {
        payload.ttsProvider = "elevenlabs";
      }

      const result = await putJson<{ settings: SettingsData; ttsSecrets: TtsSecretFlags }>("/api/settings", payload);
      setTtsSecrets(result.ttsSecrets);
      setTtsKeys({ google: "", azure: "", elevenlabs: "" });
      setDirty(false);
      toast.success("Ayarlar kaydedildi");
    } finally {
      setSaving(false);
    }
  }


  async function clearTtsKey(kind: "google" | "azure" | "elevenlabs") {
    const field = kind === "google" ? "googleTtsApiKey" : kind === "azure" ? "azureSpeechKey" : "elevenLabsApiKey";
    const result = await putJson<{ ttsSecrets: TtsSecretFlags }>("/api/settings", { [field]: "" });
    setTtsSecrets(result.ttsSecrets);
    toast.success("Anahtar silindi");
  }

  async function saveKey() {
    if (!apiKey.trim()) {
      toast.error("API anahtari girin");
      return;
    }
    setSavingKey(true);
    try {
      const info = await postJson<KeyInfo>("/api/settings/openai", { apiKey: apiKey.trim(), storageMode });
      setKeyInfo(info);
      setApiKey("");
      toast.success(storageMode === "encrypted" ? "Anahtar sifrelenerek kaydedildi" : "Anahtar bu oturum icin bellekte tutuluyor");
    } finally {
      setSavingKey(false);
    }
  }

  async function clearKey() {
    const info = await del<KeyInfo>("/api/settings/openai");
    setKeyInfo(info);
    toast.success("Anahtar silindi");
  }

  if (!settings) {
    return (
      <div>
        <PageHeader title="Ayarlar" />
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Yapilandirma"
        title="Ayarlar"
        description="OpenAI, Flow, Playwright ve FFmpeg — ByHickimse Sinema Stüdyosu yapılandırması"
        actions={
          <Button onClick={saveSettings} loading={saving} disabled={!dirty}>
            <Save className="h-4 w-4" /> Kaydet
          </Button>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <CardTitle>OpenAI API Anahtari</CardTitle>
            </div>
            <CardDescription>
              Anahtar istemciye asla gonderilmez. Varsayilan olarak yalnizca bu oturumda bellekte tutulur; isterseniz AES-256-GCM ile
              sifrelenerek yerel veritabanina kaydedilir.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              {keyInfo?.present ? (
                <>
                  <Badge variant="success">
                    <ShieldCheck className="h-3 w-3" /> Anahtar ayarli: {keyInfo.masked}
                  </Badge>
                  <Badge>
                    Kaynak: {keyInfo.source === "sifreli-db" ? "Sifreli veritabani" : keyInfo.source === "bellek" ? "Bellek (oturum)" : keyInfo.source === "env" ? ".env dosyasi" : keyInfo.source}
                  </Badge>
                  <Button variant="danger" size="sm" onClick={clearKey}>
                    <Trash2 className="h-3.5 w-3.5" /> Anahtari Sil
                  </Button>
                </>
              ) : (
                <Badge variant="danger">Anahtar ayarlanmamis</Badge>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3 items-end">
              <div>
                <Label htmlFor="apiKey">Yeni anahtar</Label>
                <Input id="apiKey" type="password" placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <Label>Saklama modu</Label>
                <Select value={storageMode} onValueChange={(v) => setStorageMode(v as "memory" | "encrypted")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="memory">Yalnizca bellekte (oturum)</SelectItem>
                    <SelectItem value="encrypted">Sifreli sakla (AES-256-GCM)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={saveKey} loading={savingKey}>
                Anahtari Kaydet
              </Button>
            </div>
            <div>
              <Label htmlFor="openaiModel">Varsayilan OpenAI modeli</Label>
              <Input
                id="openaiModel"
                className="max-w-xs"
                value={settings.openaiModel}
                onChange={(e) => update("openaiModel", e.target.value)}
                placeholder="gpt-5"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Google Flow ve Playwright</CardTitle>
            <CardDescription>
              Google sifreniz hicbir yerde saklanmaz. Ilk calistirmada acilan Chrome penceresinde hesabiniza bir kez elle giris yaparsiniz;
              oturum profil klasorunde saklanir.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="flowUrl">Google Flow URL</Label>
              <Input id="flowUrl" value={settings.flowUrl} onChange={(e) => update("flowUrl", e.target.value)} />
              <p className="text-[10.5px] text-muted-2 mt-1 leading-relaxed">
                Onerilen: dogrudan PROJE adresinizi yazin (or. https://flow.google.com/project/XXXX). Ana sayfa adresinde prompt kutusu bulunmadigi
                icin otomasyon her seferinde projeyi elle acmanizi bekler.
              </p>
            </div>
            <div>
              <Label htmlFor="chromeProfileDir">Chrome profil klasoru</Label>
              <Input id="chromeProfileDir" value={settings.chromeProfileDir} onChange={(e) => update("chromeProfileDir", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="downloadDir">Indirme klasoru</Label>
              <Input id="downloadDir" value={settings.downloadDir} onChange={(e) => update("downloadDir", e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-[10px] border border-border bg-surface-2 px-4 py-3">
              <div>
                <div className="text-[13px] font-medium">Headless mod</div>
                <div className="text-[11px] text-muted">Ilk surumde kapali onerilir (tarayiciyi gorursunuz)</div>
              </div>
              <Switch checked={settings.headless} onCheckedChange={(v) => update("headless", v)} />
            </div>
            <div>
              <Label htmlFor="slowMo">SlowMo (ms)</Label>
              <Input id="slowMo" type="number" value={settings.slowMoMs} onChange={(e) => update("slowMoMs", Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="maxParallel">Paralel proje sayisi</Label>
              <Input
                id="maxParallel"
                type="number"
                min={1}
                max={6}
                value={settings.maxParallelProjects}
                onChange={(e) => update("maxParallelProjects", Number(e.target.value))}
              />
              <p className="text-[11px] text-muted mt-1 leading-relaxed">
                Ayni anda kac projenin otomasyonu calisabilir. Her proje ayni Chrome penceresinde KENDI sekmesinde
                calisir (tek Google oturumu). Her projenin &quot;Flow proje linki&quot; dolu olmalidir; aksi halde
                sekmeler ayni Flow projesine dusebilir. Yuksek deger makineyi ve Google tarafindaki uretim kotasini
                zorlar — 2-4 arasi onerilir.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Otomasyon Zamanlamalari</CardTitle>
            <CardDescription>Uretim bekleme sureleri ve yeniden deneme davranisi</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>Maks. yeniden deneme</Label>
              <Input type="number" value={settings.maxRetries} onChange={(e) => update("maxRetries", Number(e.target.value))} />
            </div>
            <div>
              <Label>Uretimler arasi bekleme (ms)</Label>
              <Input
                type="number"
                value={settings.waitBetweenGenerationsMs}
                onChange={(e) => update("waitBetweenGenerationsMs", Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Uretim zaman asimi (ms)</Label>
              <Input type="number" value={settings.generationTimeoutMs} onChange={(e) => update("generationTimeoutMs", Number(e.target.value))} />
            </div>
            <div>
              <Label>Kontrol araligi (ms)</Label>
              <Input type="number" value={settings.pollIntervalMs} onChange={(e) => update("pollIntervalMs", Number(e.target.value))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-primary" />
              <CardTitle>Seslendirme (TTS)</CardTitle>
            </div>
            <CardDescription>
              Yerli Turkce icin Google veya Azure anahtari ekleyin. Bunlar yoksa veya Piper (ucretsiz) bozulursa
              uretim otomatik OpenAI TTS yedegine gecer. Anahtarlar sifreli saklanir, ekrana geri gelmez.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TTS_PROVIDER_INFO.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update("ttsProvider", p.id)}
                  className={cn(
                    "rounded-[12px] border p-3 text-left",
                    settings.ttsProvider === p.id
                      ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                      : "border-border bg-surface hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">{p.label}</span>
                    {p.requires === "piper-local" ? (
                      <Badge variant="primary">ucretsiz</Badge>
                    ) : ttsSecrets?.[p.requires === "google-key" ? "google" : p.requires === "azure-key" ? "azure" : "elevenlabs"] ? (
                      <Badge variant="primary">anahtar hazir</Badge>
                    ) : p.requires === "openai-key" ? (
                      <Badge>OpenAI anahtari</Badge>
                    ) : (
                      <Badge variant="default">anahtar gerekli</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted leading-snug">{p.hint}</p>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Google Cloud TTS API anahtari</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    type="password"
                    value={ttsKeys.google}
                    placeholder={ttsSecrets?.google ? "Kayitli — degistirmek icin yeni anahtar yazin" : "AIza..."}
                    onChange={(e) => {
                      setTtsKeys((k) => ({ ...k, google: e.target.value }));
                      setDirty(true);
                    }}
                  />
                  {ttsSecrets?.google && (
                    <Button variant="outline" size="sm" onClick={() => clearTtsKey("google")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-[10.5px] text-muted-2">
                  Google Cloud &gt; APIs &amp; Services &gt; Credentials &gt; API key. Text-to-Speech API acik olmali.
                </p>
              </div>
              <div>
                <Label>Azure Speech anahtari</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    type="password"
                    value={ttsKeys.azure}
                    placeholder={ttsSecrets?.azure ? "Kayitli — degistirmek icin yeni anahtar yazin" : "Azure Speech key"}
                    onChange={(e) => {
                      setTtsKeys((k) => ({ ...k, azure: e.target.value }));
                      setDirty(true);
                    }}
                  />
                  {ttsSecrets?.azure && (
                    <Button variant="outline" size="sm" onClick={() => clearTtsKey("azure")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label>Azure bolgesi</Label>
                <Input
                  value={settings.azureSpeechRegion}
                  onChange={(e) => update("azureSpeechRegion", e.target.value)}
                  placeholder="westeurope"
                />
              </div>
              <div>
                <Label>ElevenLabs anahtari</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    type="password"
                    value={ttsKeys.elevenlabs}
                    placeholder={ttsSecrets?.elevenlabs ? "Kayitli — degistirmek icin yeni anahtar yazin" : "sk_..."}
                    onChange={(e) => {
                      setTtsKeys((k) => ({ ...k, elevenlabs: e.target.value }));
                      setDirty(true);
                    }}
                  />
                  {ttsSecrets?.elevenlabs && (
                    <Button variant="outline" size="sm" onClick={() => clearTtsKey("elevenlabs")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label>ElevenLabs ses kimligi (isteğe bağlı)</Label>
                <Input
                  value={settings.elevenLabsVoiceId}
                  onChange={(e) => update("elevenLabsVoiceId", e.target.value)}
                  placeholder="Boş bırak — hikayeye göre API'den seçilir"
                />
                <p className="mt-1 text-[10.5px] text-muted-2">
                  Boş bırakırsan projenin konuşma diline göre (Türkçe, İngilizce, Almanca, Fransızca, İspanyolca) hesap seslerinden seçilir. Sabit Voice ID o dile uymuyorsa yok sayılır.
                </p>
              </div>
              <div>
                <Label>Piper Python komutu</Label>
                <Input value={settings.piperPython} onChange={(e) => update("piperPython", e.target.value)} placeholder="python" />
                <p className="mt-1 text-[10.5px] text-muted-2">Kurulum: pip install piper-tts</p>
              </div>
              <div className="md:col-span-2">
                <Label>Piper model klasoru</Label>
                <Input
                  value={settings.piperModelDir}
                  onChange={(e) => update("piperModelDir", e.target.value)}
                  placeholder="Bos birakilirsa config/piper-voices kullanilir"
                />
                <p className="mt-1 text-[10.5px] text-muted-2">
                  Turkce modeller (dfki, fettah, fahrettin) ilk kullanimda Hugging Face uzerinden buraya iner.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>


        <Card>
          <CardHeader>
            <CardTitle>Varsayilan Uretim Ayarlari</CardTitle>
            <CardDescription>Yeni projelerde kullanilacak Flow varsayilanlari ve konusma hizlari</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <Label>Varsayilan Flow modeli</Label>
              <Input value={settings.defaultFlowModel} onChange={(e) => update("defaultFlowModel", e.target.value)} />
            </div>
            <div>
              <Label>Varsayilan klip suresi (sn)</Label>
              <Select value={String(settings.defaultClipSeconds)} onValueChange={(v) => update("defaultClipSeconds", Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[4, 6, 8, 10].map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s} saniye
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Varsayilan en-boy orani</Label>
              <Select value={settings.defaultAspectRatio} onValueChange={(v) => update("defaultAspectRatio", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 (yatay)</SelectItem>
                  <SelectItem value="9:16">9:16 (dikey)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Yavas konusma (kelime/dk)</Label>
              <Input type="number" value={settings.wpmSlow} onChange={(e) => update("wpmSlow", Number(e.target.value))} />
            </div>
            <div>
              <Label>Normal konusma (kelime/dk)</Label>
              <Input type="number" value={settings.wpmNormal} onChange={(e) => update("wpmNormal", Number(e.target.value))} />
            </div>
            <div>
              <Label>Hizli konusma (kelime/dk)</Label>
              <Input type="number" value={settings.wpmFast} onChange={(e) => update("wpmFast", Number(e.target.value))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>FFmpeg</CardTitle>
            <CardDescription>PATH'te ise yalnizca "ffmpeg" / "ffprobe" yazmak yeterlidir</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>FFmpeg yolu</Label>
              <Input value={settings.ffmpegPath} onChange={(e) => update("ffmpegPath", e.target.value)} />
            </div>
            <div>
              <Label>ffprobe yolu</Label>
              <Input value={settings.ffprobePath} onChange={(e) => update("ffprobePath", e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model Destek Matrisi</CardTitle>
            <CardDescription>
              Hangi Flow modelinin hangi sure/oran/ozellikleri destekledigi. Otomasyon baslamadan once bu matrisle dogrulama yapilir.
              JSON bicimi: {"{"}"Model Adi": {"{"}"durations": [4,6,8], "aspectRatios": ["16:9","9:16"], "supportsReference": true,
              "supportsAudio": true, "supportsStartFrame": true{"}"}{"}"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              className="font-mono text-xs min-h-[180px]"
              value={settings.modelSupportMatrix}
              onChange={(e) => update("modelSupportMatrix", e.target.value)}
              spellCheck={false}
            />
          </CardContent>
        </Card>
      </div>

      {dirty && (
        <div className="fixed bottom-6 right-6 z-40">
          <Button onClick={saveSettings} loading={saving} size="lg" className="shadow-2xl">
            <Save className="h-4 w-4" /> Degisiklikleri Kaydet
          </Button>
        </div>
      )}
    </div>
  );
}

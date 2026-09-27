"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Monitor,
  Crosshair,
  FlaskConical,
  Info,
  MousePointerClick,
  Power,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Wand2,
} from "lucide-react";
import { api, postJson, putJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared";
import { GROUP_META, QUICK_CALIBRATION_ORDER, SELECTOR_GUIDE, type SelectorGroup } from "@/lib/selector-guide";
import { cn, formatDate } from "@/lib/utils";

interface SelectorRecord {
  key: string;
  strategy: string;
  value: string;
  roleName: string;
  candidates: string;
  description: string;
  required: boolean;
  lastTestOk: boolean | null;
  lastTestAt: string | null;
}

function candidateCount(record: SelectorRecord): number {
  try {
    const parsed = JSON.parse(record.candidates || "[]") as unknown[];
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

interface SessionInfo {
  status: string;
  detail: string;
  browserOpen: boolean;
  url?: string;
}

const STRATEGIES = ["role", "label", "placeholder", "text", "testid", "css"];
const GROUP_ORDER: SelectorGroup[] = ["zorunlu", "onemli", "opsiyonel"];

/** Kalibrasyon olmadan da calisabilen (yerlesik tarifi bulunan) anahtarlar. */
const SEMANTIC_KEYS = new Set([
  "promptInput",
  "generateButton",
  "assetMenuButton",
  "downloadMenuItem",
  "downloadVideoItem",
  "uploadReferenceButton",
  "referenceConfirmButton",
  "generationProgress",
  "errorBanner",
  "newProjectButton",
  "audioToggle",
]);

export default function CalibrationPage() {
  const [selectors, setSelectors] = React.useState<SelectorRecord[] | null>(null);
  const [session, setSession] = React.useState<SessionInfo | null>(null);
  const [calibratingKey, setCalibratingKey] = React.useState<string | null>(null);
  const [quickRunning, setQuickRunning] = React.useState(false);
  const [autoRunning, setAutoRunning] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [openingBrowser, setOpeningBrowser] = React.useState(false);
  const [edited, setEdited] = React.useState<Record<string, Partial<SelectorRecord>>>({});
  const [advancedKey, setAdvancedKey] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [selectorData, sessionData] = await Promise.all([
      api<SelectorRecord[]>("/api/selectors", { silent: true }),
      api<SessionInfo>("/api/flow/session", { silent: true }),
    ]);
    setSelectors(selectorData);
    setSession(sessionData);
  }, []);

  React.useEffect(() => {
    load().catch(() => {});
    const interval = setInterval(() => {
      api<SessionInfo>("/api/flow/session", { silent: true }).then(setSession).catch(() => {});
    }, 15_000);
    return () => clearInterval(interval);
  }, [load]);

  async function openBrowser() {
    setOpeningBrowser(true);
    try {
      const result = await postJson<SessionInfo>("/api/flow/open");
      setSession({ ...result, browserOpen: true });
      toast.success("Flow acildi. Giris gerekiyorsa Chrome penceresinde elle giris yapin.");
    } finally {
      setOpeningBrowser(false);
    }
  }

  async function closeBrowser() {
    await postJson("/api/flow/close");
    await load();
    toast.success("Tarayici kapatildi");
  }

  async function calibrate(key: string) {
    const guide = SELECTOR_GUIDE[key];
    setCalibratingKey(key);
    toast.info(`Simdi Flow penceresinde "${guide?.label ?? key}" ogesine tiklayin. (Vazgecmek icin ESC)`, { duration: 12_000 });
    try {
      const result = await postJson<{ strategy: string; value: string; verifiedCount: number }>("/api/flow/calibrate", { key });
      await load();
      if (result.verifiedCount === 0) {
        toast.warning(
          `"${guide?.label ?? key}" dogrulanamadi: uretilen adaylarin hicbiri tikladiginiz ogeye denk gelmedi. Dogrudan dugmenin uzerine tiklayarak tekrar deneyin.`
        );
        return false;
      }
      toast.success(
        `"${guide?.label ?? key}" tanitildi — ${result.verifiedCount} dogrulanmis aday kaydedildi${result.verifiedCount > 1 ? " (biri kirilirsa digeri devreye girer)" : ""}`
      );
      return true;
    } catch {
      return false;
    } finally {
      setCalibratingKey(null);
    }
  }

  /** Zorunlu secicileri sirayla kalibre eder; her adimda ne yapilacagini soyler. */
  async function runQuickCalibration() {
    if (!session?.browserOpen) {
      toast.error("Once Flow'u acin");
      return;
    }
    setQuickRunning(true);
    try {
      for (let i = 0; i < QUICK_CALIBRATION_ORDER.length; i++) {
        const key = QUICK_CALIBRATION_ORDER[i];
        const guide = SELECTOR_GUIDE[key];
        toast.info(`Adim ${i + 1}/${QUICK_CALIBRATION_ORDER.length}: ${guide.label}`, {
          description: guide.where,
          duration: 15_000,
        });
        const ok = await calibrate(key);
        if (!ok) {
          toast.error(`"${guide.label}" adiminda durduruldu. Sorunu giderip tekrar baslatabilirsiniz.`);
          return;
        }
      }
      toast.success("Zorunlu seciciler tamamlandi. Simdi 'Secicileri Test Et' ile dogrulayin.");
    } finally {
      setQuickRunning(false);
    }
  }

  async function testSelectors() {
    setTesting(true);
    try {
      const results = await postJson<Array<{ key: string; found: boolean; matchedSource: string | null }>>("/api/flow/test-selectors");
      const foundCount = results.filter((r) => r.found).length;
      const semanticCount = results.filter((r) => r.matchedSource === "yerlesik").length;
      toast.success(
        `Test tamamlandi: ${foundCount}/${results.length} oge su an sayfada bulundu` +
          (semanticCount > 0 ? ` (${semanticCount} tanesi yerlesik yedekle)` : "")
      );
      await load();
    } finally {
      setTesting(false);
    }
  }

  async function saveManualEdits() {
    if (!selectors) return;
    const changes = Object.entries(edited).map(([key, change]) => {
      const original = selectors.find((s) => s.key === key)!;
      return {
        key,
        strategy: change.strategy ?? original.strategy,
        value: change.value ?? original.value,
        roleName: change.roleName ?? original.roleName,
      };
    });
    if (changes.length === 0) return;
    const updated = await putJson<SelectorRecord[]>("/api/selectors", { selectors: changes });
    setSelectors(updated);
    setEdited({});
    toast.success("Seciciler kaydedildi");
  }

  function editField(key: string, field: "strategy" | "value" | "roleName", value: string) {
    setEdited((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  const sessionBadge = !session ? null : session.browserOpen ? (
    session.status === "ready" ? (
      <Badge variant="success" dot>
        Oturum hazir
      </Badge>
    ) : session.status === "needs_login" ? (
      <Badge variant="warning" dot>
        Google girisi gerekli
      </Badge>
    ) : session.status === "needs_verification" ? (
      <Badge variant="danger" dot>
        Elle dogrulama gerekiyor
      </Badge>
    ) : (
      <Badge dot>Bilinmiyor</Badge>
    )
  ) : (
    <Badge dot>Tarayici kapali</Badge>
  );

  const requiredDone = selectors
    ? QUICK_CALIBRATION_ORDER.filter((key) => {
        const value = selectors.find((s) => s.key === key)?.value ?? "";
        if (value !== "") return true;
        // Yerlesik tarifi olan anahtarlar bos kalsa da "tamam" sayilir
        return SEMANTIC_KEYS.has(key);
      }).length
    : 0;

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Otomasyon"
        title="Flow Kalibrasyonu"
        description="Google Flow arayüzündeki düğmeleri sizin göstermenizle öğrenir. Anlatı film üretimi için kalibrasyon gerekir."
        actions={
          <>
            {sessionBadge}
            <Button variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Yenile
            </Button>
            {session?.browserOpen ? (
              <Button variant="danger" size="sm" onClick={closeBrowser}>
                <Power className="h-3.5 w-3.5" /> Tarayiciyi Kapat
              </Button>
            ) : (
              <Button size="sm" onClick={openBrowser} loading={openingBrowser}>
                <Monitor className="h-4 w-4" /> Flow&apos;u Ac
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={testSelectors} loading={testing} disabled={!session?.browserOpen}>
              <FlaskConical className="h-3.5 w-3.5" /> Secicileri Test Et
            </Button>
          </>
        }
      />

      {session && session.status === "needs_login" && (
        <Card className="mb-4 border-warning/30 bg-warning-soft">
          <CardContent className="p-4 text-[13px] text-warning">
            Google oturumu acik degil. Acilan Chrome penceresinde hesabiniza <strong>elle</strong> giris yapin. Uygulama sifrenizi asla
            istemez ve saklamaz; oturum kalici Chrome profilinde tutulur.
          </CardContent>
        </Card>
      )}
      {session && session.status === "needs_verification" && (
        <Card className="mb-4 border-danger/30 bg-danger-soft">
          <CardContent className="p-4 flex items-start justify-between gap-4 flex-wrap">
            <div className="text-[13px] text-danger min-w-0">
              <div className="font-semibold">Dogrulama ekrani tespit edildi</div>
              <p className="mt-1 leading-relaxed">{session.detail}</p>
              <p className="mt-1.5 text-[12px] text-muted leading-relaxed">
                Ekranda boyle bir dogrulama <strong>yoksa</strong> bu bir yanlis alarmdir (sayfadaki bir metin tespite takilmis olabilir).
                Kontrolu atlayarak devam edebilirsiniz; uygulama hicbir dogrulamayi asmaya calismaz.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await postJson("/api/flow/session/override", { ignore: true });
                toast.success("Kontrol atlandi. Otomasyona devam edebilirsiniz.");
                await load();
              }}
            >
              <ShieldOff className="h-3.5 w-3.5" /> Kontrolu Atla (yanlis alarm)
            </Button>
          </CardContent>
        </Card>
      )}

      {session?.browserOpen && session.url && !/\/project|\/flow\/[a-z0-9-]{6,}/i.test(session.url) && (
        <Card className="mb-4 border-warning/30 bg-warning-soft">
          <CardContent className="p-4 text-[13px] text-warning">
            <strong>Flow ana sayfasinda gorunuyorsunuz.</strong> Prompt kutusu ve Generate dugmesi yalnizca bir PROJE acikken ekranda olur.
            Kalibrasyona baslamadan once Chrome penceresinde projenizi acin (veya yeni proje olusturun). Su anki adres:{" "}
            <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted break-all">{session.url}</code>
          </CardContent>
        </Card>
      )}

      {/* Nasil yapilir + hizli kalibrasyon */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 mb-5">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <CardTitle>Kalibrasyon nasil yapilir?</CardTitle>
            </div>
            <CardDescription>
              Uygulamanin Flow&apos;u kullanabilmesi icin hangi dugmenin ne oldugunu bilmesi gerekir. Bunu bir kez gostermeniz yeterli.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2.5">
              {[
                "\"Flow'u Ac\" dugmesine basin; Chrome penceresi acilir ve iki ekran yan yana durur (panel + Flow).",
                "Chrome'da bir PROJE acin (prompt kutusunun gorundugu ekran). Ana sayfada prompt kutusu ve Generate dugmesi bulunmaz.",
                "Asagidaki listeden bir ogenin \"Kalibre Et\" dugmesine basin.",
                "Flow penceresine gecin: fareyi gezdirdikcek elemanlarin etrafinda kirmizi cerceve olusur. Tarif edilen dugmeye TIKLAYIN.",
                "Tiklama kaydedilir ve panele geri donersiniz. Yanlis tikladiysaniz ayni ogeyi tekrar kalibre edin. Vazgecmek icin Flow penceresinde ESC'e basin.",
              ].map((step, i) => (
                <li key={i} className="flex gap-3 text-[13px] leading-relaxed">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="text-muted">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 rounded-[10px] border border-border bg-surface-2 p-3 text-[12px] text-muted leading-relaxed">
              <MousePointerClick className="h-3.5 w-3.5 inline mr-1.5 text-primary" />
              Menu icindeki bir ogeyi (or. &quot;Indir&quot;) kalibre edecekseniz, once o menuyu Flow&apos;da elinizle acin, menu ekranda
              acikken &quot;Kalibre Et&quot;e basip ilgili satira tiklayin.
            </div>
            <div className="mt-2 rounded-[10px] border border-success/25 bg-success-soft p-3 text-[12px] text-muted leading-relaxed">
              <ShieldCheck className="h-3.5 w-3.5 inline mr-1.5 text-success" />
              <span className="font-medium text-foreground">Dayanikli secici sistemi:</span> Her tanitmada tek bir secici degil,
              tikladiginiz ogeye denk geldigi <strong>dogrulanmis birkac yedek</strong> birden kaydedilir. Calisma sirasinda biri
              kirilirsa digeri devreye girer ve calisan aday otomatik olarak birincil hale gelir. Ayrica cogu oge icin{" "}
              <strong>yerlesik tarifler</strong> vardir; hic kalibrasyon yapilmasa bile otomasyon calismayi dener.
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              <CardTitle>Hizli Kalibrasyon</CardTitle>
            </div>
            <CardDescription>Otomasyon icin sart olan 4 ogeyi sirayla, adim adim tanitir.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                <div
                  className="h-full brand-gradient transition-all"
                  style={{ width: `${(requiredDone / QUICK_CALIBRATION_ORDER.length) * 100}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-muted">
                {requiredDone}/{QUICK_CALIBRATION_ORDER.length}
              </span>
            </div>
            <div className="space-y-1">
              {QUICK_CALIBRATION_ORDER.map((key, i) => {
                const value = selectors?.find((s) => s.key === key)?.value ?? "";
                const done = value !== "" || SEMANTIC_KEYS.has(key);
                return (
                  <div key={key} className="flex items-center gap-2 text-[12px]">
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold",
                        done ? "bg-success-soft text-success" : "bg-surface-3 text-muted-2"
                      )}
                    >
                      {done ? <Check className="h-2.5 w-2.5" /> : i + 1}
                    </span>
                    <span className={done ? "text-muted line-through" : "text-foreground"}>{SELECTOR_GUIDE[key].label}</span>
                  </div>
                );
              })}
            </div>
            <Button
              className="w-full"
              variant="secondary"
              onClick={async () => {
                setAutoRunning(true);
                try {
                  const result = await postJson<{
                    session: { status: string };
                    editorReady: boolean;
                    results: Array<{ key: string; found: boolean; saved: boolean }>;
                  }>("/api/flow/auto-calibrate");
                  if (result.session.status === "needs_login") {
                    toast.error("Google oturumu acik degil; Chrome penceresinde giris yapin.");
                  } else {
                    const found = result.results.filter((r) => r.found).length;
                    const saved = result.results.filter((r) => r.saved).length;
                    toast.success(
                      `Otomatik kalibrasyon bitti: ${found}/${result.results.length} oge bulundu, ${saved} secici kaydedildi` +
                        (result.editorReady ? "" : " (editor ekrani acilamadi — projeyi elle acip tekrar deneyin)")
                    );
                  }
                  await load();
                } finally {
                  setAutoRunning(false);
                }
              }}
              loading={autoRunning}
              disabled={!session?.browserOpen || calibratingKey !== null || quickRunning}
            >
              <Wand2 className="h-4 w-4" /> Otomatik Kalibre Et (tiklamasiz)
            </Button>
            <Button
              className="w-full"
              onClick={runQuickCalibration}
              loading={quickRunning}
              disabled={!session?.browserOpen || calibratingKey !== null || autoRunning}
            >
              <Crosshair className="h-4 w-4" /> Sirayla Kalibre Et (tiklayarak)
            </Button>
            <p className="text-[10.5px] text-muted-2 leading-relaxed">
              Otomatik mod, ogeleri yerlesik tariflerle bulup kaydeder; tiklamaniz gerekmez. Bulunamayan oge kalirsa tiklamali modu
              kullanin.
            </p>
            {!session?.browserOpen && <p className="text-[11px] text-muted-2 text-center">Once Flow&apos;u acmalisiniz.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Secici listesi */}
      {!selectors ? (
        <Skeleton className="h-96 rounded-[16px]" />
      ) : (
        <div className="space-y-4">
          {GROUP_ORDER.map((group) => {
            const items = selectors.filter((s) => (SELECTOR_GUIDE[s.key]?.group ?? "opsiyonel") === group);
            if (items.length === 0) return null;
            return (
              <Card key={group}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle>{GROUP_META[group].title}</CardTitle>
                    <Badge variant={group === "zorunlu" ? "danger" : group === "onemli" ? "warning" : "default"}>
                      {items.length} oge
                    </Badge>
                  </div>
                  <CardDescription>{GROUP_META[group].description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {items.map((selector) => {
                    const guide = SELECTOR_GUIDE[selector.key];
                    const change = edited[selector.key] ?? {};
                    const strategy = change.strategy ?? selector.strategy;
                    const value = change.value ?? selector.value;
                    const roleName = change.roleName ?? selector.roleName;
                    const configured = value !== "" || SEMANTIC_KEYS.has(selector.key);
                    const isAdvancedOpen = advancedKey === selector.key;

                    return (
                      <div
                        key={selector.key}
                        className={cn(
                          "rounded-[12px] border p-4",
                          calibratingKey === selector.key ? "border-primary ring-[3px] ring-primary/10 bg-primary-soft/30" : "border-border bg-surface-2"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13.5px] font-semibold">{guide?.label ?? selector.key}</span>
                              {configured ? (
                                <Badge variant="success" dot>
                                  {value !== "" ? "Tanitildi" : "Yerlesik tarif"}
                                </Badge>
                              ) : (
                                <Badge variant={group === "zorunlu" ? "danger" : "default"} dot>
                                  Tanitilmadi
                                </Badge>
                              )}
                              {selector.lastTestOk === true && <Badge variant="info">Testte bulundu</Badge>}
                              {selector.lastTestOk === false && <Badge variant="warning">Testte bulunamadi</Badge>}
                              {candidateCount(selector) > 1 && (
                                <Badge variant="success">{candidateCount(selector)} yedek aday</Badge>
                              )}
                              {!configured && (SEMANTIC_KEYS.has(selector.key) ? <Badge variant="info">Yerlesik yedek var</Badge> : null)}
                            </div>
                            <p className="mt-1.5 text-[12px] text-muted leading-relaxed max-w-3xl">
                              <span className="font-medium text-foreground">Nerede: </span>
                              {guide?.where ?? selector.description}
                            </p>
                            {guide?.why && (
                              <p className="mt-1 text-[11.5px] text-muted-2 leading-relaxed max-w-3xl">
                                <span className="font-medium">Ne ise yarar: </span>
                                {guide.why}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {selector.lastTestAt && (
                              <span className="text-[10px] text-muted-2 hidden xl:inline">{formatDate(selector.lastTestAt)}</span>
                            )}
                            <Button
                              size="sm"
                              variant={configured ? "outline" : "default"}
                              onClick={() => calibrate(selector.key)}
                              loading={calibratingKey === selector.key}
                              disabled={!session?.browserOpen || quickRunning || (calibratingKey !== null && calibratingKey !== selector.key)}
                            >
                              <Crosshair className="h-3.5 w-3.5" /> {configured ? "Yeniden Tanit" : "Kalibre Et"}
                            </Button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setAdvancedKey(isAdvancedOpen ? null : selector.key)}
                          className="mt-3 flex items-center gap-1 text-[11px] font-medium text-muted-2 hover:text-foreground cursor-pointer"
                        >
                          <ChevronDown className={cn("h-3 w-3 transition-transform", isAdvancedOpen && "rotate-180")} />
                          Gelismis: secici degerini elle duzenle
                          <code className="ml-1 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">{selector.key}</code>
                        </button>

                        {isAdvancedOpen && (
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-[130px_1fr_1fr] gap-2">
                            <Select value={strategy} onValueChange={(v) => editField(selector.key, "strategy", v)}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STRATEGIES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              className="h-8 text-xs font-mono"
                              placeholder="deger (regex / css)"
                              value={value}
                              onChange={(e) => editField(selector.key, "value", e.target.value)}
                            />
                            <Input
                              className="h-8 text-xs font-mono"
                              placeholder="role adi (yalnizca role stratejisinde)"
                              value={roleName}
                              onChange={(e) => editField(selector.key, "roleName", e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {Object.keys(edited).length > 0 && (
        <div className="fixed bottom-6 right-6 z-40">
          <Button onClick={saveManualEdits} size="lg" className="elevated">
            Elle Duzenlemeleri Kaydet
          </Button>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Ipuclari</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[12px] text-muted leading-relaxed">
          <p>
            <span className="font-medium text-foreground">Generate&apos;i kalibre edemiyorsaniz:</span> Proje ayarlarindan &quot;Generate
            dugmesi: Elle basarim&quot; secenegini kullanin. Uygulama promptu yazar ve referansi ekler, Generate&apos;e siz basarsiniz;
            gerisi yine otomatik ilerler.
          </p>
          <p>
            <span className="font-medium text-foreground">Test bulunamadi diyorsa:</span> O oge o an ekranda gorunmuyor olabilir (or.
            indirme menusu kapaliyken). Ilgili ekrani acip testi tekrarlayin.
          </p>
          <p>
            <span className="font-medium text-foreground">Playwright Inspector:</span> Derinlemesine inceleme icin uygulamayi
            PowerShell&apos;de <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px]">$env:PWDEBUG=1; npm run dev</code> ile
            baslatabilirsiniz.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Monitor, FlaskConical, RefreshCw, Rocket } from "lucide-react";
import { api, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckRow, PageHeader } from "@/components/shared";
import { projectWorkspaceHref } from "@/lib/templates";

interface CheckItem {
  ok: boolean;
  label: string;
  detail: string;
}

interface SetupChecks {
  node: CheckItem;
  ffmpeg: CheckItem;
  ffprobe: CheckItem;
  chrome: CheckItem;
  playwright: CheckItem;
  profile: CheckItem;
  openaiKey: CheckItem;
  flowSession: CheckItem;
  selectors: CheckItem;
}

const WIZARD_STEPS: Array<{ title: string; description: string; href?: string; hrefLabel?: string }> = [
  { title: "1. Sistem kontrolleri", description: "Node, FFmpeg, Chrome ve Playwright asagida otomatik kontrol edilir." },
  { title: "2. OpenAI anahtari", description: "Ayarlar ekranindan API anahtarinizi girin ve test edin.", href: "/settings", hrefLabel: "Ayarlar" },
  {
    title: "3. Flow'u acin ve Google'a elle giris yapin",
    description: "Kalibrasyon ekranindan Flow'u acin. Acilan Chrome'da Google hesabiniza bir kez elle giris yapin; oturum profilde saklanir.",
    href: "/calibration",
    hrefLabel: "Kalibrasyon",
  },
  {
    title: "4. Secicileri kalibre edin",
    description: "Prompt kutusu, Generate dugmesi ve indirme menusunu tikla-sec yontemiyle tanitin, ardindan 'Secicileri Test Et' ile dogrulayin.",
    href: "/calibration",
    hrefLabel: "Kalibrasyon",
  },
  { title: "5. Test projesi", description: "Asagidaki dugmeyle 3 kliplik ornek projeyi olusturun ve uctan uca deneyin." },
];

export default function SetupPage() {
  const router = useRouter();
  const [checks, setChecks] = React.useState<SetupChecks | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [openingFlow, setOpeningFlow] = React.useState(false);

  const load = React.useCallback(() => {
    api<SetupChecks>("/api/setup/checks", { silent: true }).then(setChecks).catch(() => {});
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function createSample() {
    setCreating(true);
    try {
      const project = await postJson<{ id: string; templateType: string }>("/api/setup/sample-project");
      toast.success("3 kliplik test projesi olusturuldu");
      router.push(projectWorkspaceHref(project));
    } finally {
      setCreating(false);
    }
  }

  async function openFlow() {
    setOpeningFlow(true);
    try {
      await postJson("/api/flow/open");
      toast.success("Flow acildi. Gerekirse Chrome penceresinde Google'a elle giris yapin.");
      load();
    } finally {
      setOpeningFlow(false);
    }
  }

  return (
    <div className="pb-16 max-w-5xl">
      <PageHeader
        eyebrow="Baslangic"
        title="Kurulum Sihirbazi"
        description="Ilk kullanim icin adim adim kurulum kontrolu"
        actions={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" /> Kontrolleri Yenile
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Sistem Kontrolleri</CardTitle>
            <CardDescription>Eksik olanlar icin detay satirindaki yonergeleri izleyin</CardDescription>
          </CardHeader>
          <CardContent>
            {!checks ? (
              <Skeleton className="h-72" />
            ) : (
              <div>
                <CheckRow ok={checks.node.ok} label={checks.node.label} detail={checks.node.detail} />
                <CheckRow ok={checks.ffmpeg.ok} label={checks.ffmpeg.label} detail={checks.ffmpeg.detail} />
                <CheckRow ok={checks.ffprobe.ok} label={checks.ffprobe.label} detail={checks.ffprobe.detail} />
                <CheckRow ok={checks.chrome.ok} label={checks.chrome.label} detail={checks.chrome.detail} />
                <CheckRow ok={checks.playwright.ok} label={checks.playwright.label} detail={checks.playwright.detail} />
                <CheckRow ok={checks.profile.ok} label={checks.profile.label} detail={checks.profile.detail} />
                <CheckRow ok={checks.openaiKey.ok} label={checks.openaiKey.label} detail={checks.openaiKey.detail} />
                <CheckRow ok={checks.flowSession.ok} label={checks.flowSession.label} detail={checks.flowSession.detail} />
                <CheckRow ok={checks.selectors.ok} label={checks.selectors.label} detail={checks.selectors.detail} />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Adimlar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {WIZARD_STEPS.map((step) => (
                <div key={step.title} className="rounded-[10px] border border-border bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] font-medium">{step.title}</div>
                    {step.href && (
                      <Link href={step.href}>
                        <Button variant="ghost" size="sm">
                          {step.hrefLabel} <ArrowRight className="h-3 w-3" />
                        </Button>
                      </Link>
                    )}
                  </div>
                  <p className="text-[11px] text-muted mt-1 leading-relaxed">{step.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hizli Eylemler</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="secondary" onClick={openFlow} loading={openingFlow}>
                <Monitor className="h-4 w-4" /> Flow&apos;u Ac (elle giris icin)
              </Button>
              <Button onClick={createSample} loading={creating}>
                <FlaskConical className="h-4 w-4" /> 3 Kliplik Test Projesi Olustur
              </Button>
              <p className="text-[11px] text-muted leading-relaxed">
                <Rocket className="h-3 w-3 inline mr-1" />
                Test projesi hazir hikaye ve kliplerle gelir; OpenAI anahtari gerektirmez. Karakter gorseli yukleyip promptlari
                olusturduktan sonra otomasyonu deneyebilirsiniz.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

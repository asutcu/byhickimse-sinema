"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Film,
  FolderKanban,
  ImageIcon,
  PieChart as PieIcon,
  Plus,
  RefreshCw,
  ScrollText,
  Sparkles,
  XCircle,
} from "lucide-react";
import { api, mediaUrl, postJson } from "@/lib/client-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useShellStatus } from "@/components/system-status-provider";
import { CheckRow, EmptyState, ProjectStatusBadge, StatCard } from "@/components/shared";
import { ClipOutcomeChart, TemplateMixChart } from "@/components/panel-charts";
import { cn, formatDate } from "@/lib/utils";
import { isListedNarration, projectWorkspaceHref, templateLabel } from "@/lib/templates";
import { toast } from "sonner";

interface SystemStatus {
  projectCount: number;
  runningJobs: number;
  completedClips: number;
  failedClips: number;
  recentProjects: Array<{ id: string; name: string; status: string; templateType: string; updatedAt: string }>;
  recentEvents: Array<{ id: number; level: string; step: string; message: string; createdAt: string }>;
  flowSession: { status: string; detail: string };
  browserOpen: boolean;
  openaiKeyPresent: boolean;
}

interface FfmpegChecks {
  ffmpeg: { ok: boolean; label: string; detail: string };
  ffprobe: { ok: boolean; label: string; detail: string };
}

interface PlaywrightChecks {
  playwright: { ok: boolean; label: string; detail: string };
  chrome: { ok: boolean; label: string; detail: string };
  profile: { ok: boolean; label: string; detail: string };
}

interface CoverItem {
  id: string;
  name: string;
  templateType: string;
  coverPath: string | null;
}

function ProjectKindIcon({ templateType, className }: { templateType: string; className?: string }) {
  if (templateType === "longform") return <ImageIcon className={className} />;
  if (templateType === "kids_animation") return <Sparkles className={className} />;
  return <Clapperboard className={className} />;
}

export default function DashboardPage() {
  const { tick } = useShellStatus();
  const [status, setStatus] = React.useState<SystemStatus | null>(null);
  const [ffmpeg, setFfmpeg] = React.useState<FfmpegChecks | null>(null);
  const [playwright, setPlaywright] = React.useState<PlaywrightChecks | null>(null);
  const [covers, setCovers] = React.useState<CoverItem[] | null>(null);
  const [openaiTest, setOpenaiTest] = React.useState<string | null>(null);
  const [testingOpenai, setTestingOpenai] = React.useState(false);

  const load = React.useCallback(async () => {
    const [statusData, ffmpegData, playwrightData, projectRows] = await Promise.all([
      api<SystemStatus>("/api/system/status", { silent: true }),
      api<FfmpegChecks>("/api/system/ffmpeg", { silent: true }),
      api<PlaywrightChecks>("/api/system/playwright", { silent: true }),
      api<CoverItem[]>("/api/projects", { silent: true }).catch(() => [] as CoverItem[]),
    ]);
    setStatus(statusData);
    setFfmpeg(ffmpegData);
    setPlaywright(playwrightData);
    setCovers(projectRows);
  }, []);

  React.useEffect(() => {
    load().catch(() => toast.error("Dashboard verisi yuklenemedi"));
  }, [load]);

  React.useEffect(() => {
    if (tick === 0) return;
    api<SystemStatus>("/api/system/status", { silent: true })
      .then(setStatus)
      .catch(() => {});
  }, [tick]);

  async function testOpenAi() {
    setTestingOpenai(true);
    try {
      const result = await postJson<{ ok: boolean; model: string; message: string }>("/api/settings/openai/test");
      setOpenaiTest(result.ok ? `Baglanti basarili (${result.model})` : result.message);
      if (result.ok) toast.success("OpenAI baglantisi basarili");
      else toast.error(result.message);
    } finally {
      setTestingOpenai(false);
    }
  }

  const narratorProjects = status?.recentProjects.filter((p) => isListedNarration(p.templateType)) ?? [];
  const longformCount = narratorProjects.filter((p) => p.templateType === "longform").length;
  const cinemaCount = narratorProjects.filter((p) => p.templateType === "narrator").length;
  const coverById = new Map((covers ?? []).map((c) => [c.id, c.coverPath]));
  const heroCovers = (covers ?? []).filter((c) => c.coverPath).slice(0, 4);

  const flowBadge =
    status?.flowSession.status === "ready" ? (
      <Badge variant="success" dot>
        Oturum hazir
      </Badge>
    ) : status?.browserOpen ? (
      <Badge variant="warning" dot>
        {status.flowSession.status === "needs_login" ? "Giris gerekli" : "Dogrulama gerekli"}
      </Badge>
    ) : (
      <Badge dot>Tarayici kapali</Badge>
    );

  return (
    <div className="space-y-6">
      <section className="hero-panel rounded-[26px] px-6 py-8 sm:px-9 sm:py-10">
        <div className="relative grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div className="rise-in">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/85 px-3 py-1.5 shadow-[0_1px_2px_rgba(15,40,90,0.06)]">
              <span className="icon-tile icon-tile-solid h-5 w-5 rounded-full">
                <Sparkles className="h-3 w-3" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-strong">ByHickimse</span>
            </div>
            <h1 className="mt-5 text-[40px] font-extrabold leading-[1.02] tracking-[-0.045em] sm:text-[56px]">
              <span className="gradient-text">Sinema Stüdyosu</span>
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
              Hikâyeden filme tek akış: senaryo, karakter, Flow sahneleri, seslendirme ve final render. Görsel slayt ya
              da sinema filmi — hepsi tek stüdyoda.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/anlatici/yeni" className={buttonVariants({ size: "lg" })}>
                <Plus className="h-4 w-4" /> Yeni anlatı
              </Link>
              <Link href="/anlatici" className={buttonVariants({ variant: "outline", size: "lg" })}>
                Anlatılara git <ArrowRight className="h-4 w-4" />
              </Link>
              <Button variant="ghost" onClick={() => load()}>
                <RefreshCw className="h-3.5 w-3.5" /> Yenile
              </Button>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[12px] font-semibold text-muted">
              <span className="inline-flex items-center gap-2">
                <span className="icon-tile icon-tile-primary h-6 w-6 rounded-[8px]">
                  <Film className="h-3.5 w-3.5" />
                </span>
                Flow sinema klibi
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="icon-tile icon-tile-sky h-6 w-6 rounded-[8px]">
                  <ImageIcon className="h-3.5 w-3.5" />
                </span>
                Nano Banana görsel
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="icon-tile icon-tile-success h-6 w-6 rounded-[8px]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
                FFmpeg final render
              </span>
            </div>
          </div>

          <div className="relative hidden lg:block">
            {covers === null ? (
              <Skeleton className="aspect-[4/3] w-full rounded-[22px]" />
            ) : heroCovers.length === 0 ? (
              <div className="cover-fallback flex aspect-[4/3] items-center justify-center rounded-[22px] border border-white/60">
                <span className="icon-tile icon-tile-solid h-16 w-16 rounded-[20px]">
                  <Clapperboard className="h-7 w-7" />
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-6 grid-rows-6 gap-3 aspect-[4/3]">
                {heroCovers.map((c, i) => (
                  <Link
                    key={c.id}
                    href={projectWorkspaceHref(c)}
                    className={cn(
                      "group relative overflow-hidden rounded-[18px] border border-white/70 shadow-[0_18px_40px_-22px_rgba(15,40,90,0.55)]",
                      i === 0 && "col-span-4 row-span-4",
                      i === 1 && "col-span-2 row-span-3",
                      i === 2 && "col-span-2 row-span-3",
                      i === 3 && "col-span-4 row-span-2"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl(c.coverPath!)}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                    />
                    <div className="cover-shade absolute inset-0" />
                    <div className="absolute inset-x-3 bottom-2.5 flex items-center gap-1.5 text-[11.5px] font-bold text-white">
                      <ProjectKindIcon templateType={c.templateType} className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{c.name}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {!status ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[128px] rounded-[18px]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Anlatı"
            value={status.projectCount}
            icon={<FolderKanban className="h-5 w-5" />}
            tone="primary"
            hint={status.projectCount === 0 ? "Ilk anlatinizi olusturun" : "Görsel ve sinema"}
          />
          <StatCard
            label="Çalışan görev"
            value={status.runningJobs}
            icon={<Activity className="h-5 w-5" />}
            tone={status.runningJobs > 0 ? "warning" : "default"}
            hint={status.runningJobs > 0 ? "Otomasyon aktif" : "Kuyruk boş"}
          />
          <StatCard
            label="Tamamlanan klip"
            value={status.completedClips}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="success"
            hint="Doğrulanmış videolar"
          />
          <StatCard
            label="Başarısız"
            value={status.failedClips}
            icon={<XCircle className="h-5 w-5" />}
            tone={status.failedClips > 0 ? "danger" : "default"}
            hint={status.failedClips > 0 ? "Yeniden deneme" : "Sorun yok"}
          />
        </div>
      )}

      {status && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <span className="icon-tile icon-tile-success h-10 w-10 rounded-[12px]">
                <PieIcon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <CardTitle>Klip sonuçları</CardTitle>
                <CardDescription>Tamamlanan ve başarısız klipler</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ClipOutcomeChart completed={status.completedClips} failed={status.failedClips} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <span className="icon-tile icon-tile-primary h-10 w-10 rounded-[12px]">
                <Film className="h-[18px] w-[18px]" />
              </span>
              <div>
                <CardTitle>Anlatı dağılımı</CardTitle>
                <CardDescription>Son listedeki görsel / sinema oranı</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <TemplateMixChart longform={longformCount} narrator={cinemaCount} />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="icon-tile icon-tile-solid h-10 w-10 rounded-[12px]">
                <Clapperboard className="h-[18px] w-[18px]" />
              </span>
              <div>
                <CardTitle>Son anlatılar</CardTitle>
                <CardDescription>En son güncellenen çalışmalar</CardDescription>
              </div>
            </div>
            {narratorProjects.length > 0 && (
              <Link href="/anlatici" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Tümü <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {!status ? (
              <Skeleton className="h-40 rounded-[12px]" />
            ) : narratorProjects.length === 0 ? (
              <EmptyState
                icon={<Film className="h-7 w-7" />}
                title="Henüz anlatı yok"
                description="Görsel anlatı (TTS + slayt) veya sinema anlatıcı film (Flow) oluşturun."
                action={
                  <Link href="/anlatici/yeni" className={buttonVariants({ size: "sm" })}>
                    <Plus className="h-4 w-4" /> Yeni anlatı
                  </Link>
                }
              />
            ) : (
              <div className="space-y-2">
                {narratorProjects.map((project) => {
                  const cover = coverById.get(project.id);
                  return (
                    <Link
                      key={project.id}
                      href={projectWorkspaceHref(project)}
                      className="group flex items-center justify-between gap-3 rounded-[14px] border border-border bg-surface-2/60 px-3 py-2.5 hover:border-primary/30 hover:bg-white hover:shadow-[0_12px_28px_-20px_rgba(37,99,235,0.5)]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="relative h-11 w-[72px] shrink-0 overflow-hidden rounded-[10px] border border-border bg-surface-3">
                          {cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaUrl(cover)} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <span className="cover-fallback flex h-full w-full items-center justify-center text-primary-strong">
                              <ProjectKindIcon templateType={project.templateType} className="h-4 w-4" />
                            </span>
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-bold">{project.name}</div>
                          <div className="text-[11.5px] text-muted-2">
                            {templateLabel(project.templateType)} · {formatDate(project.updatedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <ProjectStatusBadge status={project.status} />
                        <span className="icon-tile icon-tile-neutral h-8 w-8 rounded-[10px] group-hover:text-primary-strong">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <span className="icon-tile icon-tile-sky h-10 w-10 rounded-[12px]">
              <Cpu className="h-[18px] w-[18px]" />
            </span>
            <div>
              <CardTitle>Sistem</CardTitle>
              <CardDescription>FFmpeg, Playwright, OpenAI, Flow</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!ffmpeg || !playwright || !status ? (
              <Skeleton className="h-48 rounded-[12px]" />
            ) : (
              <div>
                <CheckRow ok={ffmpeg.ffmpeg.ok} label="FFmpeg" detail={ffmpeg.ffmpeg.detail} />
                <CheckRow ok={ffmpeg.ffprobe.ok} label="ffprobe" detail={ffmpeg.ffprobe.detail} />
                <CheckRow ok={playwright.playwright.ok} label="Playwright" detail={playwright.playwright.detail} />
                <CheckRow ok={playwright.chrome.ok} label="Google Chrome" detail={playwright.chrome.detail} />
                <div className="flex items-center justify-between border-b border-border py-3">
                  <span className="text-[13px] font-semibold">Flow Oturumu</span>
                  {flowBadge}
                </div>
                <div className="flex items-center justify-between gap-2 pt-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold">OpenAI API</div>
                    {openaiTest ? (
                      <div className="mt-0.5 break-all text-[11px] text-muted">{openaiTest}</div>
                    ) : (
                      <div className="mt-0.5 text-[11px] text-muted-2">
                        {status.openaiKeyPresent ? "Anahtar ayarli" : "Ayarlardan ekleyin"}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={testOpenAi}
                    loading={testingOpenai}
                    disabled={!status.openaiKeyPresent}
                  >
                    Test Et
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="icon-tile icon-tile-neutral h-10 w-10 rounded-[12px]">
              <ScrollText className="h-[18px] w-[18px]" />
            </span>
            <div>
              <CardTitle>Olaylar</CardTitle>
              <CardDescription>Otomasyon günlüğü</CardDescription>
            </div>
          </div>
          {status && status.runningJobs > 0 && (
            <Badge variant="warning" dot pulse>
              Canli
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {!status ? (
            <Skeleton className="h-32 rounded-[12px]" />
          ) : status.recentEvents.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted">Henuz olay kaydi yok</p>
          ) : (
            <div className="max-h-80 divide-y divide-border overflow-y-auto rounded-[14px] border border-border bg-surface-2/50">
              {status.recentEvents.map((event) => (
                <div key={event.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white">
                  <span className="shrink-0 pt-0.5 font-mono text-[10.5px] tabular-nums text-muted-2">
                    {formatDate(event.createdAt).split(" ")[1]}
                  </span>
                  <Badge
                    variant={event.level === "error" ? "danger" : event.level === "warning" ? "warning" : "info"}
                    className="shrink-0"
                  >
                    {event.step || event.level}
                  </Badge>
                  <span className="break-all text-[12px] leading-relaxed text-muted">{event.message}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

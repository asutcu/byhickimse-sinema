"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Monitor,
  CircleStop,
  ListRestart,
  Pause,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldOff,
  SkipForward,
  SlidersHorizontal,
  Cpu,
} from "lucide-react";
import { api, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ClipStatusBadge, EmptyState } from "@/components/shared";
import type { EventData, ProjectData } from "@/components/project/types";
import { cn, formatDate } from "@/lib/utils";
import { emptyDialogueHint } from "@/lib/templates";

interface SessionInfo {
  status: string;
  detail: string;
  browserOpen: boolean;
}

interface FlowValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function AutomationTab({
  project,
  reload,
  liveEvents,
  onOpenSettings,
}: {
  project: ProjectData;
  reload: () => Promise<ProjectData>;
  liveEvents: EventData[];
  onOpenSettings?: () => void;
}) {
  const [session, setSession] = React.useState<SessionInfo | null>(null);
  const [validation, setValidation] = React.useState<FlowValidation | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const eventsEndRef = React.useRef<HTMLDivElement>(null);

  const activeJob = project.jobs.find((j) => ["running", "paused", "needs_manual_action", "pending"].includes(j.state)) ?? null;

  const refreshSession = React.useCallback(() => {
    api<SessionInfo>("/api/flow/session", { silent: true }).then(setSession).catch(() => {});
  }, []);

  React.useEffect(() => {
    refreshSession();
    const interval = setInterval(refreshSession, 12_000);
    return () => clearInterval(interval);
  }, [refreshSession]);

  React.useEffect(() => {
    api<FlowValidation>(`/api/projects/${project.id}/flow-validation`, { silent: true })
      .then(setValidation)
      .catch(() => {});
  }, [project.id, project.flowModel, project.clipSeconds, project.aspectRatio, project.useReference, project.usePrevLastFrame]);

  React.useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [liveEvents.length]);

  async function run(action: string, fn: () => Promise<unknown>, successMessage?: string) {
    setBusy(action);
    try {
      await fn();
      if (successMessage) toast.success(successMessage);
      await reload();
      refreshSession();
    } finally {
      setBusy(null);
    }
  }

  const completedCount = project.clips.filter((c) => c.status === "completed").length;
  const failedCount = project.clips.filter((c) => ["failed", "needs_manual_action"].includes(c.status)).length;
  const progress = project.clips.length > 0 ? (completedCount / project.clips.length) * 100 : 0;
  const promptsReady = project.clips.length > 0 && project.clips.every((c) => c.prompt.trim().length > 0);

  const hasProgress = project.clips.some((c) => c.status !== "draft");
  const jobRunning = activeJob?.state === "running";
  const jobPaused = activeJob?.state === "paused";
  const needsManual = activeJob?.state === "needs_manual_action";
  const jobActive = !!(jobRunning || jobPaused || needsManual || activeJob?.state === "pending");
  const configInvalid = validation !== null && !validation.ok;
  const emptyDialogueCount = project.clips.filter((c) => !c.dialogue.trim()).length;
  const stalePromptCount = project.clips.filter((c) => c.prompt.trim() && c.dialogue.trim() && !c.prompt.includes(c.dialogue.trim().slice(0, 30))).length;
  const contentBlocked = emptyDialogueCount > 0 || stalePromptCount > 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
      {contentBlocked && (
        <div className="xl:col-span-2">
          <Card className="border-warning/30 bg-warning-soft">
            <CardContent className="p-4 flex items-start gap-3">
              <ShieldAlert className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="min-w-0 text-[13px]">
                {emptyDialogueCount > 0 ? (
                  <>
                    <div className="font-semibold text-warning">
                      {emptyDialogueCount} klibin konusma metni bos  -  otomasyon baslatilamaz
                    </div>
                    <p className="mt-1 text-[12px] text-muted leading-relaxed">
                      {emptyDialogueHint(project.templateType)}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="font-semibold text-warning">
                      {stalePromptCount} klibin promptu guncel metni icermiyor
                    </div>
                    <p className="mt-1 text-[12px] text-muted leading-relaxed">
                      Klip metinleri prompt uretildikten sonra degismis. Promptlar sekmesinden &quot;Tum Promptlari Olustur&quot; ile
                      yenileyin.
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {configInvalid && (
        <div className="xl:col-span-2">
          <Card className="border-danger/30 bg-danger-soft/50">
            <CardContent className="p-4 flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <ShieldAlert className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-danger">Flow ayarlari gecersiz  -  otomasyon baslamaz</div>
                  {validation!.errors.map((error, i) => (
                    <p key={i} className="text-[12px] text-danger mt-1 leading-relaxed">
                      -  {error}
                    </p>
                  ))}
                  <p className="text-[11.5px] text-muted mt-1.5">
                    Bu ayarlar projeye ozeldir; Proje Ayarlari sekmesinden duzeltebilirsiniz.
                  </p>
                </div>
              </div>
              {onOpenSettings && (
                <Button size="sm" onClick={onOpenSettings}>
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Proje Ayarlarini Ac
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle>Kontroller</CardTitle>
                <CardDescription>
                  Mod: {project.automationMode === "semi" ? "Yari otomatik" : "Tam otomatik"} | Generate:{" "}
                  {project.generateButtonMode === "manual" ? "elle basilir" : "otomatik basilir"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {session?.browserOpen ? (
                  session.status === "ready" ? (
                    <Badge variant="success">Flow hazir</Badge>
                  ) : (
                    <Badge variant="warning">{session.detail.slice(0, 60)}</Badge>
                  )
                ) : (
                  <Badge>Tarayici kapali</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => run("open", () => postJson("/api/flow/open"), "Flow acildi")}
                loading={busy === "open"}
              >
                <Monitor className="h-3.5 w-3.5" /> Flow&apos;u Ac
              </Button>
              <Button variant="outline" size="sm" onClick={refreshSession}>
                <RefreshCw className="h-3.5 w-3.5" /> Oturum Kontrolu
              </Button>

              {!jobActive && (
                <Button
                  size="sm"
                  onClick={() =>
                    run("start", () => postJson(`/api/projects/${project.id}/automation/start`), "Otomasyon basladi")
                  }
                  loading={busy === "start"}
                  disabled={!promptsReady || configInvalid || contentBlocked}
                >
                  <Play className="h-3.5 w-3.5" /> Otomasyonu Baslat
                </Button>
              )}
              {jobRunning && (
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-warning/15 text-warning border-warning/30 hover:bg-warning/25"
                  onClick={() => run("pause", () => postJson(`/api/projects/${project.id}/automation/pause`), "Duraklatma istendi")}
                  loading={busy === "pause"}
                >
                  <Pause className="h-3.5 w-3.5" /> Duraklat
                </Button>
              )}
              {(jobPaused || needsManual) && (
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => run("resume", () => postJson(`/api/projects/${project.id}/automation/resume`), "Devam ediliyor")}
                  loading={busy === "resume"}
                >
                  <Play className="h-3.5 w-3.5" /> Devam Ettir
                </Button>
              )}
              {jobActive && (
                <>
                  {jobRunning && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        run("cancel", () => postJson(`/api/projects/${project.id}/automation/cancel-clip`), "Mevcut klip iptal ediliyor")
                      }
                      loading={busy === "cancel"}
                    >
                      <SkipForward className="h-3.5 w-3.5" /> Mevcut Klibi Iptal Et
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() =>
                      run("stop", () => postJson(`/api/projects/${project.id}/automation/stop`), "Otomasyon durduruldu")
                    }
                    loading={busy === "stop"}
                  >
                    <CircleStop className="h-3.5 w-3.5" /> Durdur
                  </Button>
                </>
              )}
              {failedCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    run("retryFailed", () => postJson(`/api/projects/${project.id}/retry-failed`), "Basarisiz klipler kuyruga alindi")
                  }
                  loading={busy === "retryFailed"}
                >
                  <ListRestart className="h-3.5 w-3.5" /> Basarisizlari Yeniden Dene ({failedCount})
                </Button>
              )}
              {hasProgress && !jobActive && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Otomasyon sifirlanacak: TUM kliplerin durumu 'taslak'a donecek, deneme sayaci ve hatalar temizlenecek; uretilmis video dosyalari diskten SILINECEK (geri alinamaz). Otomasyonu tekrar baslattiginizda 1. klipten yeniden basiyacak.\n\nOnayliyor musunuz?"
                      )
                    )
                      return;
                    run(
                      "reset",
                      () => postJson(`/api/projects/${project.id}/automation/reset`, { deleteVideos: true }),
                      "Otomasyon sifirlandi; 1. klipten yeniden baslayabilirsiniz"
                    );
                  }}
                  loading={busy === "reset"}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Sifirla (Bastan Baslat)
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => run("close", () => postJson("/api/flow/close"), "Tarayici kapatildi")}
                loading={busy === "close"}
              >
                <Power className="h-3.5 w-3.5" /> Tarayiciyi Kapat
              </Button>
            </div>

            {!promptsReady && (
              <p className="mt-3 text-xs text-warning">
                Otomasyon icin once tum kliplerin promptlari olusturulmali (Promptlar sekmesi).
              </p>
            )}
            {needsManual && activeJob?.pausedReason && (
              <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-danger/40 bg-danger-soft/50 p-3 text-xs text-danger">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Elle dogrulama / mudahale gerekiyor</div>
                  <div className="mt-0.5">{activeJob.pausedReason}</div>
                  <div className="mt-1 text-danger/80">
                    Sorunu Chrome penceresinde cozun (giris, CAPTCHA, kredi vb.), sonra &quot;Devam Ettir&quot;e basin. Uygulama guvenlik
                    dogrulamalarini asmaya CALISMAZ.
                  </div>
                  {/dogrulama|CAPTCHA/i.test(activeJob.pausedReason) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        run("override", () => postJson("/api/flow/session/override", { ignore: true }), "Kontrol atlandi  -  'Devam Ettir'e basabilirsiniz")
                      }
                      loading={busy === "override"}
                    >
                      <ShieldOff className="h-3.5 w-3.5" /> Ekranda dogrulama yok  -  kontrolu atla
                    </Button>
                  )}
                </div>
              </div>
            )}
            {project.generateButtonMode === "manual" && (jobRunning || jobPaused) && (
              <p className="mt-3 text-xs text-info">
                Yari otomatik Generate modu: uygulama promptu yazip referansi ekler; Generate dugmesine Flow penceresinde SIZ basarsiniz.
                Uretim algilandiginda indirme otomatik yapilir.
              </p>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-muted mb-1.5">
                <span>
                  {completedCount}/{project.clips.length} klip tamamlandi
                </span>
                <span>%{Math.round(progress)}</span>
              </div>
              <Progress value={progress} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Uretim Hatti</CardTitle>
            <CardDescription>Her klibin durum makinesindeki canli adimi</CardDescription>
          </CardHeader>
          <CardContent>
            {project.clips.length === 0 ? (
              <EmptyState icon={<Cpu className="h-6 w-6" />} title="Klip yok" description="Once klipleri olusturun." />
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {project.clips.map((clip) => {
                  const isActive = activeJob?.currentClipId === clip.id;
                  return (
                    <div
                      key={clip.id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2",
                        isActive ? "border-primary/50 bg-primary-soft/30" : "border-border bg-surface-2"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("text-xs font-semibold tabular-nums", isActive && "text-primary")}>
                          #{String(clip.index).padStart(3, "0")}
                        </span>
                        <span className="text-[11px] text-muted truncate max-w-[280px]">{clip.dialogue.slice(0, 60)}...</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {clip.attemptCount > 1 && <Badge variant="warning">deneme {clip.attemptCount}</Badge>}
                        {clip.videoPath ? <Badge variant="success">indi</Badge> : null}
                        <ClipStatusBadge status={clip.status} />
                        {(clip.status === "completed" ||
                          clip.status === "failed" ||
                          clip.status === "needs_manual_action") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            loading={busy === `remake-${clip.id}`}
                            onClick={() =>
                              run(
                                `remake-${clip.id}`,
                                () => postJson(`/api/projects/${project.id}/clips/${clip.id}/retry`),
                                clip.status === "completed"
                                  ? `Klip #${String(clip.index).padStart(3, "0")} yeniden yapilacak`
                                  : `Klip #${String(clip.index).padStart(3, "0")} kuyruga alindi`
                              )
                            }
                          >
                            <RotateCcw className="h-3 w-3" /> Yeniden Yap
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Canli Olay Gunlugu</CardTitle>
          <CardDescription>Gizli bilgiler maskelenir; tum olaylar dosya + veritabanina da yazilir</CardDescription>
        </CardHeader>
        <CardContent>
          {liveEvents.length === 0 ? (
            <p className="text-xs text-muted py-6 text-center">Henuz olay yok</p>
          ) : (
            <div className="space-y-1 font-mono text-[10.5px] max-h-[560px] overflow-y-auto">
              {liveEvents.map((event) => (
                <div key={`${event.id}-${event.createdAt}`} className="flex gap-1.5 items-start py-1 border-b border-border/40 last:border-0">
                  <span className="text-muted-2 shrink-0">{formatDate(event.createdAt).split(" ")[1]}</span>
                  <Badge
                    variant={event.level === "error" ? "danger" : event.level === "warning" ? "warning" : "default"}
                    className="shrink-0 text-[9px] px-1.5"
                  >
                    {event.step || event.level}
                  </Badge>
                  <span className="text-muted break-all leading-relaxed">{event.message}</span>
                </div>
              ))}
              <div ref={eventsEndRef} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

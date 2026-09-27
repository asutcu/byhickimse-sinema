"use client";

import * as React from "react";
import { toast } from "sonner";
import { Clapperboard, FolderOpen, Play, XCircle } from "lucide-react";
import { api, mediaUrl, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared";
import type { ProjectData } from "@/components/project/types";
import { SubtitleStyleFields } from "@/components/subtitle-style-fields";
import { DEFAULT_SUBTITLE_STYLE, type BurnSubtitleStyle } from "@/lib/subtitle-style";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

interface QualityReport {
  outputPath: string;
  totalDurationSeconds: number;
  fileSizeBytes: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  clipCount: number;
  skippedClipCount: number;
  skippedIndexes?: number[];
  includedIndexes?: number[];
  mode: "direct" | "reencode";
  warnings: string[];
  cancelled?: boolean;
  jobId?: string;
  outputResolution?: string;
}

interface FinalRenderSummary {
  path: string;
  fileName: string;
  bytes: number;
  createdAt: string;
  mode: string;
  outputResolution: string;
  width: number | null;
  height: number | null;
}

interface RenderJob {
  id: string;
  projectId: string;
  status: "running" | "cancelling" | "completed" | "cancelled" | "failed";
  startedAt: string;
  finishedAt: string | null;
  outputPath: string | null;
  label: string;
  errorMessage: string | null;
  clipCount: number | null;
}

function resolutionBadge(res: string | undefined, width?: number | null, height?: number | null): string {
  if (width && height) return `${width}x${height}`;
  if (res === "2160") return "4K";
  if (res === "1440") return "QHD";
  if (res === "1080") return "Full HD";
  if (res === "source") return "Kaynak";
  return res || "?";
}

function statusLabel(status: RenderJob["status"]): string {
  switch (status) {
    case "running":
      return "Calisiyor";
    case "cancelling":
      return "Iptal ediliyor";
    case "completed":
      return "Tamamlandi";
    case "cancelled":
      return "Iptal";
    case "failed":
      return "Hata";
  }
}

function statusVariant(status: RenderJob["status"]): "warning" | "info" | "success" | "danger" | "default" {
  switch (status) {
    case "running":
      return "warning";
    case "cancelling":
      return "info";
    case "completed":
      return "success";
    case "cancelled":
      return "default";
    case "failed":
      return "danger";
  }
}

export function RenderTab({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const [report, setReport] = React.useState<QualityReport | null>(null);
  const [finals, setFinals] = React.useState<FinalRenderSummary[]>([]);
  const [starting, setStarting] = React.useState(false);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<RenderJob[]>([]);
  const [mode, setMode] = React.useState<"auto" | "direct" | "reencode">("auto");
  const [audioFadeMs, setAudioFadeMs] = React.useState(0);
  const [trimSilence, setTrimSilence] = React.useState(false);
  const [trimBlack, setTrimBlack] = React.useState(false);
  const [outputResolution, setOutputResolution] = React.useState<"source" | "1080" | "1440" | "2160">("source");
  const [subtitleStyle, setSubtitleStyle] = React.useState<BurnSubtitleStyle>({
    ...DEFAULT_SUBTITLE_STYLE,
    enabled: Boolean(project.allowSubtitles),
  });

  const completedClips = [...project.clips]
    .filter((c) => Boolean(c.videoPath))
    .sort((a, b) => a.index - b.index);
  const firstVideoIndex = completedClips[0]?.index ?? Number.POSITIVE_INFINITY;
  const missingLeading = project.clips
    .filter((c) => c.index < firstVideoIndex && !c.videoPath)
    .sort((a, b) => a.index - b.index);

  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "cancelling");
  const recentJobs = jobs.filter((j) => j.status !== "running" && j.status !== "cancelling").slice(0, 5);

  const refreshJobs = React.useCallback(async () => {
    try {
      const data = await api<{ jobs: RenderJob[]; activeCount: number }>(
        `/api/projects/${project.id}/render/jobs`,
        { silent: true }
      );
      setJobs(data.jobs);
    } catch {
      /* ignore */
    }
  }, [project.id]);

  React.useEffect(() => {
    api<{ report: QualityReport | null; finals: FinalRenderSummary[] } | QualityReport | null>(
      `/api/projects/${project.id}/render`,
      { silent: true }
    )
      .then((data) => {
        if (data && typeof data === "object" && "report" in data) {
          setReport(data.report);
          setFinals(data.finals ?? []);
        } else {
          setReport(data as QualityReport | null);
        }
      })
      .catch(() => {});
  }, [project.id, project.status, completedClips.length]);

  React.useEffect(() => {
    void refreshJobs();
    const interval = setInterval(() => {
      void refreshJobs();
    }, 2000);
    return () => clearInterval(interval);
  }, [refreshJobs]);

  async function render() {
    setStarting(true);
    try {
      const result = await postJson<QualityReport>(`/api/projects/${project.id}/render`, {
        mode,
        audioFadeMs,
        trimSilence,
        trimBlack,
        outputResolution,
        burnSubtitles: subtitleStyle.enabled,
        subtitleStyle,
      });
      await refreshJobs();
      if (result.cancelled) {
        toast.message("Birlestirme iptal edildi");
        await reload();
        return;
      }
      setReport(result);
      await reload();
      const refreshed = await api<{ report: QualityReport | null; finals: FinalRenderSummary[] }>(
        `/api/projects/${project.id}/render`,
        { silent: true }
      ).catch(() => null);
      if (refreshed?.finals) setFinals(refreshed.finals);
      toast.success(
        outputResolution === "source"
          ? "Final video olusturuldu"
          : `Final video olusturuldu (${outputResolution === "2160" ? "4K" : outputResolution === "1440" ? "QHD" : "Full HD"} ${result.width}x${result.height})`
      );
    } finally {
      setStarting(false);
      await refreshJobs();
    }
  }

  async function cancelJob(jobId: string) {
    setCancellingId(jobId);
    try {
      await postJson(`/api/projects/${project.id}/render/jobs/${jobId}/cancel`);
      toast.success("Iptal istendi — yalnizca bu is durdurulacak");
      await refreshJobs();
    } finally {
      setCancellingId(null);
    }
  }

  if (completedClips.length === 0) {
    return (
      <EmptyState
        icon={<Clapperboard className="h-6 w-6" />}
        title="Henuz tamamlanmis klip yok"
        description="FFmpeg birlestirmesi icin once otomasyonla klip videolarini uretin. Tamamlanan klipler siraya gore tek MP4'e birlestirilir."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Birlestirme Ayarlari</CardTitle>
          <CardDescription>
            {completedClips.length} tamamlanmis klip birlestirilecek.
            {" "}Cikti: H.264 + AAC 48kHz, yuv420p, +faststart (web uyumlu MP4).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Yontem</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Otomatik (uygunsa dogrudan, degilse yeniden kodla)</SelectItem>
                <SelectItem value="direct">Dogrudan birlestir (concat, cok hizli)</SelectItem>
                <SelectItem value="reencode">Yeniden kodlayarak birlestir (guvenli)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Cikti cozunurlugu</Label>
            <Select value={outputResolution} onValueChange={(v) => setOutputResolution(v as typeof outputResolution)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="source">Kaynak (Flow klip boyutu — en dogru)</SelectItem>
                <SelectItem value="1080">Full HD 1080p</SelectItem>
                <SelectItem value="1440">QHD 1440p</SelectItem>
                <SelectItem value="2160">4K UHD 2160p</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-2 mt-1">
              QHD/4K: yeniden kodlama gerekir (48 klipte birkac dakika surebilir; dogrudan birlestirmeden yavas). Kaynak
              720p ise buyutme detay eklemez; yine de YouTube icin hedef boyutta cikti verir.
            </p>
            {outputResolution !== "source" && (
              <p className="text-[11px] text-info mt-1.5 rounded-[8px] border border-info/30 bg-info/5 px-2.5 py-2">
                Secim: {outputResolution === "2160" ? "4K" : outputResolution === "1440" ? "QHD" : "Full HD"} — FFmpeg
                yeniden kodlayacak. Hizli &quot;dogrudan&quot; birlestirme bu boyutta kullanilmaz.
              </p>
            )}
          </div>
          {missingLeading.length > 0 && (
            <p className="text-[11px] text-warning rounded-[8px] border border-warning/30 bg-warning/5 px-2.5 py-2">
              Final su an #{completedClips[0]?.index ?? "?"} ile baslar — onceki sahneler (#
              {missingLeading.map((c) => c.index).join(", #")}) henuz videosuz. Oncesine eklenen klipleri otomasyonda
              uretin, sonra tekrar birlestirin.
            </p>
          )}
          <div>
            <Label>Ses gecisi (klip birlesim noktalarinda)</Label>
            <Select value={String(audioFadeMs)} onValueChange={(v) => setAudioFadeMs(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Kapali</SelectItem>
                <SelectItem value="50">50 ms</SelectItem>
                <SelectItem value="100">100 ms</SelectItem>
                <SelectItem value="150">150 ms</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-2 mt-1">Goruntu gecisi varsayilan olarak kapalidir; yalnizca ses yumusatilir.</p>
          </div>
          <div className="flex items-center justify-between rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
            <span className="text-xs font-medium">Sessiz bosluklari kirp</span>
            <Switch checked={trimSilence} onCheckedChange={setTrimSilence} />
          </div>
          <div className="flex items-center justify-between rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
            <span className="text-xs font-medium">Baslangic/bitis siyah karelerini kirp</span>
            <Switch checked={trimBlack} onCheckedChange={setTrimBlack} />
          </div>
          <SubtitleStyleFields value={subtitleStyle} onChange={setSubtitleStyle} />
          {subtitleStyle.enabled && (
            <p className="text-[10px] text-muted-2 -mt-2">
              Yazı kliplerin konuşma metninden gelir. Açıkken FFmpeg yeniden kodlar; doğrudan birleştirme kullanılmaz.
            </p>
          )}
          {activeJobs.length > 0 && (
            <p className="text-[11px] text-warning rounded-[8px] border border-warning/30 bg-warning/5 px-2.5 py-2">
              {activeJobs.length} birlestirme zaten calisiyor. Yeni baslatabilirsiniz; her is ayri listelenir ve tek tek
              iptal edilebilir.
            </p>
          )}
          <Button onClick={render} loading={starting} className="w-full" size="lg">
            <Clapperboard className="h-4 w-4" />{" "}
            {starting ? "Baslatiliyor..." : activeJobs.length > 0 ? "Yeni Birlestirme Baslat" : "Final Videoyu Olustur"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {(activeJobs.length > 0 || recentJobs.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Birlestirme Islemleri</CardTitle>
              <CardDescription>
                Cift baslatmada her is ayri gorunur. Iptal yalnizca secilen FFmpeg surecini keser; digeri devam eder.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {[...activeJobs, ...recentJobs].map((job) => (
                <div
                  key={job.id}
                  className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge>
                      <span className="text-xs font-medium truncate">{job.label}</span>
                    </div>
                    <p className="text-[10px] text-muted-2">
                      #{job.id.slice(0, 8)} · {new Date(job.startedAt).toLocaleTimeString("tr-TR")}
                      {job.outputPath ? ` · ${job.outputPath.split(/[/\\]/).pop()}` : ""}
                    </p>
                    {job.errorMessage && <p className="text-[10px] text-destructive">{job.errorMessage}</p>}
                  </div>
                  {(job.status === "running" || job.status === "cancelling") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={job.status === "cancelling" || cancellingId === job.id}
                      onClick={() => cancelJob(job.id)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {job.status === "cancelling" || cancellingId === job.id ? "Iptal..." : "Iptal"}
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {report ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Final Video</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      postJson(`/api/projects/${project.id}/open-folder?target=final`).then(() => toast.success("Dosya konumu acildi"))
                    }
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> Dosya Konumunu Ac
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <video src={mediaUrl(report.outputPath)} controls className="w-full max-h-[420px]" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Kalite Raporu</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  {[
                    { label: "Toplam Sure", value: formatDuration(report.totalDurationSeconds) },
                    { label: "Dosya Boyutu", value: formatBytes(report.fileSizeBytes) },
                    { label: "Cozunurluk", value: `${report.width}x${report.height}` },
                    { label: "FPS", value: report.fps.toFixed(2) },
                    { label: "Video Codec", value: report.videoCodec },
                    { label: "Ses Codec", value: report.audioCodec ?? "yok" },
                    { label: "Kullanilan Klip", value: String(report.clipCount) },
                    {
                      label: "Atlanan Klip",
                      value:
                        report.skippedIndexes && report.skippedIndexes.length > 0
                          ? `#${report.skippedIndexes.slice(0, 6).join(", #")}${report.skippedIndexes.length > 6 ? "…" : ""}`
                          : String(report.skippedClipCount),
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[10px] border border-border bg-surface-2 p-3">
                      <div className="text-[10px] text-muted uppercase tracking-wide">{item.label}</div>
                      <div className="mt-1 text-sm font-semibold">{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Badge variant={report.mode === "direct" ? "success" : "info"}>
                    {report.mode === "direct" ? "Dogrudan birlestirildi" : "Yeniden kodlandi"}
                  </Badge>
                  <Badge variant="primary">
                    {resolutionBadge(report.outputResolution, report.width, report.height)}
                  </Badge>
                  <span className="text-[11px] text-muted-2 break-all">{report.outputPath}</span>
                </div>
                {report.warnings.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {report.warnings.map((warning, i) => (
                      <p key={i} className="text-[11px] text-warning">
                        • {warning}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <EmptyState
            icon={<Play className="h-6 w-6" />}
            title="Henuz final video yok"
            description="Soldaki ayarlarla birlestirmeyi baslatin. Onceki render varsa burada kalite raporuyla birlikte gorunur."
          />
        )}

        {finals.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Onceki Final Dosyalari</CardTitle>
              <CardDescription>
                Son birlestirme kaynak (720p) olsa bile onceki QHD/Full HD dosyalari burada kalir — tiklayip onizleyebilirsin.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {finals.map((f) => {
                const active = report?.outputPath === f.path;
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() =>
                      setReport((prev) =>
                        prev
                          ? {
                              ...prev,
                              outputPath: f.path,
                              fileSizeBytes: f.bytes,
                              width: f.width ?? prev.width,
                              height: f.height ?? prev.height,
                              mode: (f.mode as "direct" | "reencode") || prev.mode,
                              outputResolution: f.outputResolution,
                            }
                          : {
                              outputPath: f.path,
                              totalDurationSeconds: 0,
                              fileSizeBytes: f.bytes,
                              width: f.width ?? 0,
                              height: f.height ?? 0,
                              fps: 0,
                              videoCodec: "",
                              audioCodec: null,
                              clipCount: 0,
                              skippedClipCount: 0,
                              mode: (f.mode as "direct" | "reencode") || "reencode",
                              warnings: [],
                              outputResolution: f.outputResolution,
                              includedIndexes: [],
                              skippedIndexes: [],
                            }
                      )
                    }
                    className={`w-full text-left flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5 transition-colors ${
                      active ? "border-primary/40 bg-primary/5" : "border-border bg-surface-2 hover:bg-surface-3"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{f.fileName}</div>
                      <div className="text-[10px] text-muted-2">
                        {new Date(f.createdAt).toLocaleString("tr-TR")} · {formatBytes(f.bytes)}
                      </div>
                    </div>
                    <Badge variant={f.outputResolution === "source" ? "default" : "success"}>
                      {resolutionBadge(f.outputResolution, f.width, f.height)}
                    </Badge>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Klip Onizlemeleri</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {completedClips.map((clip) => (
                <div key={clip.id} className="rounded-[10px] border border-border bg-surface-2 p-2">
                  <video src={mediaUrl(clip.videoPath!)} controls preload="metadata" className="w-full" />
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted">
                    <span>#{String(clip.index).padStart(3, "0")}</span>
                    <span>{clip.actualDurationSeconds ? `${clip.actualDurationSeconds.toFixed(1)} sn` : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

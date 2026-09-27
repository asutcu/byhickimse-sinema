"use client";

import * as React from "react";
import { toast } from "sonner";
import { Captions, Check, Clapperboard, Clock, Download, ImageIcon, Megaphone, Music2, RotateCcw, Sparkles, Square } from "lucide-react";
import { Input } from "@/components/ui/input";
import { longformPhaseLabel, type LongformProduceStep } from "@/lib/longform-pipeline";
import { api, del, mediaUrl, patchJson, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EventData, ProjectData } from "@/components/project/types";
import { resolveNarratorGenre } from "@/lib/narrator-genres";
import { cn } from "@/lib/utils";
import { formatElapsed, useElapsedSeconds } from "@/lib/use-elapsed";
import { LongformImageSourcePicker } from "@/components/longform-image-source-picker";
import { TtsVoicePicker } from "@/components/tts-voice-picker";
import { SubtitleStyleFields } from "@/components/subtitle-style-fields";
import {
  DEFAULT_LONGFORM_SETTINGS,
  LONGFORM_DURATION_PRESETS,
  LONGFORM_GENRES,
  LONGFORM_STILL_INTERVALS,
  LONGFORM_VOICES,
  estimateLongformStillCount,
  formatLongformCastBudget,
  longformImageSourceLabel,
  longformNamedCastBudget,
  parseLongformSettings,
  type LongformGenreId,
  type LongformSettings,
  type LongformStillInterval,
  type LongformStillMotion,
  type LongformVoiceId,
} from "@/lib/longform-catalog";
import {
  LONGFORM_ENCODER_INFO,
  LONGFORM_FPS_OPTIONS,
  LONGFORM_RESOLUTION_INFO,
  longformEncodeProfile,
  longformFrameSize,
  longformResolutionInfo,
  type LongformEncoder,
  type LongformFps,
} from "@/lib/longform-render";

interface LongformJob {
  phase: string;
  step: number;
  totalSteps: number;
  message: string;
  error: string | null;
  outputPath: string | null;
  finishedAt: string | null;
}

interface LongformSnapshot {
  settings: LongformSettings;
  stillEstimate: number;
  story: {
    title: string;
    summary: string;
    hook: string;
    estimatedWords: number;
    estimatedDurationSeconds: number;
    hasText: boolean;
    excerpt?: string;
  } | null;
  beats: Array<{
    id: string;
    index: number;
    dialogue: string;
    sceneImagePath: string | null;
    videoPath: string | null;
    estimatedDurationSeconds: number;
    actualDurationSeconds: number | null;
  }>;
  musicFiles: Array<{ fileName: string; source: string }>;
  voiceReady: boolean;
  finalReady: boolean;
  finalPath: string | null;
  finalBytes?: number;
  finalUpdatedAt?: string | null;
  actualSpeechSeconds?: number;
  readyStillCount?: number;
  job: LongformJob | null;
}

function slidePreviewSrc(filePath: string, updatedAt?: string | null): string {
  const base = mediaUrl(filePath);
  return updatedAt ? `${base}&v=${encodeURIComponent(updatedAt)}` : base;
}

function formatFileMb(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LongformSlidePreview({
  filePath,
  updatedAt,
  bytes,
  mixing = false,
}: {
  filePath: string;
  updatedAt?: string | null;
  bytes?: number;
  mixing?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  const src = slidePreviewSrc(filePath, updatedAt);
  React.useEffect(() => {
    setFailed(false);
  }, [src, mixing]);

  return (
    <div className="space-y-2">
      {mixing ? (
        <div className="flex aspect-video max-h-[520px] w-full items-center justify-center rounded-[12px] border border-border bg-black px-6 text-center">
          <p className="text-[13px] text-white/80 leading-relaxed">
            Slayt şu an birleştiriliyor. Tarayıcı yarım kalan dosyayı açamaz; bitince film burada oynar.
          </p>
        </div>
      ) : (
        <video
          key={src}
          className="w-full aspect-video max-h-[520px] rounded-[12px] border border-border bg-black"
          src={src}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      )}
      {failed && !mixing && (
        <p className="text-[12px] text-warning leading-relaxed">
          Tarayıcı bu dosyayı oynatamadı — genelde render sürerken yarım kalan mp4 yüzünden olur. Sayfayı yenile;
          olmazsa indirip VLC veya klasörden aç.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={src}
          download="final.mp4"
          className="inline-flex h-8 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-xs font-medium hover:bg-surface-2"
        >
          <Download className="h-3.5 w-3.5" /> Filmi indir{formatFileMb(bytes) ? ` (${formatFileMb(bytes)})` : ""}
        </a>
      </div>
    </div>
  );
}

const PAGE_SIZE = 24;

export function LongformStudioTab({
  project,
  reload,
  liveEvents,
  onOpenPublish,
}: {
  project: ProjectData;
  reload: () => Promise<ProjectData>;
  liveEvents: EventData[];
  onOpenPublish: () => void;
}) {
  const [snap, setSnap] = React.useState<LongformSnapshot | null>(null);
  const [settings, setSettings] = React.useState<LongformSettings>(() =>
    parseLongformSettings(project.longformSettings || project.seriesHook)
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [topic, setTopic] = React.useState(project.topic);
  const [suggestingTopic, setSuggestingTopic] = React.useState(false);
  const [savingTopic, setSavingTopic] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [customDuration, setCustomDuration] = React.useState(
    () => !LONGFORM_DURATION_PRESETS.filter((d) => d.value > 0).some((d) => d.value === project.targetDurationSeconds)
  );
  const elapsed = useElapsedSeconds(busy !== null);

  const load = React.useCallback(async () => {
    const data = await api<LongformSnapshot>(`/api/projects/${project.id}/longform`, { silent: true });
    setSnap(data);
    setSettings(data.settings);
    return data;
  }, [project.id]);

  React.useEffect(() => {
    load().catch(() => {});
  }, [load]);

  React.useEffect(() => {
    const running = snap?.job && !snap.job.finishedAt;
    if (!running) return;
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [load, snap?.job?.finishedAt, snap?.job?.phase]);

  // Uretim SSE ile projeyi tazeler; kaydedilmemis konu yazisini ezmesin.
  const topicDirty = topic !== project.topic;
  React.useEffect(() => {
    setTopic((current) => (current === project.topic ? current : current.trim() ? current : project.topic));
  }, [project.topic]);

  async function saveSettings(next: LongformSettings) {
    setSettings(next);
    await patchJson(`/api/projects/${project.id}/longform`, next);
    await load();
  }

  async function saveTopic() {
    setSavingTopic(true);
    try {
      await patchJson(`/api/projects/${project.id}`, { topic });
      await reload();
      toast.success("Konu kaydedildi");
    } finally {
      setSavingTopic(false);
    }
  }

  /** Sinema ile AYNI konu uretici: NetShort tur kilitleri birebir. */
  async function suggestTopic() {
    if (settings.genreId === "ozel" && !settings.customGenre.trim()) {
      toast.error("Ozel tur icin once bir ad yazin");
      return;
    }
    const resolved = resolveNarratorGenre(settings.genreId === "ozel" ? settings.customGenre : settings.genreId);
    const customGenre =
      resolved.id === "ozel"
        ? settings.customGenre.trim() || LONGFORM_GENRES.find((g) => g.id === settings.genreId)?.label || settings.genreId
        : "";
    setSuggestingTopic(true);
    try {
      const result = await postJson<{ topic: string; title: string; hook: string }>("/api/narrator/suggest-topic", {
        genreId: resolved.id,
        customGenre,
        topic,
        title: project.title,
        speechLanguage: project.speechLanguage,
        storyLanguage: project.storyLanguage,
        targetDurationSeconds: project.targetDurationSeconds,
        // Tam senaryoyu uretim yazar; burada sonuca bagli kisa omurga yeter.
        kind: "brief",
        targetWordCount: 140,
      });
      setTopic(result.topic);
      toast.success("OpenAI secilen ture gore konu yazdi — Kaydet ile onayla");
    } finally {
      setSuggestingTopic(false);
    }
  }

  async function saveDuration(seconds: number) {
    await patchJson(`/api/projects/${project.id}`, {
      targetDurationSeconds: Math.max(20, Math.min(3600, seconds)),
    });
    await reload();
    await load();
  }

  async function produce(step: LongformProduceStep = "all", restart = false) {
    if (!project.topic.trim()) {
      toast.error("Once konu yazin (Ayarlar veya yeni anlati)");
      return;
    }
    if (settings.genreId === "ozel" && !settings.customGenre.trim()) {
      toast.error("Ozel tur icin bir ad yazin — hikaye o kelimeye gore gelir");
      return;
    }
    setBusy(restart ? "restart" : step);
    try {
      // Render/mix baslamadan once paneldeki alt yazi + encode ayari diske yazilsin.
      await patchJson(`/api/projects/${project.id}/longform`, settings);
      await postJson(`/api/projects/${project.id}/longform/produce`, { step, restart });
      toast.success(
        restart
          ? "Bastan uretim basladi (senaryo dahil her sey yenilenecek)"
          : step === "all"
            ? "Uretim basladi — hazir adimlar atlanip kaldigi yerden devam edilecek"
            : `${longformPhaseLabel(step)} basladi`
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function produceFromScratch() {
    const ok = window.confirm(
      "Bastan uretilsin mi?\n\nMevcut senaryo, beatler, ses ve TUM hazir gorseller silinip sifirdan uretilir. Kaldigi yerden devam etmek istiyorsan bu dugmeyi kullanma."
    );
    if (!ok) return;
    await produce("all", true);
  }

  async function cancel() {
    await del(`/api/projects/${project.id}/longform/produce`);
    toast.message("Iptal istendi");
    await load();
  }

  const job = snap?.job;
  const running = !!(job && !job.finishedAt);
  const mixRunning = running && job?.phase === "mix";
  const stillEstimate = estimateLongformStillCount(project.targetDurationSeconds, settings.stillIntervalSeconds);
  const progress = job ? Math.round((job.step / Math.max(1, job.totalSteps)) * 100) : snap?.finalReady ? 100 : 0;
  const durationChoice = customDuration
    ? -1
    : LONGFORM_DURATION_PRESETS.some((d) => d.value === project.targetDurationSeconds)
      ? project.targetDurationSeconds
      : -1;

  // Hangi adimlar hazir: "Gorselleri uret" bunlari atlayip eksikten devam eder.
  const readyStills = snap?.beats.filter((b) => b.sceneImagePath).length ?? 0;
  const totalBeats = snap?.beats.length ?? 0;
  const resumeSteps: string[] = [];
  if (snap?.story?.hasText) resumeSteps.push("Senaryo");
  if (totalBeats > 0) resumeSteps.push(`Parcalar (${totalBeats})`);
  if (snap?.voiceReady) resumeSteps.push("Ses");
  if (readyStills > 0) resumeSteps.push(`Gorseller ${readyStills}/${totalBeats || readyStills}`);
  if (snap?.finalReady) resumeSteps.push("Slayt");
  const nextStepLabel = !snap?.story?.hasText
    ? "Senaryo"
    : totalBeats === 0
      ? "Parcalar"
      : !snap?.voiceReady
        ? "Ses"
        : readyStills < totalBeats
          ? "Gorseller"
          : !snap?.finalReady
            ? "Slayt montaj"
            : "";

  return (
    <div className="space-y-4">
      <Card className={cn(!project.topic.trim() && "border-warning/30 bg-warning-soft/20")}>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Konu</CardTitle>
              <CardDescription>
                Senaryo bu konudan yazilir; sonra karelere bolunur ve seslendirilir. Hikaye oner, yukarida secili ture
                gore sonuca bagli bir omurga yazar.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={suggestingTopic}
                disabled={suggestingTopic || savingTopic}
                onClick={() => void suggestTopic()}
              >
                <Sparkles className="h-3.5 w-3.5" /> Hikaye oner
              </Button>
              <Button size="sm" loading={savingTopic} disabled={!topicDirty || savingTopic} onClick={() => void saveTopic()}>
                <Check className="h-3.5 w-3.5" /> Kaydet
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={4}
            className="w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed"
            placeholder="Anlatilacak hikayenin konusu — Hikaye oner ile yazdirabilirsin"
          />
          {!project.topic.trim() && (
            <p className="mt-1.5 text-[11px] text-warning leading-relaxed">
              Konu bos: uretim baslamadan buraya bir konu yazin veya Hikaye oner&apos;i kullanin.
            </p>
          )}
        </CardContent>
      </Card>

      {snap?.finalReady && snap.finalPath && (
        <Card>
          <CardHeader>
            <CardTitle>Slayt önizleme</CardTitle>
            <CardDescription>Render edilmiş film burada oynar. Aşağıdaki ayarları kaydırmana gerek yok.</CardDescription>
          </CardHeader>
          <CardContent>
            <LongformSlidePreview
              filePath={snap.finalPath}
              updatedAt={snap.finalUpdatedAt}
              bytes={snap.finalBytes}
              mixing={mixRunning}
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Gorsel slayt uretimi</CardTitle>
          <CardDescription>
            Tek akış: senaryo, parçalama, ses, kareler ve slayt montaj sırayla gider. Kareler seçtiğin kaynaktan üretilir
            ({longformImageSourceLabel(settings.imageProvider, settings.imageModel)}). İlerleme mesajında hangi adımda
            olduğunu görürsün.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {LONGFORM_GENRES.map((genre) => (
              <button
                key={genre.id}
                type="button"
                onClick={() => saveSettings({ ...settings, genreId: genre.id as LongformGenreId })}
                className={cn(
                  "rounded-[12px] border p-3 text-left",
                  settings.genreId === genre.id
                    ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                    : "border-border bg-surface hover:border-primary/40"
                )}
              >
                <div className="text-[12px] font-semibold">
                  {genre.id === "ozel" && settings.customGenre.trim()
                    ? `Ozel · ${settings.customGenre.trim()}`
                    : genre.label}
                </div>
                <p className="mt-0.5 text-[10.5px] text-muted leading-snug">{genre.tagline}</p>
              </button>
            ))}
          </div>
          {settings.genreId === "ozel" && (
            <div className="max-w-md">
              <Label>Ozel tur adi</Label>
              <Input
                value={settings.customGenre}
                onChange={(e) => setSettings((s) => ({ ...s, customGenre: e.target.value }))}
                onBlur={(e) => void saveSettings({ ...settings, customGenre: e.target.value })}
                placeholder="or. ikinci es, evlatlik sirri"
              />
              <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                Senaryo yazdigin kelimeye gore gelir.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Hedef sure</Label>
              <Select
                value={String(durationChoice)}
                onValueChange={(v) => {
                  if (Number(v) === -1) {
                    setCustomDuration(true);
                    return;
                  }
                  setCustomDuration(false);
                  saveDuration(Number(v));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LONGFORM_DURATION_PRESETS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {durationChoice === -1 && (
                <Input
                  className="mt-2"
                  type="number"
                  min={20}
                  max={3600}
                  value={project.targetDurationSeconds}
                  onChange={(e) => saveDuration(Number(e.target.value) || project.targetDurationSeconds)}
                />
              )}
            </div>
            <div>
              <Label>Gorsel araligi</Label>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {LONGFORM_STILL_INTERVALS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => saveSettings({ ...settings, stillIntervalSeconds: n })}
                    className={cn(
                      "rounded-[10px] border px-2 py-2 text-center",
                      settings.stillIntervalSeconds === n
                        ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                        : "border-border bg-surface hover:border-primary/40"
                    )}
                  >
                    <div className="text-[13px] font-semibold tabular-nums">{n} sn</div>
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-muted-2 mt-1">
                Yaklasik {stillEstimate} duragan gorsel · hikayede{" "}
                {formatLongformCastBudget(longformNamedCastBudget(project.targetDurationSeconds))} isimli yuz
              </p>
            </div>
            <div className="md:col-span-2">
              <LongformImageSourcePicker
                provider={settings.imageProvider}
                model={settings.imageModel}
                onChange={({ imageProvider, imageModel }) =>
                  saveSettings({ ...settings, imageProvider, imageModel })
                }
              />
            </div>
            <div>
              <Label>Gorsel hareketi</Label>
              <Select
                value={settings.stillMotion}
                onValueChange={(v) => saveSettings({ ...settings, stillMotion: v as LongformStillMotion })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hold">Durağan (kare ekranda kalır)</SelectItem>
                  <SelectItem value="kenburns">Yavaş kaydırma</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <TtsVoicePicker
                language={project.speechLanguage}
                value={settings.voiceId}
                speed={settings.ttsSpeed}
                pitchSemitones={settings.ttsPitch}
                onChange={(voiceId) => saveSettings({ ...settings, voiceId })}
              />
            </div>
            <div>
              <Label>TTS hizi ({settings.ttsSpeed.toFixed(2)})</Label>
              <input
                type="range"
                min={0.7}
                max={1.3}
                step={0.02}
                value={settings.ttsSpeed}
                onChange={(e) => setSettings((s) => ({ ...s, ttsSpeed: Number(e.target.value) }))}
                onMouseUp={(e) => saveSettings({ ...settings, ttsSpeed: Number((e.target as HTMLInputElement).value) })}
                className="mt-3 w-full"
              />
              <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                Seslendirmenin konuşma hızı. 1.00 = normal hız. Düşürürsen (0.70&apos;e kadar) yavaşlar — uyku/meditasyon gibi
                sakin türlerde iyi durur. Yükseltirsen (1.30&apos;a kadar) hızlanır — gerilim/aksiyonda enerjiyi artırır.
                Ses dosyasının süresini de değiştirir; kareler ve toplam video süresi buna göre yeniden hesaplanır.
              </p>
            </div>
            <div>
              <Label>Perde ({settings.ttsPitch} semiton)</Label>
              <input
                type="range"
                min={-6}
                max={6}
                step={1}
                value={settings.ttsPitch}
                onChange={(e) => setSettings((s) => ({ ...s, ttsPitch: Number(e.target.value) }))}
                onMouseUp={(e) => saveSettings({ ...settings, ttsPitch: Number((e.target as HTMLInputElement).value) })}
                className="mt-3 w-full"
              />
              <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                Sesin tonu (kalınlık/incelik), semiton biriminde. 0 = seçtiğin sesin doğal tonu. Eksi değer (-6&apos;ya kadar)
                sesi kalınlaştırır, artı değer (+6&apos;ya kadar) inceltir. Hızı etkilemez, sadece ses rengini değiştirir.
              </p>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-[12px] border border-border bg-surface px-3 py-3 md:col-span-2">
              <div>
                <Label>Duygulu anlatım</Label>
                <p className="mt-1 text-[11px] text-muted leading-relaxed">
                  Sinirli sahnelerde ses sertleşir, pismanlikta yavaslar. Daha duygulu okuma için listeden{" "}
                  <strong>Gemini duygulu</strong> veya ElevenLabs seç.
                </p>
              </div>
              <Switch
                checked={settings.ttsExpressive !== false}
                onCheckedChange={(checked) => void saveSettings({ ...settings, ttsExpressive: checked })}
              />
            </div>
            <div>
              <Label>Yerel muzik</Label>
              <Select
                value={settings.musicFileName || "__auto__"}
                onValueChange={(v) =>
                  saveSettings({
                    ...settings,
                    musicEnabled: v !== "__off__",
                    musicFileName: v === "__auto__" || v === "__off__" ? "" : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Otomatik (klasorden)</SelectItem>
                  <SelectItem value="__off__">Muzik kapali</SelectItem>
                  {(snap?.musicFiles || []).map((f) => (
                    <SelectItem key={f.fileName} value={f.fileName}>
                      {f.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10.5px] text-muted-2 mt-1">Dosyalari `music/` klasorune koyun. YouTube Music cekilmez.</p>
            </div>
          </div>

          {!running && resumeSteps.length > 0 && (
            <div className="rounded-[12px] border border-success/30 bg-success-soft/40 px-3 py-2.5">
              <p className="text-[12px] font-medium text-success">Kaldigi yerden devam edecek</p>
              <p className="mt-0.5 text-[11px] text-muted leading-relaxed">
                Hazir olan adimlar tekrar uretilmez: {resumeSteps.join(" · ")}.
                {nextStepLabel ? ` Uretim ${nextStepLabel} adimindan devam eder.` : " Yalnizca eksik parcalar tamamlanir."}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => produce("all")} loading={busy === "all"} disabled={running}>
              <Sparkles className="h-4 w-4" /> Gorselleri uret
            </Button>
            {!running && resumeSteps.length > 0 && (
              <Button variant="outline" onClick={produceFromScratch} loading={busy === "restart"}>
                <RotateCcw className="h-4 w-4" /> Bastan uret
              </Button>
            )}
            {running && (
              <Button variant="outline" onClick={cancel}>
                <Square className="h-4 w-4" /> Iptal
              </Button>
            )}
            {snap?.finalReady && (
              <Button variant="secondary" onClick={onOpenPublish}>
                <Megaphone className="h-4 w-4" /> Yayin paketi
              </Button>
            )}
            <span className="text-[11px] text-muted inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {running || busy ? formatElapsed(elapsed) : `${Math.round(project.targetDurationSeconds / 60)} dk hedef`}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] text-muted mb-1">
              <span>{job ? longformPhaseLabel(job.phase) : snap?.finalReady ? "Hazir" : "Bekliyor"}</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <Progress value={progress} />
            {job?.message && <p className="mt-2 text-[12px] text-muted">{job.message}</p>}
            {job?.error && <p className="mt-2 text-[12px] text-danger">{job.error}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Senaryo</CardTitle>
          </CardHeader>
          <CardContent className="text-[12px] text-muted space-y-1">
            <div className="flex items-center gap-2">
              {snap?.story?.hasText ? <Check className="h-3.5 w-3.5 text-success" /> : <Badge>bekliyor</Badge>}
              <span>{snap?.story?.title || "Henuz yok"}</span>
            </div>
            {snap?.story && (
              <p>
                {snap.story.estimatedWords} kelime · ~{Math.round(snap.story.estimatedDurationSeconds / 60)} dk
                {snap.actualSpeechSeconds
                  ? ` · gercek ses ~${Math.round(snap.actualSpeechSeconds / 60)} dk`
                  : ""}
              </p>
            )}
            {snap?.story?.hook && <p className="text-muted-2 italic">“{snap.story.hook}”</p>}
            {snap?.story?.excerpt && <p className="text-[11px] text-muted-2 line-clamp-4">{snap.story.excerpt}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Gorseller</CardTitle>
          </CardHeader>
          <CardContent className="text-[12px] text-muted">
            {snap?.beats.filter((b) => b.sceneImagePath).length || 0} / {snap?.beats.length || 0} kare hazir
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Cikti</CardTitle>
          </CardHeader>
          <CardContent className="text-[12px] text-muted space-y-1">
            <p className="inline-flex items-center gap-1.5">
              <Music2 className="h-3.5 w-3.5" />
              Ses: {snap?.voiceReady ? "hazir" : "yok"}
            </p>
            <p className="inline-flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5" />
              Slayt: {snap?.finalReady ? "output/final.mp4" : "yok"}
            </p>
          </CardContent>
        </Card>
      </div>

      {snap?.beats.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Konusmaya gore gorseller</CardTitle>
            <CardDescription>
              Her kare, o andaki {settings.stillIntervalSeconds} saniyelik konusmayi gosterir
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[560px] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {snap.beats.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map((beat) => (
                <div key={beat.id} className="rounded-[12px] border border-border bg-surface-2 overflow-hidden">
                  {beat.sceneImagePath ? (
                    <img
                      src={mediaUrl(beat.sceneImagePath)}
                      alt={`Gorsel ${beat.index}`}
                      className="h-36 w-full object-cover bg-surface-3"
                    />
                  ) : (
                    <div className="h-36 w-full flex items-center justify-center bg-surface-3 text-muted">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                  <div className="px-3 py-2">
                    <div className="text-[11px] font-medium text-muted-2">
                      #{beat.index} · {Math.round(beat.actualDurationSeconds || beat.estimatedDurationSeconds)} sn
                    </div>
                    <p className="text-[12px] leading-relaxed line-clamp-3">{beat.dialogue}</p>
                  </div>
                </div>
              ))}
            </div>
            {snap.beats.length > PAGE_SIZE && (
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                <button
                  type="button"
                  className="underline-offset-2 hover:underline disabled:opacity-40"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Onceki
                </button>
                <span>
                  {page * PAGE_SIZE + 1}–{Math.min(snap.beats.length, page * PAGE_SIZE + PAGE_SIZE)} / {snap.beats.length}
                </span>
                <button
                  type="button"
                  className="underline-offset-2 hover:underline disabled:opacity-40"
                  disabled={(page + 1) * PAGE_SIZE >= snap.beats.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sonraki
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {totalBeats > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Render (slayt montaj)</CardTitle>
            <CardDescription>
              Hazir kareler + seslendirme birlestirilip {settings.stillMotion === "kenburns" ? "yavas kaydirmali" : "duragan"}{" "}
              tek videoya donusturulur. Alt yazı burada filme basılır; kareler silinmez, yalnızca slayt yeniden kodlanır.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!snap?.finalReady && (
              <p className="text-[12px] text-muted">
                Render bitince film yukarıda görünür. Kareler ve ses hazırsa aşağıdaki düğmeyle montajı al.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
              <div className="rounded-[10px] border border-border bg-surface-2 px-3 py-2">
                <div className="text-muted-2 text-[11px]">Kareler</div>
                <div className={cn("font-semibold tabular-nums", readyStills >= totalBeats ? "text-success" : "text-warning")}>
                  {readyStills} / {totalBeats}
                </div>
              </div>
              <div className="rounded-[10px] border border-border bg-surface-2 px-3 py-2">
                <div className="text-muted-2 text-[11px]">Seslendirme</div>
                <div className={cn("font-semibold", snap?.voiceReady ? "text-success" : "text-warning")}>
                  {snap?.voiceReady ? "hazir" : "yok"}
                </div>
              </div>
              <div className="rounded-[10px] border border-border bg-surface-2 px-3 py-2">
                <div className="text-muted-2 text-[11px]">Muzik</div>
                <div className="font-semibold">
                  {settings.musicEnabled ? settings.musicFileName || "otomatik" : "kapali"}
                </div>
              </div>
              <div className="rounded-[10px] border border-border bg-surface-2 px-3 py-2">
                <div className="text-muted-2 text-[11px] inline-flex items-center gap-1">
                  <Captions className="h-3 w-3" />
                  Alt yazı
                </div>
                <div className={cn("font-semibold", settings.subtitles?.enabled ? "text-success" : "")}>
                  {settings.subtitles?.enabled ? "açık" : "kapalı"}
                </div>
              </div>
            </div>

            <div>
              <Label>Cikti cozunurlugu</Label>
              <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {LONGFORM_RESOLUTION_INFO.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={running}
                    onClick={() => saveSettings({ ...settings, outputResolution: item.id })}
                    className={cn(
                      "rounded-[10px] border px-3 py-2.5 text-left",
                      settings.outputResolution === item.id
                        ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                        : "border-border bg-surface hover:border-primary/40"
                    )}
                  >
                    <div className="text-[13px] font-semibold">{item.label}</div>
                    <div className="text-[11px] text-muted-2 tabular-nums">
                      {item.width}×{item.height}
                    </div>
                    <p className="mt-1 text-[10.5px] text-muted leading-snug">{item.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Kare hizi (fps)</Label>
                <Select
                  value={String(settings.renderFps)}
                  onValueChange={(v) => saveSettings({ ...settings, renderFps: Number(v) as LongformFps })}
                  disabled={running}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LONGFORM_FPS_OPTIONS.map((fps) => (
                      <SelectItem key={fps} value={String(fps)}>
                        {fps} fps{fps === 24 ? " · sinema" : fps === 25 ? " · PAL" : " · akici"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Encode kalitesi</Label>
                <Select
                  value={settings.renderEncoder}
                  onValueChange={(v) => saveSettings({ ...settings, renderEncoder: v as LongformEncoder })}
                  disabled={running}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LONGFORM_ENCODER_INFO.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hareket</Label>
                <Select
                  value={settings.stillMotion}
                  onValueChange={(v) => saveSettings({ ...settings, stillMotion: v as LongformStillMotion })}
                  disabled={running}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hold">Duragan</SelectItem>
                    <SelectItem value="kenburns">Yavas kaydirma</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-[11px] text-muted leading-relaxed">
              {(() => {
                const info = longformResolutionInfo(settings.outputResolution);
                const frame = longformFrameSize(settings.outputResolution);
                const profile = longformEncodeProfile(
                  settings.outputResolution,
                  settings.renderEncoder,
                  settings.renderFps
                );
                return `${info.label} · ${frame.width}×${frame.height} · ${settings.renderFps} fps · H.264 High L${profile.level} · CRF ${profile.crf} · AAC ${profile.audioBitrate} · 16:9 yuv420p`;
              })()}
            </p>

            <SubtitleStyleFields
              value={settings.subtitles ?? DEFAULT_LONGFORM_SETTINGS.subtitles}
              onChange={(subtitles) => void saveSettings({ ...settings, subtitles })}
              disabled={running}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => produce("mix")}
                loading={busy === "mix" || mixRunning}
                disabled={
                  readyStills < totalBeats || !snap?.voiceReady || (running && !mixRunning)
                }
              >
                <Clapperboard className="h-4 w-4" />
                {mixRunning || busy === "mix"
                  ? "Slayt render ediliyor"
                  : snap?.finalReady
                    ? "Yeniden render et"
                    : "Slayti render et"}
              </Button>
              {readyStills < totalBeats && !running && (
                <Button variant="outline" onClick={() => produce("stills")} loading={busy === "stills"}>
                  <ImageIcon className="h-4 w-4" /> Eksik kareleri uret ({totalBeats - readyStills})
                </Button>
              )}
            </div>

            {mixRunning && (
              <p className="text-[11px] text-muted leading-relaxed">
                Kareler ve ses hazır; slayt şu an birleştiriliyor. Üretilen resimler silinmez.
              </p>
            )}
            {(readyStills < totalBeats || !snap?.voiceReady) && (
              <p className="text-[11px] text-warning leading-relaxed">
                Render icin tum kareler ve seslendirme hazir olmali.
                {readyStills < totalBeats ? ` ${totalBeats - readyStills} kare eksik.` : ""}
                {!snap?.voiceReady ? " Seslendirme henuz uretilmedi." : ""}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {liveEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Canli kayit</CardTitle>
          </CardHeader>
          <CardContent className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-muted">
            {liveEvents
              .filter((e) => e.step === "longform" || e.step === "story")
              .slice(-12)
              .map((e) => (
                <p key={e.id}>{e.message}</p>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Info, Save, Sparkles } from "lucide-react";
import { api, patchJson, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { ProjectData } from "@/components/project/types";
import { FLOW_TOGGLE_HELP } from "@/lib/flow-project-toggles";
import { isLongform } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { NarrationNameField, normalizeNarrationName } from "@/components/narration-name-editor";
import {
  DEFAULT_LONGFORM_SETTINGS,
  isLongformDramaGenre,
  LONGFORM_DURATION_PRESETS,
  LONGFORM_GENRES,
  LONGFORM_STILL_INTERVALS,
  LONGFORM_VOICES,
  longformStoredGenreName,
  parseLongformSettings,
  type LongformGenreId,
  type LongformSettings,
  type LongformStillInterval,
  type LongformVoiceId,
} from "@/lib/longform-catalog";
import {
  NARRATOR_GENRES,
  narratorGenreLabel,
  resolveNarratorGenre,
  type NarratorGenreId,
} from "@/lib/narrator-genres";
import { LongformImageSourcePicker } from "@/components/longform-image-source-picker";
import { FlowImageModelField } from "@/components/flow-image-model-field";
import { resolveFlowImageModel } from "@/lib/flow-generation-settings";
import { TtsVoicePicker } from "@/components/tts-voice-picker";
import { NarratorGenrePicker } from "@/components/narrator-genre-picker";
import { SubtitleStyleFields } from "@/components/subtitle-style-fields";
import { SPEECH_LANGUAGES, canonicalizeSpeechLanguage } from "@/lib/tts-catalog";
import { TimeTravelSettingsCard } from "@/components/project/time-travel-settings-card";

interface ModelSupport {
  durations: number[];
  aspectRatios: string[];
  supportsReference: boolean;
  supportsAudio: boolean;
  supportsStartFrame: boolean;
}

interface FlowValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  model: string;
  knownModels: string[];
  support: ModelSupport | null;
  matrix?: Record<string, ModelSupport>;
}

const ALL_DURATIONS = [4, 6, 8, 10];
const FALLBACK_MODELS = ["Veo 3.1 Lite", "Veo 3.1 Fast", "Veo 3.1 Quality", "Gemini Omni Flash"];

const TARGET_DURATION_PRESETS = [
  { label: "1 dakika", value: 60 },
  { label: "3 dakika", value: 180 },
  { label: "5 dakika", value: 300 },
  { label: "10 dakika", value: 600 },
  { label: "Ozel sure", value: -1 },
];

const FALLBACK_SUPPORT: Record<string, ModelSupport> = {
  "Veo 3.1 Lite": {
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    supportsReference: false,
    supportsAudio: true,
    supportsStartFrame: true,
  },
  "Veo 3.1 Fast": {
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    supportsReference: true,
    supportsAudio: true,
    supportsStartFrame: true,
  },
  "Veo 3.1 Quality": {
    durations: [4, 6, 8, 10],
    aspectRatios: ["16:9", "9:16"],
    supportsReference: true,
    supportsAudio: true,
    supportsStartFrame: true,
  },
  "Gemini Omni Flash": {
    durations: [4, 6, 8, 10],
    aspectRatios: ["16:9", "9:16"],
    supportsReference: true,
    supportsAudio: true,
    supportsStartFrame: true,
  },
};

/** Model listesinde "elle yaz" secenegi (Radix Select bos deger kabul etmez). */
const CUSTOM_MODEL = "__custom_model__";

function resolveSupportFromMatrix(matrix: Record<string, ModelSupport> | undefined, modelName: string): ModelSupport | null {
  if (!matrix || !modelName.trim()) return null;
  if (matrix[modelName]) return matrix[modelName];
  const norm = modelName.replace(/\s+/g, " ").toLowerCase();
  for (const [key, value] of Object.entries(matrix)) {
    if (key.replace(/\s+/g, " ").toLowerCase() === norm) return value;
  }
  const stripped = norm.replace(/\s*-\s*/g, " ");
  for (const [key, value] of Object.entries(matrix)) {
    if (key.replace(/\s+/g, " ").replace(/\s*-\s*/g, " ").toLowerCase() === stripped) return value;
  }
  return null;
}

function clampFormToSupport(support: ModelSupport, prev: ReturnType<typeof formFromProject>) {
  let clipSeconds = prev.clipSeconds;
  if (!support.durations.includes(clipSeconds)) {
    clipSeconds = support.durations.includes(8) ? 8 : support.durations[support.durations.length - 1] ?? 8;
  }
  let aspectRatio = prev.aspectRatio;
  if (!support.aspectRatios.includes(aspectRatio)) {
    aspectRatio = support.aspectRatios[0] ?? "16:9";
  }
  return {
    ...prev,
    clipSeconds,
    aspectRatio,
    useReference: support.supportsReference ? prev.useReference : false,
    useStartFrame: support.supportsStartFrame ? prev.useStartFrame : false,
    usePrevLastFrame: support.supportsStartFrame ? prev.usePrevLastFrame : false,
  };
}

/** Gorsel stil on ayarlari (prompt-builder ile ayni kimlikler + hangi sablonda gecerli oldugu). */
const STYLE_PRESETS: Array<{ id: string; label: string; recommendedFor: "narrator" | "kids" | "both" }> = [
  { id: "", label: "Varsayilan (sablona uygun)", recommendedFor: "both" },
  { id: "photorealistic", label: "Gercekci (canli cekim)", recommendedFor: "narrator" },
  { id: "cinematic", label: "Sinematik film gorunumu (ReelShort / NetShort)", recommendedFor: "narrator" },
  { id: "documentary", label: "Belgesel gorunumu", recommendedFor: "narrator" },
  { id: "pixar3d", label: "3D Animasyon (Pixar tarzi)", recommendedFor: "kids" },
  { id: "anime", label: "2D Anime", recommendedFor: "both" },
  { id: "__custom__", label: "Ozel (yazarak gir)", recommendedFor: "both" },
];

/** Sunucudaki proje kaydindan form durumunu uretir. */
function formFromProject(project: ProjectData) {
  return {
    targetDurationSeconds: project.targetDurationSeconds,
    flowModel: project.flowModel,
    flowImageModel: resolveFlowImageModel(project),
    clipSeconds: project.clipSeconds,
    aspectRatio: project.aspectRatio,
    outputsPerGeneration: project.outputsPerGeneration,
    audioEnabled: project.audioEnabled,
    useReference: project.useReference,
    useFlowCharacter: true,
    useStartFrame: project.useStartFrame,
    usePrevLastFrame: project.usePrevLastFrame,
    reuseFlowProject: project.reuseFlowProject,
    flowProjectName: project.flowProjectName,
    flowProjectUrl: project.flowProjectUrl ?? "",
    generateButtonMode: project.generateButtonMode,
    automationMode: project.automationMode,
    speechPace: project.speechPace,
    visualStyle: project.visualStyle,
    allowSubtitles: project.allowSubtitles,
    speechLanguage: canonicalizeSpeechLanguage(project.speechLanguage),
  };
}

/** Proje bazli Flow ve uretim ayarlari — olusturduktan sonra da degistirilebilir. */
export function SettingsTab({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const [form, setForm] = React.useState(() => formFromProject(project));
  const [validation, setValidation] = React.useState<FlowValidation | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Canli olaylar (SSE) proje nesnesini sik sik tazeler; kaydedilmemis
  // degisiklik varken formu sunucu degerleriyle EZMEMEK icin bayrak tutulur.
  const dirtyRef = React.useRef(false);
  const isLongformProject = isLongform(project.templateType);
  const isNarratorProject = project.templateType === "narrator";
  const [cinemaGenreId, setCinemaGenreId] = React.useState<NarratorGenreId>(() => resolveNarratorGenre(project.genre).id);
  const [customCinemaGenre, setCustomCinemaGenre] = React.useState(() => {
    const next = resolveNarratorGenre(project.genre);
    return next.id === "ozel" ? next.label : "";
  });
  const [lf, setLf] = React.useState<LongformSettings>(() => ({
    ...parseLongformSettings(project.longformSettings || project.seriesHook),
    imageModel: resolveFlowImageModel(project),
  }));
  const [topic, setTopic] = React.useState(project.topic);
  const [name, setName] = React.useState(project.name);
  const [suggestingTopic, setSuggestingTopic] = React.useState(false);
  React.useEffect(() => {
    if (dirtyRef.current) return;
    setLf({
      ...parseLongformSettings(project.longformSettings || project.seriesHook),
      imageModel: resolveFlowImageModel(project),
    });
    setTopic(project.topic);
    setName(project.name);
    const next = resolveNarratorGenre(project.genre);
    setCinemaGenreId(next.id);
    setCustomCinemaGenre(next.id === "ozel" ? next.label : "");
  }, [project.longformSettings, project.seriesHook, project.topic, project.genre, project.name]);

  const loadValidation = React.useCallback(() => {
    api<FlowValidation>(`/api/projects/${project.id}/flow-validation`, { silent: true })
      .then(setValidation)
      .catch(() => {});
  }, [project.id]);

  React.useEffect(() => {
    if (isLongformProject) return;
    loadValidation();
  }, [loadValidation, isLongformProject]);

  React.useEffect(() => {
    if (dirtyRef.current) return;
    setForm(formFromProject(project));
  }, [project]);

  const lfDirty =
    JSON.stringify(lf) !== JSON.stringify(parseLongformSettings(project.longformSettings || project.seriesHook));
  const dirty = isLongformProject
    ? form.targetDurationSeconds !== project.targetDurationSeconds ||
      form.flowImageModel !== resolveFlowImageModel(project) ||
      form.speechPace !== project.speechPace ||
      form.speechLanguage !== canonicalizeSpeechLanguage(project.speechLanguage) ||
      form.visualStyle !== project.visualStyle ||
      form.flowProjectUrl !== (project.flowProjectUrl ?? "") ||
      topic !== project.topic ||
      name !== project.name ||
      lfDirty
    : form.targetDurationSeconds !== project.targetDurationSeconds ||
      form.flowModel !== project.flowModel ||
      form.flowImageModel !== resolveFlowImageModel(project) ||
      form.clipSeconds !== project.clipSeconds ||
      form.aspectRatio !== project.aspectRatio ||
      form.outputsPerGeneration !== project.outputsPerGeneration ||
      form.audioEnabled !== project.audioEnabled ||
      form.useReference !== project.useReference ||
      form.useFlowCharacter !== project.useFlowCharacter ||
      form.useStartFrame !== project.useStartFrame ||
      form.usePrevLastFrame !== project.usePrevLastFrame ||
      form.reuseFlowProject !== project.reuseFlowProject ||
      form.flowProjectName !== project.flowProjectName ||
      form.flowProjectUrl !== (project.flowProjectUrl ?? "") ||
      form.generateButtonMode !== project.generateButtonMode ||
      form.automationMode !== project.automationMode ||
      form.speechPace !== project.speechPace ||
      form.speechLanguage !== canonicalizeSpeechLanguage(project.speechLanguage) ||
      form.visualStyle !== project.visualStyle ||
      form.allowSubtitles !== project.allowSubtitles ||
      name !== project.name ||
      (isNarratorProject &&
        (narratorGenreLabel(cinemaGenreId, customCinemaGenre) !== (project.genre || "") ||
          topic !== (project.topic || "")));
  dirtyRef.current = dirty;

  /** Secili modelin desteklemedigi degerleri formda anlik uyarmak icin. */
  const support =
    resolveSupportFromMatrix(validation?.matrix, form.flowModel) ??
    FALLBACK_SUPPORT[form.flowModel] ??
    (validation?.model === form.flowModel ? validation?.support ?? null : null);
  const modelKnown = !!support;
  const durationUnsupported = modelKnown && !support!.durations.includes(form.clipSeconds);
  const aspectUnsupported = modelKnown && !support!.aspectRatios.includes(form.aspectRatio);
  const referenceUnsupported = modelKnown && form.useReference && !support!.supportsReference;
  const startFrameUnsupported = modelKnown && (form.useStartFrame || form.usePrevLastFrame) && !support!.supportsStartFrame;

  async function save() {
    setSaving(true);
    try {
      const promptAffecting =
        form.visualStyle !== project.visualStyle ||
        form.allowSubtitles !== project.allowSubtitles ||
        form.useFlowCharacter !== project.useFlowCharacter;
      // Ozel sure (-1) asla API'ye gitmesin — zod min(20) 422 verir
      const nextName = normalizeNarrationName(name);
      if (!nextName) {
        toast.error("Anlatı adı boş olamaz");
        setSaving(false);
        return;
      }
      const payload = {
        ...form,
        useFlowCharacter: true,
        name: nextName,
        targetDurationSeconds: Math.max(20, Math.min(3600, Number(form.targetDurationSeconds) || 20)),
        allowSubtitles: isLongformProject ? lf.subtitles.enabled : false,
        ...(isLongformProject
          ? {
              longformSettings: JSON.stringify(lf),
              genre: longformStoredGenreName(lf),
              aspectRatio: "16:9",
              topic,
            }
          : isNarratorProject
            ? { genre: narratorGenreLabel(cinemaGenreId, customCinemaGenre), topic }
            : {}),
      };
      await patchJson(`/api/projects/${project.id}`, payload);
      if (isLongformProject) {
        await patchJson(`/api/projects/${project.id}/longform`, lf);
      }
      toast.success("Proje ayarlari kaydedildi");
      await reload();
      loadValidation();

      // Prompt yenileme kaydi bloklamasin; basarisiz olsa ayar zaten kayitli
      const hasPrompts = project.clips.some((c) => c.prompt.trim().length > 0);
      if (promptAffecting && hasPrompts && !isLongformProject) {
        void postJson(`/api/projects/${project.id}/build-prompts`, undefined, { silent: true })
          .then(async () => {
            toast.success("Promptlar yeni ayarlarla yenilendi");
            await reload();
          })
          .catch(() => {
            toast.message("Ayarlar kaydedildi; promptlari Promptlar sekmesinden yenileyebilirsin");
          });
      }
    } catch {
      // patchJson zaten toast.error gosterir
    } finally {
      setSaving(false);
    }
  }

  // TUM stiller her sablonda LISTELENIR (kullanici istegi: canli cekim vs gizlenmesin).
  // Cocuk sablonunda canli-cekim secilirse prompt-builder uretimde 3D aileye cevirir;
  // bu davranis asagidaki notta ve secenek etiketinde acikca yazilir.
  const isKidsProject = project.templateType === "kids_animation";

  // Stil secimi: kayitli deger bir on ayar kimligiyse onu, bos ise varsayilani,
  // degilse "ozel"i gosterir. Ozel modda serbest metin girilir.
  // (Radix Select bos string kabul etmedigi icin "default" takma degeri kullanilir.)
  const toStyleChoice = React.useCallback(
    // "documentary-stills": eski gorsel anlati projelerinin varsayilan isareti — "Varsayilan" gosterilir.
    (style: string) =>
      style === "" || style === "documentary-stills"
        ? "default"
        : STYLE_PRESETS.some((p) => p.id === style)
          ? style
          : "__custom__",
    []
  );
  const [styleChoice, setStyleChoice] = React.useState<string>(() => toStyleChoice(project.visualStyle));
  React.useEffect(() => {
    setStyleChoice(toStyleChoice(project.visualStyle));
  }, [project.visualStyle, toStyleChoice]);

  // Model listesi: API matrisi + sabit yedek liste (Omni eklenince digerleri kaybolmasin)
  const knownModels = validation?.knownModels?.length ? validation.knownModels : FALLBACK_MODELS;
  const modelOptions = React.useMemo(() => {
    const list = [...knownModels];
    for (const name of FALLBACK_MODELS) {
      if (!list.includes(name)) list.push(name);
    }
    if (form.flowModel && !list.includes(form.flowModel)) list.unshift(form.flowModel);
    return list;
  }, [knownModels.join("|"), form.flowModel]);

  const [modelChoice, setModelChoice] = React.useState<string>(project.flowModel);
  React.useEffect(() => {
    if (modelOptions.includes(project.flowModel)) {
      setModelChoice(project.flowModel);
    } else if (project.flowModel) {
      setModelChoice(CUSTOM_MODEL);
    }
  }, [project.flowModel, modelOptions.join("|")]);

  const clipSecondsChanged = form.clipSeconds !== project.clipSeconds;
  const targetDurationChanged = form.targetDurationSeconds !== project.targetDurationSeconds;
  const isSong = false;
  const durationPresets = isLongformProject ? LONGFORM_DURATION_PRESETS : TARGET_DURATION_PRESETS;
  const presetValues = durationPresets.filter((d) => d.value > 0).map((d) => d.value);
  const [customDurationMode, setCustomDurationMode] = React.useState(
    () => !presetValues.includes(project.targetDurationSeconds)
  );
  React.useEffect(() => {
    if (dirtyRef.current) return;
    setCustomDurationMode(!presetValues.includes(project.targetDurationSeconds));
  }, [project.targetDurationSeconds, project.templateType]);
  const durationChoice = customDurationMode ? -1 : form.targetDurationSeconds;
  const suggestedScenes = Math.min(
    80,
    Math.max(4, Math.round(Math.max(form.clipSeconds, form.targetDurationSeconds) / Math.max(4, form.clipSeconds)))
  );

  return (
    <div className="space-y-4 pb-20">
      {/* Dogrulama ozeti */}
      {!isLongformProject && validation && (
        <Card
          className={cn(
            validation.ok ? "border-success/30 bg-success-soft/50" : "border-danger/30 bg-danger-soft/50"
          )}
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {validation.ok ? (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className={cn("text-[13px] font-semibold", validation.ok ? "text-success" : "text-danger")}>
                  {validation.ok ? "Flow ayarlari gecerli — otomasyon baslatilabilir" : "Flow ayarlari gecersiz — otomasyon baslamaz"}
                </div>
                {validation.errors.map((error, i) => (
                  <p key={i} className="text-[12px] text-danger mt-1 leading-relaxed">
                    • {error}
                  </p>
                ))}
                {validation.warnings.map((warning, i) => (
                  <p key={i} className="text-[12px] text-warning mt-1 leading-relaxed">
                    • {warning}
                  </p>
                ))}
                {support && (
                  <p className="text-[11.5px] text-muted mt-1.5 leading-relaxed">
                    <span className="font-medium">{form.flowModel}</span> destegi: {support.durations.join(", ")} sn ·{" "}
                    {support.aspectRatios.join(" / ")} · referans {support.supportsReference ? "var" : "yok"} · baslangic karesi{" "}
                    {support.supportsStartFrame ? "var" : "yok"}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Anlatı adı</CardTitle>
              <CardDescription>Listede ve stüdyo başlığında bu isim görünür. Hikaye başlığından ayrıdır.</CardDescription>
            </div>
            <Button onClick={save} loading={saving} disabled={!dirty}>
              <Save className="h-4 w-4" /> Kaydet
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <NarrationNameField value={name} onChange={setName} disabled={saving} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Hedef film suresi</CardTitle>
              <CardDescription>
                {isLongformProject
                  ? "Gorsel slayt suresi. Konusma bu sureye gore yazilir; kare sayisi 10 / 15 / 20 sn araligina bolunur."
                  : "Once burayi ayarla; Studyo'da egri/sahne sayisi bu sureye gore onerilir. Yeni film olustururken de buradan degistirebilirsin."}
              </CardDescription>
            </div>
            <Button onClick={save} loading={saving} disabled={!dirty}>
              <Save className="h-4 w-4" /> Kaydet
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Hedef sure</Label>
            <Select
              value={String(durationChoice)}
              onValueChange={(v) => {
                const next = Number(v);
                if (next === -1) {
                  setCustomDurationMode(true);
                  return;
                }
                setCustomDurationMode(false);
                setForm((prev) => ({ ...prev, targetDurationSeconds: next }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {durationPresets.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                    {d.value > 0 ? ` (${d.value} sn)` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {durationChoice === -1 && (
              <div className="mt-2">
                <Label className="text-[11px] text-muted">Ozel sure (saniye)</Label>
                <Input
                  type="number"
                  min={20}
                  max={3600}
                  value={form.targetDurationSeconds}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      targetDurationSeconds: Math.max(20, Math.min(3600, Number(e.target.value) || 20)),
                    }))
                  }
                />
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-[12px] leading-relaxed text-muted">
            <p>
              Secili hedef: <span className="font-semibold text-fg">{form.targetDurationSeconds} sn</span> (~
              {(form.targetDurationSeconds / 60).toFixed(1)} dk)
            </p>
            <p className="mt-1">
              {isLongformProject ? (
                <>
                  {lf.stillIntervalSeconds} sn kare → yaklasik{" "}
                  <span className="font-semibold text-fg">
                    {Math.max(1, Math.round(form.targetDurationSeconds / lf.stillIntervalSeconds))}
                  </span>{" "}
                  gorsel
                </>
              ) : (
                <>
                  Klip {form.clipSeconds} sn → onerilen sahne sayisi yaklasik{" "}
                  <span className="font-semibold text-fg">{suggestedScenes}</span>
                </>
              )}
            </p>
            {targetDurationChanged && (
              <p className="mt-2 text-info">
                Kaydettikten sonra Studyo&apos;da egriyi / sahneleri yeni sureye gore yeniden planla.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {project.templateType === "time_travel" && <TimeTravelSettingsCard project={project} reload={reload} />}

      {isNarratorProject && (
        <Card>
          <CardHeader>
            <CardTitle>Hikaye turu</CardTitle>
            <CardDescription>
              Hikaye + film plani + Flow promptlari NetShort kisa dram ruhunda: entrika (ihanet / aldatma /
              gizem / aile sirri) → sakin yikici karar → zaman atlamasi → guclu donus → pismanlik. Duz hayat
              guncesi ve yavas orta bolum yok; her yeni hikaye entrikali ve tempolu yazilir. Cutaway&apos;ler
              araba/ofis/dugun flashback/status kareleri; surekli bagirma yagmuru yok. Yatak/samimi sahne yok;
              herkes 18+.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <NarratorGenrePicker
              value={cinemaGenreId}
              onChange={setCinemaGenreId}
            />
            <p className="text-[11.5px] text-muted leading-relaxed">
              {NARRATOR_GENRES.find((g) => g.id === cinemaGenreId)?.tagline}
            </p>
            {cinemaGenreId === "ozel" && (
              <div>
                <Label>Ozel tur adi</Label>
                <Input
                  value={customCinemaGenre}
                  onChange={(e) => setCustomCinemaGenre(e.target.value)}
                  placeholder="or. ikinci es"
                />
              </div>
            )}
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Hikaye konusu</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={suggestingTopic}
                  disabled={suggestingTopic || saving}
                  onClick={async () => {
                    if (cinemaGenreId === "ozel" && !customCinemaGenre.trim()) {
                      toast.error("Ozel tur icin once bir ad yazin");
                      return;
                    }
                    setSuggestingTopic(true);
                    try {
                      const result = await postJson<{ topic: string; title: string; hook: string }>(
                        "/api/narrator/suggest-topic",
                        {
                          genreId: cinemaGenreId,
                          customGenre: customCinemaGenre,
                          topic,
                          title: project.title,
                          speechLanguage: project.speechLanguage,
                          storyLanguage: project.storyLanguage,
                          audience: project.audience,
                          narrationStyle: project.narrationStyle,
                          openingHook: project.openingHook,
                          avoidList: project.avoidList,
                          targetDurationSeconds: form.targetDurationSeconds,
                          targetWordCount: project.targetWordCount,
                        }
                      );
                      setTopic(result.topic);
                      toast.success("OpenAI secilen ture gore hikaye yazdi");
                    } finally {
                      setSuggestingTopic(false);
                    }
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Hikaye oner
                </Button>
              </div>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed"
                placeholder="Hikaye oner — OpenAI secilen türe ozel konu yazar"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {isLongformProject && (
        <Card>
          <CardHeader>
            <CardTitle>Gorsel slayt ayarlari</CardTitle>
            <CardDescription>
              Konuşmaya göre 10 / 15 / 20 sn kare. Görseller aşağıdaki Flow modeliyle üretilir (karakter, kare, kapak aynı).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
              <div className="text-[12px] font-medium">Hikaye konusu</div>
              <p className="mt-1 text-[11px] text-muted leading-relaxed">
                Konu ve <span className="font-medium">Hikaye oner</span> artik Studyo sekmesindeki{" "}
                <span className="font-medium">Konu</span> bolumunde. Uretim baslarken tam senaryo (perde perde) o
                konudan yazilir, sonra karelere bolunur ve seslendirilir.
              </p>
            </div>
            <div className="md:col-span-2">
              <Label>Tur</Label>
              <Select value={lf.genreId} onValueChange={(v) => setLf((s) => ({ ...s, genreId: v as LongformGenreId }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LONGFORM_GENRES.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lf.genreId === "ozel" && (
                <div className="mt-3">
                  <Label>Ozel tur adi</Label>
                  <Input
                    value={lf.customGenre}
                    onChange={(e) => setLf((s) => ({ ...s, customGenre: e.target.value }))}
                    placeholder="or. ikinci es, evlatlik sirri"
                  />
                  <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                    Senaryo bu kelimeye gore yazilir.
                  </p>
                </div>
              )}
            </div>
            <div>
              <Label>Konuşma dili</Label>
              <p className="mt-1 mb-1.5 text-[11px] text-muted leading-relaxed">
                Hikaye ve ElevenLabs bu dilde okur.
              </p>
              <Select
                value={form.speechLanguage}
                onValueChange={(v) => setForm((prev) => ({ ...prev, speechLanguage: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPEECH_LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <TtsVoicePicker
                language={form.speechLanguage}
                value={lf.voiceId}
                speed={lf.ttsSpeed}
                pitchSemitones={lf.ttsPitch}
                onChange={(voiceId) => setLf((s) => ({ ...s, voiceId }))}
              />
            </div>
            <div>
              <Label>Gorsel araligi</Label>
              <Select
                value={String(lf.stillIntervalSeconds)}
                onValueChange={(v) => setLf((s) => ({ ...s, stillIntervalSeconds: Number(v) as LongformStillInterval }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LONGFORM_STILL_INTERVALS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} saniyede bir gorsel
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <LongformImageSourcePicker
                provider={lf.imageProvider}
                model={form.flowImageModel || lf.imageModel}
                onChange={({ imageProvider, imageModel }) => {
                  setForm((prev) => ({ ...prev, flowImageModel: imageModel }));
                  setLf((s) => ({ ...s, imageProvider, imageModel }));
                }}
              />
            </div>
            {isLongformDramaGenre(lf.genreId) && (
              <div>
                <Label>Gorsel stil (karelere islenir)</Label>
                <Select
                  value={styleChoice}
                  onValueChange={(v) => {
                    setStyleChoice(v);
                    if (v !== "__custom__") setForm((prev) => ({ ...prev, visualStyle: v === "default" ? "" : v }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STYLE_PRESETS.map((preset) => (
                      <SelectItem key={preset.id || "default"} value={preset.id || "default"}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {styleChoice === "__custom__" && (
                  <Input
                    className="mt-2"
                    value={form.visualStyle}
                    onChange={(e) => setForm((prev) => ({ ...prev, visualStyle: e.target.value }))}
                    placeholder="Ingilizce stil tarifi (or. gritty realistic handheld footage)"
                  />
                )}
                <p className="text-[10.5px] text-muted-2 mt-1 leading-relaxed">
                  Varsayilan: Sinematik film gorunumu (ReelShort / NetShort) — sinema kliplerindeki stil tarifi + fizik
                  gercekligi katmani karelere birebir islenir. Degisiklik bir sonraki kare uretiminde uygulanir.
                </p>
              </div>
            )}
            <div className={isLongformDramaGenre(lf.genreId) ? "" : "md:col-span-2"}>
              <Label>Flow proje linki (bu projeye ozel)</Label>
              <Input
                value={form.flowProjectUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, flowProjectUrl: e.target.value.trim() }))}
                placeholder="https://flow.google.com/project/XXXXXXXX"
              />
              <p className="text-[10.5px] text-muted-2 mt-1 leading-relaxed">
                Kadro sheet&apos;leri ve kareler bu Flow projesinde uretilir. Adresi Flow&apos;da projeyi acip adres
                cubugundan kopyalayin; bos birakirsaniz ilk uretimde acilan proje otomatik kaydedilir.
              </p>
            </div>
            <div>
              <Label>Gorsel hareketi</Label>
              <Select
                value={lf.stillMotion}
                onValueChange={(v) => setLf((s) => ({ ...s, stillMotion: v as LongformSettings["stillMotion"] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hold">Durağan kare</SelectItem>
                  <SelectItem value="kenburns">Yavaş kaydırma</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>TTS hizi ({lf.ttsSpeed.toFixed(2)})</Label>
              <input
                type="range"
                min={0.7}
                max={1.3}
                step={0.02}
                value={lf.ttsSpeed}
                onChange={(e) => setLf((s) => ({ ...s, ttsSpeed: Number(e.target.value) }))}
                className="mt-3 w-full"
              />
              <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                Seslendirmenin konuşma hızı. 1.00 = normal hız. 1.00&apos;in altı (0.70&apos;e kadar) yavaşlatır — uyku/meditasyon
                gibi sakin türlerde iyi durur. 1.00&apos;in üstü (1.30&apos;a kadar) hızlandırır — gerilim/aksiyon türlerinde
                enerjiyi artırır. Videonun toplam süresini de değiştirir: hızlandırınca ses kısalır, yavaşlatınca uzar.
              </p>
            </div>
            <div>
              <Label>Perde ({lf.ttsPitch})</Label>
              <input
                type="range"
                min={-6}
                max={6}
                step={1}
                value={lf.ttsPitch}
                onChange={(e) => setLf((s) => ({ ...s, ttsPitch: Number(e.target.value) }))}
                className="mt-3 w-full"
              />
              <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                Sesin tonu (kalınlık/incelik), semiton biriminde. 0 = seçtiğin sesin doğal tonu. Negatif değerler (-6&apos;ya
                kadar) sesi kalınlaştırır/pesleştirir; pozitif değerler (+6&apos;ya kadar) sesi inceltir/tizleştirir. Konuşma
                hızını etkilemez, sadece ses rengini değiştirir.
              </p>
            </div>
            <div className="md:col-span-2 flex items-start justify-between gap-4 rounded-[12px] border border-border bg-surface px-3 py-3">
              <div>
                <Label>Duygulu anlatım</Label>
                <p className="mt-1 text-[11px] text-muted leading-relaxed">
                  Sinirli sahnelerde ses sertleşir, pismanlikta yavaslar. En iyi sonuc: Google Gemini duygulu veya
                  ElevenLabs.
                </p>
              </div>
              <Switch
                checked={lf.ttsExpressive !== false}
                onCheckedChange={(checked) => setLf((s) => ({ ...s, ttsExpressive: checked }))}
              />
            </div>
            <div className="md:col-span-2">
              <SubtitleStyleFields
                value={lf.subtitles ?? DEFAULT_LONGFORM_SETTINGS.subtitles}
                onChange={(subtitles) => setLf((s) => ({ ...s, subtitles }))}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {!isLongformProject && (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Flow Uretim Ayarlari</CardTitle>
              <CardDescription>
                Bu ayarlar yalnizca bu projeye aittir. Ayarlar ekranindaki degerler sadece yeni projelerin baslangic degeridir.
              </CardDescription>
            </div>
            <Button onClick={save} loading={saving} disabled={!dirty}>
              <Save className="h-4 w-4" /> Kaydet
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Flow video modeli</Label>
            <Select
              value={modelOptions.includes(modelChoice) || modelChoice === CUSTOM_MODEL ? modelChoice : CUSTOM_MODEL}
              onValueChange={(v) => {
                setModelChoice(v);
                if (v === CUSTOM_MODEL) return;
                setForm((prev) => {
                  const next = { ...prev, flowModel: v };
                  const resolved =
                    resolveSupportFromMatrix(validation?.matrix, v) ?? FALLBACK_SUPPORT[v] ?? null;
                  return resolved ? clampFormToSupport(resolved, next) : next;
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Model secin" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_MODEL}>Ozel (elle yaz)</SelectItem>
              </SelectContent>
            </Select>
            {modelChoice === CUSTOM_MODEL && (
              <Input
                className="mt-2"
                value={form.flowModel}
                onChange={(e) => setForm((prev) => ({ ...prev, flowModel: e.target.value }))}
                placeholder="Flow'daki model adi (or. Veo 3.1 Fast)"
              />
            )}
            <p className="text-[10.5px] text-muted-2 mt-1 leading-relaxed">
              {modelKnown
                ? "Otomasyon her uretimden once Flow'daki video model menusunu bu secime getirir."
                : "Bu model destek matrisinde tanimli degil; sure/oran dogrulamasi atlanir. Ayarlar > Model Destek Matrisi'nden ekleyebilirsiniz."}
            </p>
          </div>

          <FlowImageModelField
            value={form.flowImageModel}
            onChange={(flowImageModel) => setForm((prev) => ({ ...prev, flowImageModel }))}
          />

          <div>
            <Label>Klip suresi</Label>
            <Select value={String(form.clipSeconds)} onValueChange={(v) => setForm((prev) => ({ ...prev, clipSeconds: Number(v) }))}>
              <SelectTrigger className={cn(durationUnsupported && "border-danger ring-[3px] ring-danger/10")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_DURATIONS.map((seconds) => {
                  const unsupported = modelKnown && !support!.durations.includes(seconds);
                  return (
                    <SelectItem key={seconds} value={String(seconds)}>
                      {seconds} saniye {unsupported ? "— bu model desteklemiyor" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {durationUnsupported && (
              <p className="text-[10.5px] text-danger mt-1">
                {form.flowModel} icin desteklenen sureler: {support!.durations.join(", ")} sn
              </p>
            )}
            {clipSecondsChanged && (
              <p className="text-[10.5px] text-info mt-1">
                Sure degisti: kaydettikten sonra Promptlar sekmesinden promptlari yeniden olusturun. Klip metinleri bu sureye gore
                bolunmustu; gerekirse Hikaye sekmesinden yeniden bolebilirsiniz.
              </p>
            )}
          </div>

          <div>
            <Label>En-boy orani</Label>
            <Select value={form.aspectRatio} onValueChange={(v) => setForm((prev) => ({ ...prev, aspectRatio: v }))}>
              <SelectTrigger className={cn(aspectUnsupported && "border-danger ring-[3px] ring-danger/10")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9 (yatay)</SelectItem>
                <SelectItem value="9:16">9:16 (dikey)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Cikti sayisi</Label>
            <Select
              value={String(form.outputsPerGeneration)}
              onValueChange={(v) => setForm((prev) => ({ ...prev, outputsPerGeneration: Number(v) }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Generate dugmesi</Label>
            <Select
              value={form.generateButtonMode}
              onValueChange={(v) => setForm((prev) => ({ ...prev, generateButtonMode: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Otomatik basilir</SelectItem>
                <SelectItem value="manual">Elle basarim (yari otomatik)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Otomasyon modu</Label>
            <Select value={form.automationMode} onValueChange={(v) => setForm((prev) => ({ ...prev, automationMode: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Tam otomatik</SelectItem>
                <SelectItem value="semi">Yari otomatik</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Konuşma dili</Label>
            <Select
              value={form.speechLanguage}
              onValueChange={(v) => setForm((prev) => ({ ...prev, speechLanguage: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEECH_LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Konusma hizi (sure hesabi)</Label>
            <Select value={form.speechPace} onValueChange={(v) => setForm((prev) => ({ ...prev, speechPace: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slow">Yavas</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="fast">Hizli</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Flow proje adi</Label>
            <Input
              value={form.flowProjectName}
              onChange={(e) => setForm((prev) => ({ ...prev, flowProjectName: e.target.value }))}
              placeholder="Flow icindeki proje adi (bos = mevcut sayfa)"
            />
          </div>

          <div className="md:col-span-2">
            <Label>Flow proje linki (bu projeye ozel)</Label>
            <Input
              value={form.flowProjectUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, flowProjectUrl: e.target.value.trim() }))}
              placeholder="https://flow.google.com/project/XXXXXXXX"
            />
            <p className="text-[10.5px] text-muted-2 mt-1 leading-relaxed">
              Bu adres doluysa otomasyon projeyi isimle aramak yerine DOGRUDAN buraya gider — hem daha guvenilir, hem de
              her proje kendi Chrome sekmesinde calisabildigi icin birden fazla projeyi ayni anda uretime alabilirsiniz.
              Adresi Flow&apos;da projeyi acip tarayicinin adres cubugundan kopyalayin. Bos birakirsaniz eski davranis
              (isimle arama, tek sekme) gecerli olur.
            </p>
          </div>

          <div>
            <Label>Gorsel stil (prompta islenir)</Label>
            <Select
              value={styleChoice}
              onValueChange={(v) => {
                setStyleChoice(v);
                if (v !== "__custom__") setForm((prev) => ({ ...prev, visualStyle: v === "default" ? "" : v }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLE_PRESETS.map((preset) => (
                  <SelectItem key={preset.id || "default"} value={preset.id || "default"}>
                    {preset.label}
                    {isKidsProject && preset.recommendedFor === "narrator" ? " — cocukta 3D'ye cevrilir" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {styleChoice === "__custom__" && (
              <Input
                className="mt-2"
                value={form.visualStyle}
                onChange={(e) => setForm((prev) => ({ ...prev, visualStyle: e.target.value }))}
                placeholder="Ingilizce stil tarifi (or. gritty realistic handheld footage)"
              />
            )}
            <p className="text-[10.5px] text-muted-2 mt-1 leading-relaxed">
              Varsayilan: anlatici sablonunda gercekci canli cekim, cocuk animasyonu ve sarki klibinde 3D Pixar tarzi.
              Canli cekim / sinematik / belgesel secildiginde prompta tam fizik gercekligi katmani eklenir (golge, yansima,
              isik, zemin etkilesimi, kamera fizigi).
              {isKidsProject &&
                " Not: cocuk sablonunda karakter ve sahne hatti 3D animasyon uzerine kuruludur; canli-cekim stili secilse bile uretim 3D ailede kalir (kalite icin bilerek)."}
            </p>
          </div>

          <div className="md:col-span-2 flex items-start justify-between gap-4 rounded-[10px] border border-border bg-surface-2 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <div className="text-[13px] font-medium">{FLOW_TOGGLE_HELP.allowSubtitles.label}</div>
              <div className="text-[11px] text-muted leading-relaxed">{FLOW_TOGGLE_HELP.allowSubtitles.summary}</div>
              <div className="text-[10.5px] text-muted-2 leading-relaxed">{FLOW_TOGGLE_HELP.allowSubtitles.detail}</div>
            </div>
            <Switch checked={false} disabled className="mt-0.5 shrink-0" />
          </div>

          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 md:col-span-2">
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-medium">{FLOW_TOGGLE_HELP.useFlowCharacter.label}</div>
                <p className="text-[10.5px] text-muted leading-relaxed">{FLOW_TOGGLE_HELP.useFlowCharacter.summary}</p>
                <p className="text-[10px] text-muted-2 leading-relaxed">{FLOW_TOGGLE_HELP.useFlowCharacter.detail}</p>
              </div>
              <Switch checked disabled className="mt-0.5 shrink-0" />
            </div>
            {(
              [
                { key: "audioEnabled" as const, bad: false },
                { key: "useReference" as const, bad: referenceUnsupported },
                { key: "useStartFrame" as const, bad: startFrameUnsupported },
                { key: "usePrevLastFrame" as const, bad: startFrameUnsupported },
                { key: "reuseFlowProject" as const, bad: false },
              ] as const
            ).map((toggle) => {
              const help = FLOW_TOGGLE_HELP[toggle.key];
              return (
                <div
                  key={toggle.key}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-[10px] border px-3 py-2.5",
                    toggle.bad ? "border-danger/40 bg-danger-soft/40" : "border-border bg-surface-2"
                  )}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className={cn("text-xs font-medium", toggle.bad && "text-danger")}>{help.label}</div>
                    <p className="text-[10.5px] text-muted leading-relaxed">{help.summary}</p>
                    <p className="text-[10px] text-muted-2 leading-relaxed">{help.detail}</p>
                  </div>
                  <Switch
                    checked={form[toggle.key] as boolean}
                    onCheckedChange={(v) => setForm((prev) => ({ ...prev, [toggle.key]: v }))}
                    className="mt-0.5 shrink-0"
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      )}

      {!isLongformProject && (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            <CardTitle>Model destegi nasil degistirilir?</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-[12px] text-muted leading-relaxed space-y-2">
          <p>
            Hangi modelin hangi sureleri destekledigi <span className="font-medium text-foreground">Ayarlar &gt; Model Destek Matrisi</span>{" "}
            bolumunde tutulur. Google Flow yeni bir sure secenegi eklerse matrisi guncelleyerek buradaki dogrulamayi da guncelleyebilirsiniz.
          </p>
          <p>
            Ornek: <code className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px]">&quot;Veo 3.1 Fast&quot;: {"{"}&quot;durations&quot;: [4,6,8,10], ...{"}"}</code>
          </p>
          {validation && (
            <div className="flex gap-1.5 flex-wrap pt-1">
                {validation.knownModels.map((model) => (
                  <Badge key={model} variant={model === form.flowModel ? "primary" : "default"}>
                    {model}
                  </Badge>
                ))}
                {FALLBACK_MODELS.filter((m) => !validation.knownModels.includes(m)).map((model) => (
                  <Badge key={model} variant={model === form.flowModel ? "primary" : "default"}>
                    {model}
                  </Badge>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {dirty && (
        <div className="fixed bottom-6 right-6 z-40">
          <Button onClick={save} loading={saving} size="lg" className="elevated">
            <Save className="h-4 w-4" /> Degisiklikleri Kaydet
          </Button>
        </div>
      )}
    </div>
  );
}

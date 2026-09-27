"use client";

import * as React from "react";
import { toast } from "sonner";
import { RefreshCw, Save, Wand2 } from "lucide-react";
import { patchJson, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared";
import type { ProjectData } from "@/components/project/types";
import { formatElapsed, useElapsedSeconds } from "@/lib/use-elapsed";
import {
  clampPromptForFlowBox,
  compactPromptForFlow,
  ensureNoOnscreenTextLock,
  FLOW_HARD_CHAR_LIMIT,
  FLOW_PROMPT_MAX,
} from "@/lib/flow-prompt-compact";

export function PromptsTab({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [template, setTemplate] = React.useState(project.promptTemplate);
  const [selectedClipId, setSelectedClipId] = React.useState<string | null>(project.clips[0]?.id ?? null);
  const elapsed = useElapsedSeconds(busy === "build" || busy === "rebuild");

  React.useEffect(() => {
    setTemplate(project.promptTemplate);
  }, [project.promptTemplate]);

  React.useEffect(() => {
    if (!selectedClipId && project.clips.length > 0) setSelectedClipId(project.clips[0].id);
  }, [project.clips, selectedClipId]);

  const selectedClip = project.clips.find((c) => c.id === selectedClipId) ?? null;
  const templateDirty = template !== project.promptTemplate;
  const [showDraft, setShowDraft] = React.useState(false);
  // Otomasyonla birebir ayni kisaltma: kullanici Flow'a giden metni gorur (en fazla 7800).
  const flowPrompt = React.useMemo(() => {
    if (!selectedClip?.prompt) return "";
    const compacted = compactPromptForFlow(selectedClip.prompt, project.speechLanguage || "Turkish", FLOW_PROMPT_MAX);
    return clampPromptForFlowBox(ensureNoOnscreenTextLock(compacted.text, FLOW_PROMPT_MAX));
  }, [selectedClip?.prompt, project.speechLanguage]);

  async function saveTemplate() {
    setBusy("template");
    try {
      await patchJson(`/api/projects/${project.id}`, { promptTemplate: template });
      await reload();
      toast.success("Sablon kaydedildi. Promptlari yeniden olusturmayi unutmayin.");
    } finally {
      setBusy(null);
    }
  }

  async function buildAll() {
    setBusy("build");
    try {
      const clips = await postJson<unknown[]>(`/api/projects/${project.id}/build-prompts`);
      await reload();
      toast.success(`${clips.length} klip icin prompt olusturuldu`);
    } catch {
      // postJson toast gosterir
    } finally {
      setBusy(null);
    }
  }

  async function rebuildOne() {
    if (!selectedClip) return;
    setBusy("rebuild");
    try {
      await postJson(`/api/projects/${project.id}/clips/${selectedClip.id}/rebuild-prompt`);
      await reload();
      toast.success(`Klip ${selectedClip.index} promptu yeniden olusturuldu`);
    } finally {
      setBusy(null);
    }
  }

  if (project.clips.length === 0) {
    return (
      <EmptyState
        icon={<Wand2 className="h-6 w-6" />}
        title="Once klipler gerekli"
        description="Prompt olusturmak icin once hikayeyi kliplere bolun (veya Studyo sihirbazini tamamlayin)."
      />
    );
  }

  const promptedCount = project.clips.filter((c) => c.prompt.trim().length > 0).length;
  const missingScenes =
    project.templateType === "narrator"
      ? project.clips.filter((c) => c.status !== "completed" && !(c.sceneDescription || "").trim()).length
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={promptedCount === project.clips.length ? "success" : "warning"}>
              {promptedCount}/{project.clips.length} klip prompt&apos;u hazir
            </Badge>
            <span className="text-xs text-muted">Yerel · NetShort kilitleri korunur · prompts/001.txt ...</span>
          </div>
          {missingScenes > 0 ? (
            <p className="text-[11px] text-muted">
              {missingScenes} klipte AI sahne yok — uretim yerel yedek sahne + ayni prompt kilitleriyle devam eder. Istege
              bagli: Karakter → Film planini yenile.
            </p>
          ) : null}
          {busy === "build" ? (
            <p className="text-[11px] text-muted">Promptlar yaziliyor · {formatElapsed(elapsed)}</p>
          ) : null}
        </div>
        <Button onClick={buildAll} loading={busy === "build"} disabled={busy !== null}>
          <Wand2 className="h-4 w-4" /> Tum Promptlari Olustur
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Prompt Sablonu</CardTitle>
            <CardDescription>
              Bos birakirsaniz varsayilan sablon kullanilir. Degiskenler:{" "}
              {"{{STYLE}} {{CHARACTER_REFERENCE}} {{SCENE_CONTINUITY}} {{CAMERA}} {{PERFORMANCE}} {{VOICE}} {{LANGUAGE}} {{DIALOGUE}} {{SUBTITLES}} {{SPEECH_FIDELITY}} {{NEGATIVE}} {{FLOW_CHARACTER}} {{SCENE_NOTES}} {{MUSIC}} {{LYRIC_VISUAL_LOCK}} {{DIALOGUE_VISUAL_LOCK}}"}.
              {" Sablonda {{SUBTITLES}} / {{SPEECH_FIDELITY}} yoksa bu kilitler otomatik eklenir."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              className="min-h-[360px] font-mono text-[11px]"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="Varsayilan sablonu kullanmak icin bos birakin"
              spellCheck={false}
            />
            <Button onClick={saveTemplate} loading={busy === "template"} disabled={!templateDirty}>
              <Save className="h-4 w-4" /> Sablonu Kaydet
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Prompt Onizleme</CardTitle>
                <CardDescription>Klip secerek nihai promptu gorun</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={rebuildOne} loading={busy === "rebuild"} disabled={!selectedClip}>
                <RefreshCw className="h-3.5 w-3.5" /> Bu Klibi Yeniden Uret
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {project.clips.map((clip) => (
                <button
                  key={clip.id}
                  onClick={() => setSelectedClipId(clip.id)}
                  className={
                    clip.id === selectedClipId
                      ? "rounded-md bg-primary text-white text-[11px] font-medium px-2 py-1 cursor-pointer"
                      : "rounded-md bg-surface-3 text-muted text-[11px] font-medium px-2 py-1 hover:text-foreground cursor-pointer"
                  }
                >
                  {String(clip.index).padStart(3, "0")}
                </button>
              ))}
            </div>
            {selectedClip ? (
              selectedClip.prompt ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={flowPrompt.length < FLOW_HARD_CHAR_LIMIT ? "success" : "danger"}>
                      Flow&apos;a giden: {flowPrompt.length.toLocaleString("tr-TR")} / {FLOW_HARD_CHAR_LIMIT.toLocaleString("tr-TR")}
                    </Badge>
                    <span className="text-[11px] text-muted">
                      Taslak {selectedClip.prompt.length.toLocaleString("tr-TR")} karakter — Flow&apos;a yazılmadan önce öncelik sırasıyla
                      kısaltılır; konuşma, kimlik, süreklilik ve gerçeklik kilitleri hiç düşmez.
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowDraft((v) => !v)}
                      className="ml-auto text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                    >
                      {showDraft ? "Flow'a gideni göster" : "Tam taslağı göster"}
                    </button>
                  </div>
                  <pre className="rounded-[10px] border border-border bg-surface-2 p-4 text-[11px] font-mono whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto leading-relaxed">
                    {showDraft ? selectedClip.prompt : flowPrompt}
                  </pre>
                </div>
              ) : (
                <p className="text-xs text-muted py-8 text-center">
                  Bu klip icin henuz prompt olusturulmamis. &quot;Tum Promptlari Olustur&quot; dugmesini kullanin.
                </p>
              )
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

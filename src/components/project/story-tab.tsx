"use client";

import * as React from "react";
import { toast } from "sonner";
import { BookText, Ghost, HelpCircle, Minimize2, Maximize2, RefreshCw, Save, Scissors, Sparkles, Zap } from "lucide-react";
import { postJson, putJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared";
import type { ProjectData } from "@/components/project/types";
import { formatDuration } from "@/lib/utils";
import { formatElapsed, useElapsedSeconds } from "@/lib/use-elapsed";

const REFINE_ACTIONS = [
  { action: "regenerate", label: "Yeniden Olustur", icon: RefreshCw },
  { action: "scarier", label: "Daha Korkutucu", icon: Ghost },
  { action: "more_mysterious", label: "Daha Gizemli", icon: HelpCircle },
  { action: "shorten", label: "Kisalt", icon: Minimize2 },
  { action: "lengthen", label: "Uzat", icon: Maximize2 },
  { action: "stronger_opening", label: "Acilisi Guclendir", icon: Zap },
  { action: "change_ending", label: "Sonu Degistir", icon: Sparkles },
] as const;

export function StoryTab({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const story = project.stories.find((s) => s.languageVariant === "primary") ?? null;
  const [title, setTitle] = React.useState(story?.title ?? "");
  const [text, setText] = React.useState(story?.fullStory ?? "");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const splitLock = React.useRef(false);
  const elapsed = useElapsedSeconds(busy !== null);

  React.useEffect(() => {
    setTitle(story?.title ?? "");
    setText(story?.fullStory ?? "");
    setDirty(false);
  }, [story?.id, story?.fullStory, story?.title]);

  async function generate() {
    setBusy("generate");
    try {
      await postJson(`/api/projects/${project.id}/generate-story`);
      await reload();
      toast.success("Hikaye olusturuldu");
    } catch {
      // postJson toast gosterir
    } finally {
      setBusy(null);
    }
  }

  async function refine(action: string, label: string) {
    if (dirty) {
      toast.error("Once duzenlemelerinizi kaydedin (Metni Kaydet)");
      return;
    }
    setBusy(action);
    try {
      await postJson(`/api/projects/${project.id}/story`, { action });
      await reload();
      toast.success(`${label} tamamlandi`);
    } catch {
      // postJson toast gosterir
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      await putJson(`/api/projects/${project.id}/story`, { title, fullStory: text });
      await reload();
      setDirty(false);
      toast.success("Metin kaydedildi");
    } catch {
      // postJson toast gosterir
    } finally {
      setBusy(null);
    }
  }

  async function split(force = false) {
    if (splitLock.current) return;
    if (dirty) {
      toast.error("Once metni kaydedin, sonra kliplere bolun");
      return;
    }
    const completedClips = project.clips.filter((c) => c.status === "completed").length;
    if (completedClips > 0 && !force) {
      toast.error(
        `${completedClips} klip tamamlanmis. Alttaki "Uretimi silip yeniden bol" ile onaylayin veya yalnizca Karakter → Film planini yenileyin.`
      );
      return;
    }
    if (force && completedClips > 0) {
      const ok = window.confirm(
        `${completedClips} tamamlanmis klip videosu silinecek ve hikaye bastan kliplere bolunecek. Emin misiniz?`
      );
      if (!ok) return;
    }
    splitLock.current = true;
    setBusy("split");
    try {
      const clips = await postJson<unknown[]>(`/api/projects/${project.id}/split-story`, { force: force || undefined });
      await reload();
      toast.success(
        project.templateType === "narrator"
          ? `Hikaye ${clips.length} klibe bolundu; film sahneleri hazirlandi (anlatici yalnizca dis ses).`
          : `Hikaye ${clips.length} klibe bolundu — Klipler sekmesine gecebilirsiniz`
      );
    } catch {
      // postJson toast gosterir — Next overlay olmasin
    } finally {
      splitLock.current = false;
      setBusy(null);
    }
  }

  if (!story) {
    return (
      <EmptyState
        icon={<BookText className="h-6 w-6" />}
        title="Henuz hikaye yok"
        description={`"${project.topic || project.name}" konusuyla OpenAI hikaye olusturacak${project.templateType === "narrator" && project.genre ? ` · tur: ${project.genre}` : ""}. Hedef: ~${project.targetWordCount} kelime (${formatDuration(project.targetDurationSeconds)}).`}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button onClick={generate} loading={busy === "generate"} size="lg">
              <Sparkles className="h-4 w-4" /> Hikaye Olustur
            </Button>
            {busy === "generate" && (
              <p className="text-[11.5px] text-muted">
                Model yaziyor · {formatElapsed(elapsed)} gecti. Bu adim genelde 20-90 saniye surer, sayfayi kapatmayin.
              </p>
            )}
          </div>
        }
      />
    );
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const completedClipCount = project.clips.filter((c) => c.status === "completed").length;
  const splitBlocked = completedClipCount > 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <CardTitle>Hikaye Metni</CardTitle>
              {project.templateType === "narrator" && project.genre ? (
                <Badge variant="info">{project.genre}</Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge>{wordCount} kelime</Badge>
              <Badge>~{formatDuration(Math.round((wordCount / 130) * 60))} konusma</Badge>
              {dirty && <Badge variant="warning">kaydedilmemis degisiklik</Badge>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Baslik</Label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div>
            <Label>Yalnizca konusulacak metin (sahne betimlemesi icermez)</Label>
            <Textarea
              className="min-h-[420px] text-[13px] leading-relaxed"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Button onClick={save} loading={busy === "save"} disabled={!dirty}>
              <Save className="h-4 w-4" /> Metni Kaydet
            </Button>
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="secondary"
                onClick={() => void split(false)}
                loading={busy === "split" && !splitBlocked}
                disabled={splitBlocked || busy !== null}
                title={
                  splitBlocked
                    ? `${completedClipCount} tamamlanmis klip var — asagidaki zorla bolmeyi kullanin`
                    : undefined
                }
              >
                <Scissors className="h-4 w-4" /> Hikayeyi Kliplere Bol
              </Button>
              {splitBlocked && (
                <div className="max-w-[300px] space-y-1.5 text-right">
                  <p className="text-[10.5px] text-warning leading-relaxed">
                    {completedClipCount} klip tamamlanmis — normal bolme kapali (videolar korunur). Sahne/karakter icin{" "}
                    <span className="font-medium">Karakter → Film planini yenile</span>.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-warning/50 text-warning"
                    loading={busy === "split"}
                    disabled={busy !== null}
                    onClick={() => void split(true)}
                  >
                    <Scissors className="h-3.5 w-3.5" /> Uretimi silip yeniden bol
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Duzenleme Eylemleri</CardTitle>
            <CardDescription>OpenAI ile hikayeyi donusturun. Merak Mimarisi kurallari her uretimde korunur.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {REFINE_ACTIONS.map(({ action, label, icon: Icon }) => (
              <Button
                key={action}
                variant="outline"
                className="justify-start"
                onClick={() => refine(action, label)}
                loading={busy === action}
                disabled={busy !== null && busy !== action}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </Button>
            ))}
            {busy !== null && busy !== "save" && (
              <p className="text-[11.5px] text-muted pt-1">Model calisiyor · {formatElapsed(elapsed)} gecti.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hikaye Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted">
            <div>
              <span className="font-medium text-foreground">Kanca: </span>
              {story.hook || "—"}
            </div>
            <div>
              <span className="font-medium text-foreground">Ozet: </span>
              {story.summary || "—"}
            </div>
            <div>
              <span className="font-medium text-foreground">Ses notlari: </span>
              {story.characterVoiceNotes || "—"}
            </div>
            {JSON.parse(story.contentWarnings || "[]").length > 0 && (
              <div className="flex gap-1 flex-wrap pt-1">
                {(JSON.parse(story.contentWarnings) as string[]).map((warning) => (
                  <Badge key={warning} variant="warning">
                    {warning}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

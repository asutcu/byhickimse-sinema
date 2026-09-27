"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Anchor, Clapperboard, Download, GripVertical, ImagePlus, Merge, RotateCcw, Save, Scissors, SplitSquareVertical } from "lucide-react";
import { mediaUrl, patchJson, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ClipStatusBadge, EmptyState } from "@/components/shared";
import type { ClipData, ProjectData } from "@/components/project/types";
import { CuriosityCard } from "@/components/project/curiosity-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { emptyClipsHint } from "@/lib/templates";
import { onScreenCastForClipBeat } from "@/lib/cast-clip-match";
import { isTimeTravelShot, TIME_TRAVEL_SHOTS, timeTravelShotLabel } from "@/lib/time-travel";

/** Radix Select bos string degeri kabul etmez; "karakter yok" icin sentinel. */
const NO_CHARACTER = "__none__";

function SortableClipCard({
  clip,
  project,
  onChanged,
}: {
  clip: ClipData;
  project: ProjectData;
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clip.id });
  const [text, setText] = React.useState(clip.dialogue);
  const [busy, setBusy] = React.useState<string | null>(null);
  const dirty = text !== clip.dialogue;

  React.useEffect(() => setText(clip.dialogue), [clip.dialogue]);

  const overBudget = clip.estimatedDurationSeconds > project.clipSeconds;
  const sideCast = project.characters.filter((c) => c.role === "side");
  const prevClip = project.clips.find((c) => c.index === clip.index - 1);
  const onScreenPeople = onScreenCastForClipBeat(clip.dialogue, sideCast, prevClip?.dialogue);
  const onScreenLabel = onScreenPeople.map((m) => m.name).join(", ");

  async function run(action: string, fn: () => Promise<unknown>, successMessage: string) {
    setBusy(action);
    try {
      await fn();
      onChanged();
      toast.success(successMessage);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-[12px] border border-border bg-surface p-4", isDragging && "opacity-60 border-primary z-10")}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button className="cursor-grab text-muted-2 hover:text-foreground touch-none" {...attributes} {...listeners}>
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">#{String(clip.index).padStart(3, "0")}</span>
          <ClipStatusBadge status={clip.status} />
          {project.templateType === "time_travel" ? (
            <Badge variant="primary">{timeTravelShotLabel(clip.shotType)}</Badge>
          ) : clip.hasHook ? (
            <Badge variant="primary">
              <Anchor className="h-3 w-3" /> kanca {clip.curiosityScore}/10
            </Badge>
          ) : (
            <Badge variant="warning">
              <Anchor className="h-3 w-3" /> kanca zayif
            </Badge>
          )}
          {clip.emotionLabel && <Badge variant="info">{clip.emotionLabel}</Badge>}
          {project.templateType === "narrator" && (
            <Badge variant="info">
              <Clapperboard className="h-3 w-3" /> film sahnesi
              {onScreenLabel ? ` · ${onScreenLabel}` : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span>{clip.estimatedWords} kelime</span>
          <span className={cn(overBudget && "text-danger font-semibold")}>
            ~{clip.estimatedDurationSeconds.toFixed(1)} sn / {project.clipSeconds} sn
          </span>
          {clip.attemptCount > 0 && <span>deneme: {clip.attemptCount}</span>}
        </div>
      </div>

      {clip.sceneDescription && (
        <p className="mt-2 text-[11px] text-muted leading-relaxed">
          <span className="font-medium text-foreground">Sahne: </span>
          {clip.sceneDescription}
        </p>
      )}
      <div className="mt-2 flex gap-3">
        {clip.sceneImagePath && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={mediaUrl(clip.sceneImagePath)} alt={`Sahne ${clip.index}`} className="h-20 rounded-md border border-border object-cover" />
        )}
        <Textarea className="min-h-[60px] text-[13px] flex-1" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {clip.errorMessage && <p className="mt-1 text-[11px] text-danger">{clip.errorMessage}</p>}

      {project.templateType === "time_travel" && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-2">Çekim:</span>
          <Select
            value={isTimeTravelShot(clip.shotType) ? clip.shotType : "tt_selfie"}
            onValueChange={(value) =>
              run(
                "shot",
                () => patchJson(`/api/projects/${project.id}/clips/${clip.id}`, { shotType: value }),
                `Çekim türü: ${timeTravelShotLabel(value)}`
              )
            }
          >
            <SelectTrigger className="h-7 w-[190px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_TRAVEL_SHOTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label} — {s.hint}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {clip.shotType === "tt_local" && (
            <Select
              value={clip.characterId ?? NO_CHARACTER}
              onValueChange={(value) =>
                run(
                  "character",
                  () =>
                    patchJson(`/api/projects/${project.id}/clips/${clip.id}`, {
                      characterId: value === NO_CHARACTER ? null : value,
                    }),
                  "Sahnedeki yerli güncellendi"
                )
              }
            >
              <SelectTrigger className="h-7 w-[190px] text-[11px]">
                <SelectValue placeholder="Sahnedeki yerli" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHARACTER}>Yerli seçilmedi</SelectItem>
                {project.characters
                  .filter((c) => c.role === "side" && !c.storyRole.startsWith("yol arkadaşı"))
                  .map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {project.templateType === "narrator" && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-2">Plan:</span>
          <Select
            value={clip.shotType || "narrator"}
            onValueChange={(value) =>
              run(
                "shot",
                () => patchJson(`/api/projects/${project.id}/clips/${clip.id}`, { shotType: value }),
                value === "cutaway" ? "Film sahnesine cevrildi" : "Talking-head (acil durum)"
              )
            }
          >
            <SelectTrigger className="h-7 w-[190px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cutaway">Film sahnesi (dis ses)</SelectItem>
              <SelectItem value="narrator">Acil durum: talking-head</SelectItem>
            </SelectContent>
          </Select>
          <Select
              value={clip.characterId ?? NO_CHARACTER}
              onValueChange={(value) =>
                run(
                  "character",
                  () =>
                    patchJson(`/api/projects/${project.id}/clips/${clip.id}`, {
                      characterId: value === NO_CHARACTER ? null : value,
                    }),
                  "Sahnedeki karakter guncellendi"
                )
              }
            >
              <SelectTrigger className="h-7 w-[190px] text-[11px]">
                <SelectValue placeholder="Sahnedeki karakter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHARACTER}>Kimse yok (yalnizca mekan)</SelectItem>
                {project.characters
                  .filter((c) => c.role === "side")
                  .map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          <span className="text-[10.5px] text-muted-2">
            {clip.shotType !== "cutaway"
              ? "Bu klip hâlâ talking-head — film plani bitince cutaway + sahnedeki kisi atanmali."
              : onScreenPeople.length > 0
                ? `Bu anda metinde: ${onScreenLabel}. Flow sheet ilk isimden (LEAD) yüklenir.`
                : "Bu klip metninde kadro ismi yok — sahne mekan kalır. Hikayede o anda kim varsa adıyla yazın."}
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          disabled={!dirty}
          loading={busy === "save"}
          onClick={() =>
            run("save", () => patchJson(`/api/projects/${project.id}/clips/${clip.id}`, { dialogue: text }), "Klip kaydedildi")
          }
        >
          <Save className="h-3 w-3" /> Kaydet
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy === "merge"}
          onClick={() => run("merge", () => postJson(`/api/projects/${project.id}/clips/${clip.id}/merge-next`), "Klipler birlestirildi")}
        >
          <Merge className="h-3 w-3" /> Sonrakiyle Birlestir
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy === "split"}
          onClick={() => run("split", () => postJson(`/api/projects/${project.id}/clips/${clip.id}/split`), "Klip ikiye bolundu")}
        >
          <SplitSquareVertical className="h-3 w-3" /> Ikiye Bol
        </Button>
        {(clip.status === "failed" || clip.status === "needs_manual_action" || clip.status === "completed") && (
          <Button
            size="sm"
            variant="ghost"
            loading={busy === "retry"}
            onClick={() =>
              run("retry", () => postJson(`/api/projects/${project.id}/clips/${clip.id}/retry`), "Klip yeniden kuyruga alindi")
            }
          >
            <RotateCcw className="h-3 w-3" /> Yeniden Uret
          </Button>
        )}
        {clip.imagePrompt && project.templateType !== "time_travel" && (
          <Button
            size="sm"
            variant="ghost"
            loading={busy === "sceneImage"}
            onClick={() =>
              run("sceneImage", () => postJson(`/api/projects/${project.id}/clips/${clip.id}/scene-image`), "Sahne gorseli uretildi")
            }
          >
            <ImagePlus className="h-3 w-3" /> {clip.sceneImagePath ? "Gorseli Yenile" : "Sahne Gorseli Uret"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ClipsTab({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const [order, setOrder] = React.useState<string[]>(project.clips.map((c) => c.id));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  React.useEffect(() => {
    setOrder(project.clips.map((c) => c.id));
  }, [project.clips]);

  const clipsById = new Map(project.clips.map((c) => [c.id, c]));
  const orderedClips = order.map((id) => clipsById.get(id)).filter((c): c is ClipData => !!c);

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    const newOrder = arrayMove(order, oldIndex, newIndex);
    setOrder(newOrder);
    try {
      await postJson(`/api/projects/${project.id}/clips/reorder`, { orderedClipIds: newOrder });
      await reload();
      toast.success("Siralama kaydedildi");
    } catch {
      setOrder(project.clips.map((c) => c.id));
    }
  }

  if (project.clips.length === 0) {
    return (
      <EmptyState
        icon={<Scissors className="h-6 w-6" />}
        title="Henuz klip yok"
        description={emptyClipsHint(project.templateType)}
      />
    );
  }

  const totalDuration = orderedClips.reduce((sum, c) => sum + c.estimatedDurationSeconds, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Badge>{orderedClips.length} klip</Badge>
          <Badge>~{Math.round(totalDuration)} sn toplam</Badge>
          <Badge variant="success">{orderedClips.filter((c) => c.status === "completed").length} tamamlandi</Badge>
          <span className="text-muted-2">Suruklenerek siralanabilir; kesim noktalari kanca cumlelerine hizalanir</span>
        </div>
        <div className="flex gap-2">
          <a href={`/api/projects/${project.id}/clips/export?format=csv`} download>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </a>
          <a href={`/api/projects/${project.id}/clips/export?format=json`} download>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" /> JSON
            </Button>
          </a>
        </div>
      </div>

      {project.templateType !== "time_travel" && (
        <div className="mb-4">
          <CuriosityCard clips={orderedClips} unit="Klip" />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {orderedClips.map((clip) => (
              <SortableClipCard
                key={clip.id}
                clip={clip}
                project={project}
                onChanged={() => reload()}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {orderedClips.some((c) => c.estimatedDurationSeconds > project.clipSeconds) && (
        <Card className="mt-4 border-warning/40">
          <CardContent className="p-4 text-xs text-warning">
            Bazi kliplerin tahmini konusma suresi klip suresini ({project.clipSeconds} sn) asiyor. Bu klipleri ikiye bolmeniz veya
            metni kisaltmaniz onerilir; aksi halde cumle video bitmeden tamamlanamayabilir.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

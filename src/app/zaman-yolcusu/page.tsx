"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Camera, Clock, Compass, Hourglass, Landmark, PawPrint, Plus, Trash2, Users } from "lucide-react";
import { api, del, mediaUrl, patchJson } from "@/lib/client-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader, ProjectStatusBadge } from "@/components/shared";
import { EditableNarrationName } from "@/components/narration-name-editor";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import { isTimeTravel, projectWorkspaceHref } from "@/lib/templates";

interface JourneyItem {
  id: string;
  name: string;
  title: string;
  genre: string;
  templateType: string;
  status: string;
  targetDurationSeconds: number;
  clipCount: number;
  completedClipCount: number;
  updatedAt: string;
  coverPath: string | null;
}

const FORMAT_POINTS = [
  { icon: Camera, title: "Kameraya konuşan sunucu", text: "Selfie vlog, göz hizası ve geniş plan karışık ilerler." },
  { icon: PawPrint, title: "Sabit yol arkadaşı", text: "Aynı hayvan her klipte aynı tip ve renkte." },
  { icon: Users, title: "Dönemin yerlileri", text: "Taş ustası, ekmekçi… doğru kıyafet ve isimle." },
  { icon: Landmark, title: "Doğru tarih", text: "Günün akışı içinde gerçek bilgiler anlatılır." },
];

export default function TimeTravelListPage() {
  const router = useRouter();
  const [items, setItems] = React.useState<JourneyItem[] | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<JourneyItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(() => {
    api<JourneyItem[]>("/api/projects").then((rows) => setItems(rows.filter((p) => isTimeTravel(p.templateType))));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function confirmDelete(deleteFiles: boolean) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/api/projects/${deleteTarget.id}?deleteFiles=${deleteFiles}`);
      toast.success(`"${deleteTarget.name}" silindi`);
      setDeleteTarget(null);
      load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Zaman Yolcusu"
        title="Yolculuklar"
        description="Geçmişe giden bir sunucunun gözünden tarih vlogları. Bu bölümdeki projeler Anlatılar'dan ayrı tutulur."
        actions={
          <Link href="/zaman-yolcusu/yeni" className={buttonVariants({ size: "lg" })}>
            <Plus className="h-4 w-4" /> Yeni yolculuk
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {FORMAT_POINTS.map((point) => (
          <div key={point.title} className="flex items-start gap-3 rounded-[16px] border border-border bg-surface p-4 card-shadow">
            <span className="icon-tile icon-tile-primary h-10 w-10 shrink-0 rounded-[12px]">
              <point.icon className="h-[18px] w-[18px]" />
            </span>
            <div>
              <div className="text-[13px] font-bold">{point.title}</div>
              <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{point.text}</div>
            </div>
          </div>
        ))}
      </div>

      {!items ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[320px] rounded-[20px]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Hourglass className="h-7 w-7" />}
          title="Henüz yolculuk yok"
          description="Bir dönem ve yer seç, sunucunu ve yol arkadaşını tanımla; senaryo, çekim planı ve Flow klipleri buradan ilerler."
          action={
            <Link href="/zaman-yolcusu/yeni" className={buttonVariants({ size: "lg" })}>
              <Compass className="h-4 w-4" /> İlk yolculuğu planla
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const editing = editingId === item.id;
            const progress = item.clipCount > 0 ? Math.round((item.completedClipCount / item.clipCount) * 100) : 0;
            return (
              <Card
                key={item.id}
                className={cn("group overflow-hidden", editing ? "border-primary/40" : "cursor-pointer card-lift")}
                onClick={() => {
                  if (!editing) router.push(projectWorkspaceHref(item));
                }}
              >
                <div className="relative aspect-[16/9] overflow-hidden border-b border-border">
                  {item.coverPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(item.coverPath)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="cover-fallback flex h-full w-full items-center justify-center">
                      <span className="icon-tile icon-tile-solid h-14 w-14 rounded-[18px]">
                        <Hourglass className="h-6 w-6" />
                      </span>
                    </div>
                  )}
                  <div className="cover-shade pointer-events-none absolute inset-0" />
                  <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/92 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-[0_4px_12px_-6px_rgba(15,40,90,0.5)] backdrop-blur">
                    <Hourglass className="h-3.5 w-3.5 text-primary" />
                    Tarih vlogu
                  </div>
                  <div className="absolute right-3 top-3 inline-flex rounded-full bg-white/92 shadow-[0_4px_12px_-6px_rgba(15,40,90,0.5)] backdrop-blur">
                    <ProjectStatusBadge status={item.status} />
                  </div>
                  <div className="absolute inset-x-3 bottom-3 flex items-center justify-between text-[11.5px] font-semibold text-white">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDuration(item.targetDurationSeconds)}
                    </span>
                    <span className="tabular-nums">
                      {item.completedClipCount}/{item.clipCount} klip
                    </span>
                  </div>
                </div>
                <div className="p-5">
                  <EditableNarrationName
                    value={item.name}
                    variant="card"
                    onEditingChange={(open) => setEditingId(open ? item.id : null)}
                    onSave={async (next) => {
                      await patchJson(`/api/projects/${item.id}`, { name: next });
                      setItems((rows) => rows?.map((row) => (row.id === item.id ? { ...row, name: next } : row)) ?? null);
                      toast.success("Yolculuk adı kaydedildi");
                    }}
                  />
                  <div className="mt-1 truncate text-[12px] text-muted">{item.title || "Senaryo henüz yazılmadı"}</div>
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold">
                      <span className="text-muted">Üretim ilerlemesi</span>
                      <span className="tabular-nums text-primary-strong">%{progress}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#0ea5e9]" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-2">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {formatDate(item.updatedAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-2 hover:bg-danger-soft hover:text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(item);
                      }}
                      aria-label="Sil"
                      title="Sil"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="icon-tile icon-tile-danger mb-2 h-11 w-11 rounded-[13px]">
              <Trash2 className="h-5 w-5" />
            </div>
            <DialogTitle>Yolculuğu sil</DialogTitle>
            <DialogDescription>&quot;{deleteTarget?.name}&quot; silinecek. Bu işlem geri alınamaz.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Vazgeç
            </Button>
            <Button variant="secondary" onClick={() => confirmDelete(false)} loading={deleting}>
              Sadece kaydı sil
            </Button>
            <Button variant="danger" onClick={() => confirmDelete(true)} loading={deleting}>
              <Trash2 className="h-4 w-4" /> Dosyalarla sil
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

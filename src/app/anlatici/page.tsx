"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  CalendarClock,
  Clapperboard,
  Clock,
  Film,
  ImageIcon,
  Layers,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api, del, mediaUrl, patchJson } from "@/lib/client-api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader, ProjectStatusBadge } from "@/components/shared";
import { EditableNarrationName } from "@/components/narration-name-editor";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import { isLegacyAnimation, isListedNarration, listKindLabel, projectWorkspaceHref } from "@/lib/templates";

interface ProjectListItem {
  id: string;
  name: string;
  slug: string;
  title: string;
  genre: string;
  templateType: string;
  status: string;
  targetDurationSeconds: number;
  clipCount: number;
  completedClipCount: number;
  createdAt: string;
  updatedAt: string;
  coverPath: string | null;
}

type KindFilter = "all" | "narrator" | "longform" | "animation";

const FILTERS: Array<{ id: KindFilter; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "all", label: "Tümü", icon: Layers },
  { id: "narrator", label: "Sinema", icon: Clapperboard },
  { id: "longform", label: "Görsel", icon: ImageIcon },
  { id: "animation", label: "Animasyon", icon: Sparkles },
];

function kindOf(templateType: string): Exclude<KindFilter, "all"> {
  if (templateType === "longform") return "longform";
  if (isLegacyAnimation(templateType)) return "animation";
  return "narrator";
}

function KindIcon({ templateType, className }: { templateType: string; className?: string }) {
  const kind = kindOf(templateType);
  if (kind === "longform") return <ImageIcon className={className} />;
  if (kind === "animation") return <Sparkles className={className} />;
  return <Film className={className} />;
}

export default function NarratorHomePage() {
  const router = useRouter();
  const [projects, setProjects] = React.useState<ProjectListItem[] | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectListItem | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<KindFilter>("all");
  const [query, setQuery] = React.useState("");

  const load = React.useCallback(() => {
    api<ProjectListItem[]>("/api/projects").then((rows) => {
      setProjects(rows.filter((p) => isListedNarration(p.templateType)));
    });
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

  const counts = React.useMemo(() => {
    const base: Record<KindFilter, number> = { all: 0, narrator: 0, longform: 0, animation: 0 };
    for (const p of projects ?? []) {
      base.all += 1;
      base[kindOf(p.templateType)] += 1;
    }
    return base;
  }, [projects]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return (projects ?? []).filter((p) => {
      if (filter !== "all" && kindOf(p.templateType) !== filter) return false;
      if (!q) return true;
      return [p.name, p.title, p.genre].some((v) => (v || "").toLocaleLowerCase("tr-TR").includes(q));
    });
  }, [projects, filter, query]);

  const completedTotal = (projects ?? []).filter((p) => p.status === "completed" || p.status === "clips_done").length;

  return (
    <div>
      <PageHeader
        eyebrow="Stüdyo arşivi"
        title="Anlatılar"
        description="Sinema filmleri, görsel anlatılar ve animasyonlar tek yerde. Karta tıklayınca çalışma alanı açılır; kalemle adı değiştirebilirsin."
        actions={
          <Link href="/anlatici/yeni" className={buttonVariants({ size: "lg" })}>
            <Plus className="h-4 w-4" /> Yeni anlatı
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Toplam anlatı", value: counts.all, icon: Layers, tile: "icon-tile-solid" },
          { label: "Sinema filmi", value: counts.narrator, icon: Clapperboard, tile: "icon-tile-primary" },
          { label: "Görsel anlatı", value: counts.longform, icon: ImageIcon, tile: "icon-tile-sky" },
          { label: "Tamamlanan", value: completedTotal, icon: Sparkles, tile: "icon-tile-success" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 rounded-[16px] border border-border bg-surface px-4 py-3.5 card-shadow">
            <span className={cn("icon-tile h-10 w-10 rounded-[12px]", item.tile)}>
              <item.icon className="h-[18px] w-[18px]" />
            </span>
            <div>
              <div className="text-[22px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
                {projects ? item.value : "–"}
              </div>
              <div className="mt-1 text-[11.5px] font-medium text-muted">{item.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-[14px] border border-border bg-surface p-1.5 card-shadow">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "focus-ring inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer",
                  active
                    ? "bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_18px_-10px_rgba(37,99,235,0.75)]"
                    : "text-muted hover:bg-primary-soft hover:text-primary-strong"
                )}
              >
                <f.icon className="h-3.5 w-3.5" />
                {f.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10.5px] font-bold tabular-nums",
                    active ? "bg-white/20 text-white" : "bg-surface-3 text-muted"
                  )}
                >
                  {counts[f.id]}
                </span>
              </button>
            );
          })}
        </div>
        <label className="relative w-full sm:w-[300px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Anlatı ara…"
            aria-label="Anlatı ara"
            className="h-11 w-full rounded-[13px] border border-border bg-surface pl-10 pr-3.5 text-[13px] shadow-[0_1px_2px_rgba(15,40,90,0.05)] placeholder:text-muted-2 hover:border-border-strong focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12"
          />
        </label>
      </div>

      {!projects ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[320px] rounded-[20px]" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-7 w-7" />}
          title="Henüz anlatı yok"
          description="Görsel slayt veya sinema film formatıyla ilk anlatınızı oluşturun."
          action={
            <Link href="/anlatici/yeni" className={buttonVariants({ size: "lg" })}>
              <Plus className="h-4 w-4" /> İlk anlatıyı oluştur
            </Link>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Search className="h-7 w-7" />}
          title="Eşleşen anlatı yok"
          description="Filtreyi veya arama metnini değiştirip tekrar dene."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
            >
              Filtreleri temizle
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => {
            const editing = editingId === project.id;
            const progress =
              project.clipCount > 0 ? Math.round((project.completedClipCount / project.clipCount) * 100) : 0;
            return (
              <Card
                key={project.id}
                className={cn("group overflow-hidden", editing ? "border-primary/40" : "cursor-pointer card-lift")}
                onClick={() => {
                  if (!editing) router.push(projectWorkspaceHref(project));
                }}
              >
                <div className="relative aspect-[16/9] overflow-hidden border-b border-border">
                  {project.coverPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(project.coverPath)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="cover-fallback flex h-full w-full items-center justify-center">
                      <span className="icon-tile icon-tile-solid h-14 w-14 rounded-[18px]">
                        <KindIcon templateType={project.templateType} className="h-6 w-6" />
                      </span>
                    </div>
                  )}
                  <div className="cover-shade pointer-events-none absolute inset-0" />
                  <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/92 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-[0_4px_12px_-6px_rgba(15,40,90,0.5)] backdrop-blur">
                    <KindIcon templateType={project.templateType} className="h-3.5 w-3.5 text-primary" />
                    {listKindLabel(project.templateType)}
                  </div>
                  <div className="absolute right-3 top-3">
                    <span className="rounded-full bg-white/92 shadow-[0_4px_12px_-6px_rgba(15,40,90,0.5)] backdrop-blur inline-flex">
                      <ProjectStatusBadge status={project.status} />
                    </span>
                  </div>
                  <div className="absolute inset-x-3 bottom-3 flex items-center justify-between text-[11.5px] font-semibold text-white">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDuration(project.targetDurationSeconds)}
                    </span>
                    <span className="tabular-nums">
                      {project.completedClipCount}/{project.clipCount} kare
                    </span>
                  </div>
                </div>

                <div className="p-5">
                  <EditableNarrationName
                    value={project.name}
                    variant="card"
                    onEditingChange={(open) => setEditingId(open ? project.id : null)}
                    onSave={async (next) => {
                      await patchJson(`/api/projects/${project.id}`, { name: next });
                      setProjects(
                        (rows) => rows?.map((row) => (row.id === project.id ? { ...row, name: next } : row)) ?? null
                      );
                      toast.success("Anlatı adı kaydedildi");
                    }}
                  />
                  <div className="mt-1 truncate text-[12px] text-muted">{project.title || project.genre || "Başlık yok"}</div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold">
                      <span className="text-muted">Üretim ilerlemesi</span>
                      <span className="tabular-nums text-primary-strong">%{progress}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#0ea5e9]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-2">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {formatDate(project.updatedAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-2 hover:bg-danger-soft hover:text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(project);
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
            <DialogTitle>Anlatıyı sil</DialogTitle>
            <DialogDescription>
              &quot;{deleteTarget?.name}&quot; silinecek. Bu işlem geri alınamaz.
            </DialogDescription>
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

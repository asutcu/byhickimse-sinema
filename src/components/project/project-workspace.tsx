"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookText, Clapperboard, Cpu, FolderOpen, Megaphone, Plus, Scissors, SlidersHorizontal, User, Wand2 } from "lucide-react";
import { api, patchJson, postJson } from "@/lib/client-api";
import { EditableNarrationName } from "@/components/narration-name-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, ProjectStatusBadge } from "@/components/shared";
import type { EventData, ProjectData } from "@/components/project/types";
import { StoryTab } from "@/components/project/story-tab";
import { AutoPilotBanner } from "@/components/project/autopilot-banner";
import { ClipsTab } from "@/components/project/clips-tab";
import { CharacterTab } from "@/components/project/character-tab";
import { PromptsTab } from "@/components/project/prompts-tab";
import { AutomationTab } from "@/components/project/automation-tab";
import { RenderTab } from "@/components/project/render-tab";
import { PublishTab } from "@/components/project/publish-tab";
import { SettingsTab } from "@/components/project/settings-tab";
import { isTimeTravel, isTimeTravelSectionPath, projectWorkspaceHref, templateLabel } from "@/lib/templates";

/**
 * Klip tabanli calisma alani: sinema anlatici (/anlatici/sinema/{id}).
 * Her projectId tamamen ayri bir anlatidir — geciste eski state/SSE asla yeniye yazilmaz.
 */
export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [project, setProject] = React.useState<ProjectData | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [liveEvents, setLiveEvents] = React.useState<EventData[]>([]);
  const [tab, setTab] = React.useState<string>("");
  const activeIdRef = React.useRef(projectId);
  activeIdRef.current = projectId;
  const inJourney = isTimeTravelSectionPath(pathname);

  // URL'deki anlatı degisince onceki projenin verisini aninda dusur.
  React.useEffect(() => {
    setProject(null);
    setLoadFailed(false);
    setLiveEvents([]);
    setTab("");
  }, [projectId]);

  const reload = React.useCallback(async () => {
    const id = projectId;
    const data = await api<ProjectData>(`/api/projects/${id}`, { silent: true });
    if (activeIdRef.current !== id) return data;
    if (data.id !== id) {
      throw new Error("Proje kimligi uyusmuyor — sayfayi yenileyin");
    }
    setProject(data);
    return data;
  }, [projectId]);

  React.useEffect(() => {
    let cancelled = false;
    reload()
      .then((data) => {
        if (cancelled || activeIdRef.current !== projectId) return;
        const paramsTab =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
        const expectedPath = projectWorkspaceHref(data);
        if (expectedPath !== pathname) {
          router.replace(paramsTab ? `${expectedPath}?tab=${paramsTab}` : expectedPath);
          return;
        }
        const allowed = new Set([
          "story",
          "clips",
          "character",
          "prompts",
          "automation",
          "render",
          "publish",
          "settings",
        ]);
        setTab(paramsTab && allowed.has(paramsTab) ? paramsTab : "story");
      })
      .catch(() => {
        if (!cancelled && activeIdRef.current === projectId) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reload, pathname, router, projectId]);

  React.useEffect(() => {
    const id = projectId;
    const source = new EventSource(`/api/projects/${id}/events`);

    const stillActive = () => activeIdRef.current === id;

    const parse = <T,>(raw: MessageEvent): T | null => {
      try {
        return JSON.parse(raw.data) as T;
      } catch {
        return null;
      }
    };

    source.addEventListener("snapshot", (e) => {
      if (!stillActive()) return;
      const data = parse<{ events: EventData[] }>(e as MessageEvent);
      if (data?.events) setLiveEvents(data.events.slice(-80));
    });

    source.addEventListener("event", (e) => {
      if (!stillActive()) return;
      const data = parse<EventData>(e as MessageEvent);
      if (!data) return;
      setLiveEvents((prev) => [data, ...prev].slice(0, 80));
      const step = data.step || "";
      if (["clip", "download", "job", "render", "automation", "flow", "character"].includes(step)) {
        void reload().catch(() => {});
      }
    });

    source.addEventListener("clip", (e) => {
      if (!stillActive()) return;
      const data = parse<{
        id: string;
        index: number;
        status: string;
        attemptCount?: number;
        errorMessage?: string | null;
        videoPath?: string | null;
      }>(e as MessageEvent);
      if (data?.id) {
        setProject((prev) => {
          if (!prev || prev.id !== id) return prev;
          return {
            ...prev,
            clips: prev.clips.map((c) =>
              c.id === data.id
                ? {
                    ...c,
                    status: data.status as typeof c.status,
                    attemptCount: data.attemptCount ?? c.attemptCount,
                    errorMessage: data.errorMessage ?? c.errorMessage,
                    videoPath: data.videoPath !== undefined ? data.videoPath : c.videoPath,
                  }
                : c
            ),
          };
        });
      }
      void reload().catch(() => {});
    });

    source.addEventListener("job", () => {
      if (!stillActive()) return;
      void reload().catch(() => {});
    });

    source.addEventListener("project", (e) => {
      if (!stillActive()) return;
      const data = parse<{ status?: string }>(e as MessageEvent);
      if (data?.status) {
        setProject((prev) => (prev && prev.id === id ? { ...prev, status: data.status as typeof prev.status } : prev));
      }
      void reload().catch(() => {});
    });

    source.onerror = () => {
      /* transient; browser reconnects */
    };

    return () => source.close();
  }, [projectId, reload]);

  if (loadFailed) {
    return (
      <div>
        <EmptyState
          title="Anlatı bulunamadı"
          description="Bu çalışma alanı silinmiş veya geçersiz olabilir. Her anlatı ayrı bir projedir — listeden güncel olanı açın."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push(inJourney ? "/zaman-yolcusu" : "/anlatici")}>
                {inJourney ? "Yolculuklara dön" : "Anlatılara dön"}
              </Button>
              <Button onClick={() => router.push(inJourney ? "/zaman-yolcusu/yeni" : "/anlatici/yeni")}>
                <Plus className="h-4 w-4" /> {inJourney ? "Yeni yolculuk" : "Yeni anlatı"}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  // projectId degisti ama eski veri henuz dusmedi / yeni yuklenmedi
  if (!project || !tab || project.id !== projectId) {
    return (
      <div>
        <Skeleton className="h-10 w-80 mb-6" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="pb-16" key={projectId}>
      <AutoPilotBanner projectId={project.id} />
      <PageHeader
        eyebrow={`${templateLabel(project.templateType)} · bu anlatıya özel`}
        title={
          <EditableNarrationName
            value={project.name}
            onSave={async (next) => {
              await patchJson(`/api/projects/${project.id}`, { name: next });
              setProject((prev) => (prev ? { ...prev, name: next } : prev));
              toast.success("Anlatı adı kaydedildi");
            }}
          />
        }
        description={`${project.genre} · hedef ${Math.round(project.targetDurationSeconds / 60)} dk · ${project.flowModel} · ${project.flowImageModel || "Nano Banana 2"} · ${project.clipSeconds}sn klip · ${project.aspectRatio}`}
        actions={
          <>
            <ProjectStatusBadge status={project.status} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(isTimeTravel(project.templateType) ? "/zaman-yolcusu/yeni" : "/anlatici/yeni")}
            >
              <Plus className="h-3.5 w-3.5" /> {isTimeTravel(project.templateType) ? "Yeni yolculuk" : "Yeni anlatı"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => postJson(`/api/projects/${project.id}/open-folder`).then(() => toast.success("Klasor acildi"))}
            >
              <FolderOpen className="h-3.5 w-3.5" /> Klasoru Ac
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="story">
            <BookText className="h-3.5 w-3.5" /> Hikaye
          </TabsTrigger>
          <TabsTrigger value="clips">
            <Scissors className="h-3.5 w-3.5" /> Klipler ({project.clips.length})
          </TabsTrigger>
          <TabsTrigger value="character">
            <User className="h-3.5 w-3.5" /> Karakter
          </TabsTrigger>
          <TabsTrigger value="prompts">
            <Wand2 className="h-3.5 w-3.5" /> Promptlar
          </TabsTrigger>
          <TabsTrigger value="automation">
            <Cpu className="h-3.5 w-3.5" /> Otomasyon
          </TabsTrigger>
          <TabsTrigger value="render">
            <Clapperboard className="h-3.5 w-3.5" /> Render
          </TabsTrigger>
          <TabsTrigger value="publish">
            <Megaphone className="h-3.5 w-3.5" /> Yayin
          </TabsTrigger>
          <TabsTrigger value="settings">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Proje Ayarlari
          </TabsTrigger>
        </TabsList>

        <TabsContent value="story">
          <StoryTab key={`story-${projectId}`} project={project} reload={reload} />
        </TabsContent>
        <TabsContent value="clips">
          <ClipsTab key={`clips-${projectId}`} project={project} reload={reload} />
        </TabsContent>
        <TabsContent value="character">
          <CharacterTab key={`character-${projectId}`} project={project} reload={reload} />
        </TabsContent>
        <TabsContent value="prompts">
          <PromptsTab key={`prompts-${projectId}`} project={project} reload={reload} />
        </TabsContent>
        <TabsContent value="automation">
          <AutomationTab
            key={`automation-${projectId}`}
            project={project}
            reload={reload}
            liveEvents={liveEvents}
            onOpenSettings={() => setTab("settings")}
          />
        </TabsContent>
        <TabsContent value="render">
          <RenderTab key={`render-${projectId}`} project={project} reload={reload} />
        </TabsContent>
        <TabsContent value="publish">
          <PublishTab key={`publish-${projectId}`} project={project} reload={reload} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab key={`settings-${projectId}`} project={project} reload={reload} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, FolderOpen, Megaphone, SlidersHorizontal } from "lucide-react";
import { api, patchJson, postJson } from "@/lib/client-api";
import { EditableNarrationName } from "@/components/narration-name-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, ProjectStatusBadge } from "@/components/shared";
import type { EventData, ProjectData } from "@/components/project/types";
import { LongformStudioTab } from "@/components/project/longform-studio-tab";
import { AutoPilotBanner } from "@/components/project/autopilot-banner";
import { PublishTab } from "@/components/project/publish-tab";
import { SettingsTab } from "@/components/project/settings-tab";
import { isLongform, projectWorkspaceHref } from "@/lib/templates";

export default function NarratorWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;
  const [project, setProject] = React.useState<ProjectData | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [liveEvents, setLiveEvents] = React.useState<EventData[]>([]);
  const [tab, setTab] = React.useState("studio");

  const reload = React.useCallback(async () => {
    const data = await api<ProjectData>(`/api/projects/${projectId}`, { silent: true });
    setProject(data);
    return data;
  }, [projectId]);

  React.useEffect(() => {
    reload()
      .then((data) => {
        if (!isLongform(data.templateType)) {
          router.replace(projectWorkspaceHref(data));
          return;
        }
        const paramsTab =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
        if (paramsTab === "publish" || paramsTab === "settings" || paramsTab === "studio") {
          setTab(paramsTab);
        }
      })
      .catch(() => {
        setLoadFailed(true);
        toast.error("Anlati yuklenemedi");
      });
  }, [reload, router]);

  React.useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events`);
    source.addEventListener("snapshot", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { events: EventData[] };
      setLiveEvents(data.events);
    });
    source.addEventListener("event", (e) => {
      const event = JSON.parse((e as MessageEvent).data) as EventData;
      setLiveEvents((prev) => [...prev.slice(-199), event]);
    });
    source.addEventListener("project", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { status: string };
      setProject((prev) => (prev ? { ...prev, status: data.status } : prev));
    });
    source.addEventListener("longform", () => {
      reload().catch(() => {});
    });
    return () => source.close();
  }, [projectId, reload]);

  if (!project) {
    if (loadFailed) {
      return (
        <div>
          <PageHeader eyebrow="Anlatici" title="Anlati bulunamadi" />
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title="Bu anlati yok"
            description="Silinmis veya gecersiz olabilir."
            action={<Button onClick={() => router.push("/anlatici")}>Anlatilara don</Button>}
          />
        </div>
      );
    }
    return (
      <div>
        <Skeleton className="h-10 w-80 mb-6" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="pb-16">
      <AutoPilotBanner projectId={project.id} />
      <PageHeader
        eyebrow="Anlatici"
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
        description={`${Math.round(project.targetDurationSeconds / 60)} dk gorsel slayt · konusmaya gore 10 / 15 / 20 sn kare · video klip yok${project.topic ? ` · ${project.topic.slice(0, 80)}` : ""}`}
        actions={
          <>
            <ProjectStatusBadge status={project.status} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => postJson(`/api/projects/${project.id}/open-folder`).then(() => toast.success("Klasor acildi"))}
            >
              <FolderOpen className="h-3.5 w-3.5" /> Klasor
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="studio">
            <BookOpen className="h-3.5 w-3.5" /> Studyo
          </TabsTrigger>
          <TabsTrigger value="publish">
            <Megaphone className="h-3.5 w-3.5" /> Yayin
          </TabsTrigger>
          <TabsTrigger value="settings">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Ayarlar
          </TabsTrigger>
        </TabsList>
        <TabsContent value="studio">
          <LongformStudioTab
            project={project}
            reload={reload}
            liveEvents={liveEvents}
            onOpenPublish={() => setTab("publish")}
          />
        </TabsContent>
        <TabsContent value="publish">
          <PublishTab project={project} reload={reload} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab project={project} reload={reload} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

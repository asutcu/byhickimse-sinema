"use client";

import { useParams } from "next/navigation";
import { ProjectWorkspace } from "@/components/project/project-workspace";

/** Zaman Yolcusu calisma alani — sinema klip sekmeleri, kendi bolumunde. */
export default function TimeTravelWorkspacePage() {
  const params = useParams<{ id: string }>();
  return <ProjectWorkspace projectId={params.id} />;
}

"use client";

import { useParams } from "next/navigation";
import { ProjectWorkspace } from "@/components/project/project-workspace";

/** Sinema anlatici (Flow / Veo klipleri) calisma alani — anlatici bolumu altinda. */
export default function CinemaNarratorWorkspacePage() {
  const params = useParams<{ id: string }>();
  return <ProjectWorkspace projectId={params.id} />;
}

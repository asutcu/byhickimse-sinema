import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { createProject, createProjectSchema } from "@/server/services/projects";
import { isListedNarration, isSupportedTemplateType, isTimeTravel } from "@/lib/templates";
import { relocateStoredProjectFile } from "@/server/lib/paths";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const projects = (
      await prisma.project.findMany({
        orderBy: [{ filmIndex: "asc" }, { createdAt: "desc" }],
        include: {
          _count: { select: { clips: true, films: true } },
          clips: { where: { status: "completed" }, select: { id: true } },
          characters: { where: { role: "main" }, select: { name: true, referenceImagePath: true }, take: 1 },
        },
      })
    ).filter((p) => isListedNarration(p.templateType) || isTimeTravel(p.templateType));

    const frames = await prisma.clip.findMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
        languageVariant: "primary",
        OR: [{ sceneImagePath: { not: null } }, { lastFramePath: { not: null } }],
      },
      select: { projectId: true, index: true, sceneImagePath: true, lastFramePath: true },
      orderBy: { index: "asc" },
    });
    const framesByProject = new Map<string, typeof frames>();
    for (const frame of frames) {
      const list = framesByProject.get(frame.projectId) ?? [];
      list.push(frame);
      framesByProject.set(frame.projectId, list);
    }
    // Acilis karesi cogu zaman karanlik; filmin ilk ceyregindeki kare kapak olur.
    const coverFor = (p: (typeof projects)[number]): string | null => {
      const list = framesByProject.get(p.id) ?? [];
      const start = Math.min(list.length - 1, Math.floor(list.length * 0.2));
      for (let i = 0; i < list.length; i += 1) {
        const frame = list[(Math.max(0, start) + i) % list.length];
        const found =
          relocateStoredProjectFile(frame.sceneImagePath) ?? relocateStoredProjectFile(frame.lastFramePath);
        if (found) return found;
        if (i >= 6) break;
      }
      return relocateStoredProjectFile(p.characters[0]?.referenceImagePath);
    };

    type ListItem = {
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
      createdAt: Date;
      updatedAt: Date;
      parentProjectId: string | null;
      filmIndex: number;
      filmCount: number;
      mainCharacterName: string;
      coverPath: string | null;
      films: ListItem[];
    };

    const toItem = (p: (typeof projects)[number]): ListItem => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      title: p.title,
      genre: p.genre,
      templateType: p.templateType,
      status: p.status,
      targetDurationSeconds: p.targetDurationSeconds,
      clipCount: p._count.clips,
      completedClipCount: p.clips.length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      parentProjectId: p.parentProjectId,
      filmIndex: p.filmIndex,
      filmCount: p._count.films,
      mainCharacterName: p.characters[0]?.name ?? "",
      coverPath: coverFor(p),
      films: [],
    });

    const byId = new Map(projects.map((p) => [p.id, toItem(p)]));
    const roots: ListItem[] = [];
    for (const p of projects) {
      const item = byId.get(p.id)!;
      if (p.parentProjectId && byId.has(p.parentProjectId)) {
        byId.get(p.parentProjectId)!.films.push(item);
      } else if (!p.parentProjectId) {
        roots.push(item);
      } else {
        // Orphan alt film — yine de listede görünsün
        roots.push(item);
      }
    }
    for (const root of roots) {
      root.films.sort((a, b) => a.filmIndex - b.filmIndex);
    }
    roots.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return roots;
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = createProjectSchema.parse(await request.json());
    if (!isSupportedTemplateType(body.templateType)) {
      throw new Error("Desteklenmeyen sablon turu");
    }
    return createProject(body);
  });
}

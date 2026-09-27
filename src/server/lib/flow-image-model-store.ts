import { prisma } from "@/server/db";
import { resolveFlowImageModel } from "@/lib/flow-generation-settings";

/** Sutun var; eski Prisma client alan adini tanimasa da SQL ile okunur/yazilir. */
export async function persistProjectFlowImageModel(projectId: string, model: string): Promise<string> {
  const next = resolveFlowImageModel(model);
  await prisma.$executeRaw`UPDATE "Project" SET "flowImageModel" = ${next} WHERE "id" = ${projectId}`;
  return next;
}

export async function readProjectFlowImageModel(projectId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ flowImageModel: string | null }>>`
    SELECT "flowImageModel" FROM "Project" WHERE "id" = ${projectId} LIMIT 1
  `;
  return resolveFlowImageModel(rows[0]?.flowImageModel);
}

export function withFlowImageModel<T extends { id: string }>(
  project: T,
  model: string
): T & { flowImageModel: string } {
  return { ...project, flowImageModel: resolveFlowImageModel(model) };
}

/** Prisma client alani yoksa bile SQL'deki proje ayarini nesneye yazar. */
export async function hydrateProjectFlowImageModel<T extends { id: string }>(
  project: T
): Promise<T & { flowImageModel: string }> {
  return withFlowImageModel(project, await readProjectFlowImageModel(project.id));
}

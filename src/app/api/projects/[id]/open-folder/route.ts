import { spawn } from "node:child_process";
import fs from "node:fs";
import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { safeProjectPath } from "@/server/lib/paths";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Proje klasorunu (veya final videoyu secili halde) Windows Gezgini'nde acar. */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const url = new URL(request.url);
    const target = url.searchParams.get("target") ?? "root";
    const project = await prisma.project.findUniqueOrThrow({ where: { id } });

    if (target === "final") {
      const finalAsset = await prisma.generatedAsset.findFirst({
        where: { projectId: id, kind: "final_video" },
        orderBy: { createdAt: "desc" },
      });
      if (finalAsset && fs.existsSync(finalAsset.path)) {
        spawn("explorer.exe", ["/select,", finalAsset.path], { detached: true, stdio: "ignore" }).unref();
        return { opened: finalAsset.path };
      }
    }
    const root = safeProjectPath(project.slug);
    if (!fs.existsSync(root)) throw new Error("Proje klasoru bulunamadi");
    spawn("explorer.exe", [root], { detached: true, stdio: "ignore" }).unref();
    return { opened: root };
  });
}

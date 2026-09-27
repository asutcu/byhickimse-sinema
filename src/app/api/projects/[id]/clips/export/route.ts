import { NextResponse } from "next/server";
import { fail } from "@/server/lib/api";
import { exportClipsCsv, exportClipsJson } from "@/server/services/clips";
import { prisma } from "@/server/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  try {
    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    if (format === "csv") {
      const csv = await exportClipsCsv(id);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${project.slug}-clips.csv"`,
        },
      });
    }
    const json = await exportClipsJson(id);
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.slug}-clips.json"`,
      },
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 500);
  }
}

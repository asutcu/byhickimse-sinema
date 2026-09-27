import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/server/db";
import { APP_ROOT } from "@/server/lib/paths";
import { FLOW_PROJECT_URL_EXAMPLE, normalizeFlowProjectUrl, sameFlowProject } from "@/lib/flow-project-url";

/**
 * Zaman Yolcusu modulune ozel ayarlar. Genel Ayarlar'daki Flow adresinden ve
 * diger anlati projelerinden bagimsizdir; yalnizca yeni yolculuklara varsayilan olur.
 */
const MODULE_FILE = path.join(APP_ROOT, "data", "time-travel-module.json");

export interface TimeTravelModuleSettings {
  flowProjectUrl: string;
}

export function readTimeTravelModuleSettings(): TimeTravelModuleSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(MODULE_FILE, "utf8")) as Partial<TimeTravelModuleSettings>;
    return { flowProjectUrl: normalizeFlowProjectUrl(raw.flowProjectUrl) ?? "" };
  } catch {
    return { flowProjectUrl: "" };
  }
}

export function writeTimeTravelModuleSettings(next: TimeTravelModuleSettings): TimeTravelModuleSettings {
  const flowProjectUrl = next.flowProjectUrl.trim() ? normalizeFlowProjectUrl(next.flowProjectUrl) : "";
  if (flowProjectUrl === null) {
    throw new Error(`Geçersiz Google Flow proje adresi. Örnek: ${FLOW_PROJECT_URL_EXAMPLE}`);
  }
  const saved = { flowProjectUrl };
  fs.mkdirSync(path.dirname(MODULE_FILE), { recursive: true });
  fs.writeFileSync(MODULE_FILE, JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

/** Ayni Flow projesini kullanan Zaman Yolcusu DISI projeler (karisma uyarisi icin). */
export async function flowUrlUsedOutsideTimeTravel(url: string): Promise<Array<{ id: string; name: string }>> {
  const normalized = normalizeFlowProjectUrl(url);
  if (!normalized) return [];
  const rows = await prisma.project.findMany({
    where: { templateType: { not: "time_travel" }, flowProjectUrl: { not: "" } },
    select: { id: true, name: true, flowProjectUrl: true },
  });
  return rows
    .filter((row) => sameFlowProject(row.flowProjectUrl, normalized))
    .map((row) => ({ id: row.id, name: row.name }));
}

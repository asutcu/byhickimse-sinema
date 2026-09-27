/* Gecici tani: son hata/uyari olaylarini ve otopilot durumunu yazdirir. */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.automationEvent.findMany({
    where: { level: { in: ["error", "warning"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { createdAt: true, level: true, step: true, message: true, projectId: true },
  });
  for (const r of rows.reverse()) {
    console.log(
      r.createdAt.toISOString().slice(11, 19),
      "|",
      r.level.padEnd(7),
      "|",
      (r.step || "").padEnd(9),
      "|",
      (r.message || "").slice(0, 170)
    );
  }
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, templateType: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  console.log("--- projeler ---");
  for (const p of projects) console.log(p.id, "|", p.name, "|", p.templateType, "|", p.status);
}

main().finally(() => prisma.$disconnect());

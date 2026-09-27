/* Test yardimcisi: otomasyon durumunu ozetler. Kullanim: node scripts/watch-status.js <projectId> */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const projectId = process.argv[2];

async function main() {
  const job = await prisma.automationJob.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
  const clips = await prisma.clip.findMany({ where: { projectId }, orderBy: { index: "asc" } });
  const counts = {};
  for (const c of clips) counts[c.status] = (counts[c.status] || 0) + 1;
  console.log("JOB:", job ? `${job.state} | klip ${job.currentClipIndex ?? "-"}` : "yok");
  console.log("KLIPLER:", JSON.stringify(counts));
  const active = clips.find((c) => !["completed", "pending", "draft"].includes(c.status));
  if (active) console.log("AKTIF:", `#${active.index} ${active.status}`);
  const events = await prisma.automationEvent.findMany({
    where: { projectId },
    orderBy: { id: "desc" },
    take: 6,
  });
  for (const e of events.reverse()) console.log(`#${e.id} [${e.level}] ${e.step} | ${e.message.slice(0, 140)}`);
}

main()
  .catch((e) => console.error(e.message))
  .finally(() => prisma.$disconnect());

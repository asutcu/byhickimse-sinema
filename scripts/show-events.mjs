// Son otomasyon olaylarini konsola doker (hata ayiklama yardimcisi).
// Kullanim: node scripts/show-events.mjs [adet]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const count = Number(process.argv[2] ?? 30);

const events = await prisma.automationEvent.findMany({ orderBy: { createdAt: "desc" }, take: count });
for (const event of events.reverse()) {
  const time = event.createdAt.toISOString().slice(11, 19);
  console.log(`${time} [${event.level}] ${event.step}: ${event.message.slice(0, 140)}`);
}
await prisma.$disconnect();

/* Test yardimcisi: son olay kayitlarini okur. Kullanim: node scripts/dump-events.js [adet] */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const take = Number(process.argv[2] || 20);

prisma.automationEvent
  .findMany({ orderBy: { id: "desc" }, take })
  .then((rows) => {
    rows.reverse().forEach((r) => {
      const ss = r.screenshotPath ? " | SS: " + r.screenshotPath : "";
      console.log(`#${r.id} [${r.level}] ${r.step} | ${r.message}${ss}`);
    });
    return prisma.$disconnect();
  })
  .catch((err) => {
    console.error(err.message);
    return prisma.$disconnect();
  });

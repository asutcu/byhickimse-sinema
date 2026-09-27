import { z } from "zod";
import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import { ensureDefaultSelectors, SELECTOR_STRATEGIES } from "@/server/automation/selectors";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await ensureDefaultSelectors();
    return prisma.flowSelector.findMany({ orderBy: { key: "asc" } });
  });
}

const putSchema = z.object({
  selectors: z.array(
    z.object({
      key: z.string().min(1),
      strategy: z.enum(SELECTOR_STRATEGIES),
      value: z.string(),
      roleName: z.string().default(""),
    })
  ),
});

/** Panelden elle secici duzenleme. Elle girilen deger zincirin basina yazilir. */
export async function PUT(request: Request) {
  return handle(async () => {
    const body = putSchema.parse(await request.json());
    for (const selector of body.selectors) {
      await prisma.flowSelector.update({
        where: { key: selector.key },
        data: {
          strategy: selector.strategy,
          value: selector.value,
          roleName: selector.roleName,
          candidates: selector.value
            ? JSON.stringify([{ strategy: selector.strategy, value: selector.value, roleName: selector.roleName }])
            : "[]",
          lastTestOk: null,
          lastTestAt: null,
        },
      });
    }
    return prisma.flowSelector.findMany({ orderBy: { key: "asc" } });
  });
}

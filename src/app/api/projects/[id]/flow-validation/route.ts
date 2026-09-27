import { handle } from "@/server/lib/api";
import { prisma } from "@/server/db";
import {
  getSettings,
  parseModelSupportMatrix,
  validateFlowConfig,
  listSelectableFlowModels,
  resolveModelSupport,
} from "@/server/services/settings";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Projenin Flow ayarlarini model destek matrisine gore dogrular.
 * Panel bunu canli gosterir; boylece otomasyonu baslatmadan once sorun anlasilir.
 */
export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    const settings = await getSettings();
    const matrix = parseModelSupportMatrix(settings);
    const support = resolveModelSupport(matrix, project.flowModel);

    const validation = validateFlowConfig(matrix, {
      model: project.flowModel,
      clipSeconds: project.clipSeconds,
      aspectRatio: project.aspectRatio,
      useReference: project.useReference,
      useStartFrame: project.useStartFrame || project.usePrevLastFrame,
    });

    return {
      ...validation,
      model: project.flowModel,
      knownModels: listSelectableFlowModels(matrix),
      support,
      matrix,
    };
  });
}

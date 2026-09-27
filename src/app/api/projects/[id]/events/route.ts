import { prisma } from "@/server/db";
import { subscribe, type BusMessage } from "@/server/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * SSE: proje bazli canli olay akisi.
 * Baglantida son 50 olay + is/klip durumlari gonderilir, sonra canli akis.
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      const send = (event: string, data: unknown) => {
        safeEnqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // zaten kapali
        }
      };

      // Baslangic durumu
      const recentEvents = await prisma.automationEvent.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      if (closed) return;
      send("snapshot", { events: recentEvents.reverse() });

      unsubscribe = subscribe(`project:${id}`, (message: BusMessage) => {
        send(message.type, message.payload);
      });

      heartbeat = setInterval(() => {
        if (closed) {
          if (heartbeat) clearInterval(heartbeat);
          return;
        }
        safeEnqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15_000);

      request.signal.addEventListener("abort", shutdown);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

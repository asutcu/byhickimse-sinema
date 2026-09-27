import { subscribe, type BusMessage } from "@/server/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE: global olay akisi (dashboard / kabuk icin). */
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
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

      unsubscribe = subscribe("global", (message: BusMessage) => {
        send(message.type, message.payload);
      });

      heartbeat = setInterval(() => {
        if (closed) {
          if (heartbeat) clearInterval(heartbeat);
          return;
        }
        safeEnqueue(encoder.encode(`: heartbeat\n\n`));
        if (closed && heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      }, 15_000);

      request.signal.addEventListener("abort", shutdown);
      send("system", { hello: true });
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

import { EventEmitter } from "node:events";

/**
 * SSE (Server-Sent Events) icin surec ici olay veriyolu.
 * Kanallar: "project:<id>" ve "global".
 */

export interface BusMessage {
  type: string; // event | job | clip | project | system
  payload: unknown;
}

const globalForBus = globalThis as unknown as { sseBus?: EventEmitter };

export const sseBus: EventEmitter = globalForBus.sseBus ?? new EventEmitter();
sseBus.setMaxListeners(200);
if (!globalForBus.sseBus) globalForBus.sseBus = sseBus;

/** Olayi hem proje kanalina hem global kanala yayinlar. */
export function publishEvent(projectId: string | null, message: BusMessage): void {
  if (projectId) sseBus.emit(`project:${projectId}`, message);
  sseBus.emit("global", message);
}

/** Belirli bir kanala abone olur; temizleme fonksiyonu dondurur. */
export function subscribe(channel: string, listener: (message: BusMessage) => void): () => void {
  sseBus.on(channel, listener);
  return () => sseBus.off(channel, listener);
}

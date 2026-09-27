"use client";

import { toast } from "sonner";

/**
 * Istemci tarafi API yardimcisi.
 * Tum yanitlar { ok, data | error } bicimindedir; hatalar toast ile gosterilir.
 */

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function api<T = unknown>(
  path: string,
  options?: RequestInit & { silent?: boolean }
): Promise<T> {
  const { silent, ...init } = options ?? {};
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    const message = "Sunucuya ulasilamadi. Uygulama calisiyor mu?";
    if (!silent) toast.error(message);
    throw new Error(message);
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    const message = `Beklenmedik yanit (${response.status})`;
    if (!silent) toast.error(message);
    throw new Error(message);
  }

  if (!envelope.ok) {
    const raw = envelope.error ?? `Islem basarisiz (${response.status})`;
    const message = raw.length > 180 ? `${raw.slice(0, 160).trim()}…` : raw;
    if (!silent) {
      if (response.status === 409) toast.message(message);
      else toast.error(message);
    }
    const error = new Error(message);
    error.name = response.status === 409 ? "ProjectJobBusyError" : "Error";
    throw error;
  }
  return envelope.data as T;
}

export function postJson<T = unknown>(path: string, body?: unknown, options?: { silent?: boolean }): Promise<T> {
  return api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), silent: options?.silent });
}

export function putJson<T = unknown>(path: string, body: unknown, options?: { silent?: boolean }): Promise<T> {
  return api<T>(path, { method: "PUT", body: JSON.stringify(body), silent: options?.silent });
}

export function patchJson<T = unknown>(path: string, body: unknown, options?: { silent?: boolean }): Promise<T> {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(body), silent: options?.silent });
}

export function del<T = unknown>(path: string, options?: { silent?: boolean }): Promise<T> {
  return api<T>(path, { method: "DELETE", silent: options?.silent });
}

/** Medya dosyasini panel icinde gostermek icin URL uretir. */
export function mediaUrl(filePath: string): string {
  return `/api/media?path=${encodeURIComponent(filePath)}`;
}

"use client";

import * as React from "react";
import { api } from "@/lib/client-api";

/**
 * Kabuk (sidebar + ust bar) icin paylasilan sistem durumu.
 * Tek bir SSE baglantisi ve tek fetch ile beslenir; boylece her bilesen
 * ayri ayri sunucuyu yoklamaz (otomasyon sirasinda gereksiz yuk olusmaz).
 */

export interface ShellStatus {
  projectCount: number;
  runningJobs: number;
  completedClips: number;
  failedClips: number;
  browserOpen: boolean;
  openaiKeyPresent: boolean;
  flowSession: { status: string; detail: string };
}

const StatusContext = React.createContext<{
  status: ShellStatus | null;
  /** SSE olaylarinda artar; sayfalar bunu izleyerek kendi verisini yenileyebilir. */
  tick: number;
  refresh: () => void;
}>({
  status: null,
  tick: 0,
  refresh: () => {},
});

export function useShellStatus() {
  return React.useContext(StatusContext);
}

export function SystemStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<ShellStatus | null>(null);
  const [tick, setTick] = React.useState(0);

  const refresh = React.useCallback(() => {
    api<ShellStatus>("/api/system/status", { silent: true })
      .then(setStatus)
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    refresh();
    let debounce: number | null = null;
    const source = new EventSource("/api/events");
    const bump = () => {
      setTick((n) => n + 1);
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        refresh();
      }, 400);
    };
    source.addEventListener("job", bump);
    source.addEventListener("system", bump);
    source.addEventListener("project", bump);
    source.onerror = () => {
      // Tarayici otomatik yeniden baglanir; burada ekstra islem yok
    };
    return () => {
      if (debounce) window.clearTimeout(debounce);
      source.close();
    };
  }, [refresh]);

  const value = React.useMemo(() => ({ status, tick, refresh }), [status, tick, refresh]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

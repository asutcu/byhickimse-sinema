"use client";

import * as React from "react";

/**
 * Uzun suren AI cagrilarinda gecen sureyi sayar.
 * Kullanici "ekran dondu mu?" diye tereddut etmesin diye butonun yaninda gosterilir.
 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = React.useState(0);

  React.useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return seconds;
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} dk ${String(seconds % 60).padStart(2, "0")} sn`;
}

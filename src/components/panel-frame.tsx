"use client";

/** Sayfa kabuğu — animasyon yok; tıklayınca anında değişir. */
export function PanelFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1600px]">{children}</div>;
}

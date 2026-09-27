"use client";

import * as React from "react";
import Link from "next/link";
import { LayoutDashboard, RefreshCw, TriangleAlert } from "lucide-react";

/**
 * Istemci hata siniri: beklenmeyen bir hatada ham Next.js hata ekrani yerine
 * kabuk diliyle uyumlu, tekrar denenebilir bir kart gosterir.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("Arayuz hatasi:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg rounded-[18px] border border-border bg-surface px-8 py-10 text-center card-shadow hairline-top">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft text-danger ring-8 ring-surface-2">
          <TriangleAlert className="h-6 w-6" />
        </div>
        <div className="section-label">Beklenmeyen hata</div>
        <h1 className="mt-1.5 text-[20px] font-semibold tracking-[-0.02em]">Bir seyler ters gitti</h1>
        <p className="mx-auto mt-2 max-w-sm text-[12.5px] text-muted leading-relaxed">
          Sayfa yuklenirken bir hata olustu. Tekrar denemek genellikle yeterlidir; sorun devam ederse olay kayitlarina
          bakabilirsiniz.
        </p>
        {error.message && (
          <p className="mx-auto mt-3 max-w-sm break-words rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-left font-mono text-[11px] text-muted">
            {error.message.slice(0, 300)}
          </p>
        )}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="focus-ring inline-flex h-9 cursor-pointer items-center gap-2 rounded-[10px] brand-gradient px-4 text-sm font-medium text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Tekrar dene
          </button>
          <Link
            href="/"
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-[10px] border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-2 hover:border-border-strong"
          >
            <LayoutDashboard className="h-4 w-4" />
            Panele don
          </Link>
        </div>
      </div>
    </div>
  );
}

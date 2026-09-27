"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ChevronRight, CircleHelp, House, KeyRound, Monitor } from "lucide-react";
import { useShellStatus } from "@/components/system-status-provider";
import { cn } from "@/lib/utils";

const SECTION_TITLES: Array<{ match: (path: string) => boolean; label: string }> = [
  { match: (p) => p === "/", label: "Dashboard" },
  { match: (p) => p === "/anlatici/yeni", label: "Yeni Anlatı" },
  { match: (p) => p.startsWith("/anlatici/sinema/"), label: "Sinema Anlatıcı" },
  { match: (p) => p.startsWith("/anlatici/"), label: "Görsel Anlatı" },
  { match: (p) => p.startsWith("/anlatici"), label: "Anlatılar" },
  { match: (p) => p === "/zaman-yolcusu/yeni", label: "Yeni Yolculuk" },
  { match: (p) => p.startsWith("/zaman-yolcusu/"), label: "Yolculuk" },
  { match: (p) => p.startsWith("/zaman-yolcusu"), label: "Zaman Yolcusu" },
  { match: (p) => p.startsWith("/calibration"), label: "Flow Kalibrasyonu" },
  { match: (p) => p.startsWith("/setup"), label: "Kurulum" },
  { match: (p) => p.startsWith("/settings"), label: "Ayarlar" },
];

export function Topbar() {
  const pathname = usePathname();
  const { status } = useShellStatus();
  const section = SECTION_TITLES.find((entry) => entry.match(pathname))?.label ?? "Panel";
  const inProject = pathname.startsWith("/anlatici/") && pathname !== "/anlatici/yeni";
  const inJourney = pathname.startsWith("/zaman-yolcusu/") && pathname !== "/zaman-yolcusu/yeni";

  const flowTone =
    !status || !status.browserOpen
      ? "idle"
      : status.flowSession.status === "ready"
        ? "ok"
        : "warn";

  return (
    <header className="topbar-glass sticky top-0 z-30 h-[68px] shrink-0">
      <div className="flex h-full items-center justify-between gap-4 px-5 lg:px-10">
        <nav className="flex min-w-0 items-center gap-2 text-[13px]" aria-label="Konum">
          <Link
            href="/"
            className="focus-ring icon-tile icon-tile-neutral h-8 w-8 rounded-[10px] hover:text-primary-strong"
            aria-label="ByHickimse"
          >
            <House className="h-4 w-4" />
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-2" />
          {inProject && (
            <>
              <Link href="/anlatici" className="focus-ring rounded-md font-medium text-muted hover:text-primary-strong">
                Anlatılar
              </Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-2" />
            </>
          )}
          {inJourney && (
            <>
              <Link href="/zaman-yolcusu" className="focus-ring rounded-md font-medium text-muted hover:text-primary-strong">
                Zaman Yolcusu
              </Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-2" />
            </>
          )}
          <span className="truncate text-[15px] font-bold tracking-[-0.02em] text-foreground" aria-current="page">
            {section}
          </span>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {status && status.runningJobs > 0 && (
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning-soft px-3 py-1.5 text-[11.5px] font-semibold text-warning">
              <Activity className="h-3.5 w-3.5" />
              {status.runningJobs} görev çalışıyor
            </span>
          )}

          <StatusChip
            icon={<Monitor className="h-3.5 w-3.5" />}
            label={
              !status || !status.browserOpen
                ? "Flow kapalı"
                : status.flowSession.status === "ready"
                  ? "Flow hazır"
                  : "Flow: müdahale"
            }
            tone={flowTone}
          />
          <StatusChip
            icon={<KeyRound className="h-3.5 w-3.5" />}
            label={status?.openaiKeyPresent ? "OpenAI bağlı" : "API yok"}
            tone={status?.openaiKeyPresent ? "ok" : "err"}
          />

          <span className="mx-1 h-6 w-px bg-border" />

          <Link
            href="/setup"
            className="focus-ring icon-tile icon-tile-neutral h-9 w-9 rounded-[11px] hover:text-primary-strong"
            title="Kurulum ve yardım"
            aria-label="Kurulum ve yardım"
          >
            <CircleHelp className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function StatusChip({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: "ok" | "warn" | "err" | "idle" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1.5 text-[11.5px] font-semibold shadow-[0_1px_2px_rgba(15,40,90,0.05)]",
        tone === "ok" && "border-success/25 text-success",
        tone === "warn" && "border-warning/25 text-warning",
        tone === "err" && "border-danger/25 text-danger",
        tone === "idle" && "border-border text-muted"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "ok" && "bg-success",
          tone === "warn" && "bg-warning pulse-dot",
          tone === "err" && "bg-danger",
          tone === "idle" && "bg-muted-2"
        )}
      />
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Clapperboard,
  Crosshair,
  Hourglass,
  LayoutDashboard,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useShellStatus } from "@/components/system-status-provider";
import { isNarratorSectionPath, isTimeTravelSectionPath } from "@/lib/templates";
import { cn } from "@/lib/utils";

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    label: "Genel",
    items: [{ href: "/", label: "Dashboard", hint: "Genel bakış", icon: LayoutDashboard }],
  },
  {
    label: "Stüdyo",
    items: [{ href: "/anlatici", label: "Anlatılar", hint: "Sinema ve görsel anlatı", icon: BookOpen }],
  },
  {
    label: "Üretim",
    items: [{ href: "/calibration", label: "Flow Kalibrasyonu", hint: "Seçici eğitimi", icon: Crosshair }],
  },
  {
    label: "Sistem",
    items: [
      { href: "/setup", label: "Kurulum", hint: "Sistem kontrolü", icon: Wand2 },
      { href: "/settings", label: "Ayarlar", hint: "Yapılandırma", icon: Settings },
    ],
  },
  {
    label: "Zaman Yolcusu",
    items: [
      { href: "/zaman-yolcusu", label: "Yolculuklar", hint: "Tarih vlogları", icon: Hourglass },
      { href: "/zaman-yolcusu/yeni", label: "Yeni yolculuk", hint: "Dönem, sunucu, yol arkadaşı", icon: Plus },
    ],
  },
];

function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/anlatici") return isNarratorSectionPath(pathname) && pathname !== "/anlatici/yeni";
  if (href === "/zaman-yolcusu") return isTimeTravelSectionPath(pathname) && pathname !== "/zaman-yolcusu/yeni";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const { status } = useShellStatus();
  const onNewProject = pathname === "/anlatici/yeni";

  const health: { tone: "success" | "warning" | "danger"; label: string; detail: string } = !status
    ? { tone: "warning", label: "Kontrol ediliyor", detail: "Sistem durumu okunuyor" }
    : status.runningJobs > 0
      ? { tone: "warning", label: "Otomasyon aktif", detail: `${status.runningJobs} görev çalışıyor` }
      : !status.openaiKeyPresent
        ? { tone: "danger", label: "Kurulum eksik", detail: "OpenAI anahtarı girilmemiş" }
        : status.flowSession.status === "ready"
          ? { tone: "success", label: "Sistem hazır", detail: "Flow oturumu açık" }
          : { tone: "success", label: "Sistem hazır", detail: "Flow tarayıcısı kapalı" };

  return (
    <aside className="rail-surface sticky top-0 z-20 flex h-screen w-[268px] shrink-0 flex-col overflow-y-auto">
      <Link
        href="/"
        className="group flex h-[76px] items-center gap-3 border-b rail-divider px-5 focus-ring"
        aria-label="ByHickimse Sinema Stüdyosu — panele git"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-[14px] brand-mark">
          <Clapperboard className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[17px] font-extrabold leading-none tracking-[-0.03em] text-foreground">ByHickimse</div>
          <div className="mt-1.5 text-[9.5px] font-bold leading-none tracking-[0.2em] uppercase text-primary">
            Sinema Stüdyosu
          </div>
        </div>
      </Link>

      <div className="px-4 pt-5">
        <Link
          href="/anlatici/yeni"
          aria-current={onNewProject ? "page" : undefined}
          className={cn(
            "focus-ring group flex items-center gap-3 rounded-[14px] brand-cta px-3 py-2.5 text-[13px] font-bold",
            "hover:-translate-y-px active:translate-y-0",
            onNewProject && "ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
          )}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-white/18 ring-1 ring-white/25">
            <Plus className="h-4 w-4" />
          </span>
          <span className="flex-1">Yeni anlatı</span>
          <Sparkles className="h-3.5 w-3.5 opacity-80" />
        </Link>
      </div>

      <nav className="flex-1 space-y-6 px-4 py-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="rail-label mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.16em]">{group.label}</div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isNavActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "focus-ring group relative flex items-center gap-3 rounded-[12px] px-2 py-1.5 rail-item",
                      active && "rail-item-active"
                    )}
                  >
                    <span
                      className={cn(
                        "icon-tile h-8 w-8 shrink-0 rounded-[10px]",
                        active ? "icon-tile-solid" : "icon-tile-neutral"
                      )}
                    >
                      <Icon className="h-[15px] w-[15px]" />
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block text-[13px] leading-tight", active ? "font-bold" : "font-semibold")}>
                        {item.label}
                      </span>
                      <span className="block text-[10.5px] leading-tight text-muted-2 mt-0.5">{item.hint}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 pb-5">
        <div className="rail-card rounded-[16px] p-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "icon-tile h-8 w-8 rounded-[10px]",
                health.tone === "success" && "icon-tile-success",
                health.tone === "warning" && "icon-tile-warning",
                health.tone === "danger" && "icon-tile-danger"
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full pulse-dot",
                  health.tone === "success" && "bg-success",
                  health.tone === "warning" && "bg-warning",
                  health.tone === "danger" && "bg-danger"
                )}
              />
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold text-foreground leading-tight">{health.label}</div>
              <div className="mt-0.5 text-[10.5px] text-muted leading-tight">{health.detail}</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-[10.5px] text-muted">
            <span>
              <span className="block text-[15px] font-extrabold text-foreground tabular-nums leading-none">
                {status ? status.projectCount : "–"}
              </span>
              <span className="mt-1 block">anlatı</span>
            </span>
            <span className="flex items-end gap-1.5">
              <ShieldCheck className={cn("h-3.5 w-3.5", status?.openaiKeyPresent ? "text-success" : "text-muted-2")} />
              {status?.openaiKeyPresent ? "API hazır" : "API yok"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

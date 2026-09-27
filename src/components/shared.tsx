"use client";

import * as React from "react";
import { Check, Minus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Sayfa basligi blogu. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="hero-panel mb-7 flex flex-wrap items-start justify-between gap-5 rounded-[22px] px-6 py-6 sm:px-7">
      <div className="relative min-w-0">
        {eyebrow && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/80 px-3 py-1 shadow-[0_1px_2px_rgba(15,40,90,0.06)]">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#0ea5e9]" />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary-strong">{eyebrow}</span>
          </div>
        )}
        {typeof title === "string" ? (
          <h1 className="font-display text-[30px] leading-[1.08] sm:text-[34px]">{title}</h1>
        ) : (
          title
        )}
        {description && <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="relative flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Numarali form bolumu — uzun formlarda (or. Yeni Proje) gorsel ritim ve
 * "neredeyim" hissi verir.
 */
export function FormSection({
  step,
  title,
  description,
  children,
  action,
}: {
  step: number | string;
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-border bg-surface card-shadow">
      <header className="flex items-start gap-3.5 border-b border-border bg-gradient-to-b from-[#f7faff] to-white px-5 py-4 rounded-t-[18px]">
        <span className="icon-tile icon-tile-solid mt-px h-8 w-8 shrink-0 rounded-[10px] text-[12px] font-extrabold tabular-nums">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold tracking-[-0.015em] leading-snug">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] text-muted leading-relaxed">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

/** Form alani + etiket + yardim metni / hata mesaji sarmalayicisi. */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold tracking-[-0.005em] text-foreground/80"
      >
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[11px] font-medium text-danger leading-relaxed">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-[11px] text-muted-2 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

/** Bos durum karti. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="hero-panel flex flex-col items-center justify-center rounded-[20px] px-8 py-16 text-center">
      {icon && (
        <div className="icon-tile icon-tile-solid relative mb-5 h-16 w-16 rounded-[20px] ring-8 ring-primary/8">
          {icon}
        </div>
      )}
      <h3 className="relative text-[17px] font-bold tracking-[-0.02em]">{title}</h3>
      {description && <p className="relative mt-2 max-w-md text-[13px] text-muted leading-relaxed">{description}</p>}
      {action && <div className="relative mt-6">{action}</div>}
    </div>
  );
}

/** Proje durumu rozetleri. */
const PROJECT_STATUS: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Taslak", variant: "default" },
  story_ready: { label: "Hikaye Hazir", variant: "info" },
  clips_ready: { label: "Klipler Hazir", variant: "info" },
  prompts_ready: { label: "Promptlar Hazir", variant: "primary" },
  automating: { label: "Otomasyon Calisiyor", variant: "warning" },
  clips_done: { label: "Klipler Tamamlandi", variant: "success" },
  rendering: { label: "Birlestiriliyor", variant: "warning" },
  completed: { label: "Tamamlandi", variant: "success" },
  render_failed: { label: "Birlestirme Hatasi", variant: "danger" },
  failed: { label: "Hata", variant: "danger" },
};

export function ProjectStatusBadge({ status }: { status: string }) {
  const config = PROJECT_STATUS[status] ?? { label: status, variant: "default" as const };
  return (
    <Badge variant={config.variant} dot>
      {config.label}
    </Badge>
  );
}

/** Klip durumu rozetleri (durum makinesi adimlari). */
const CLIP_STATUS: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Taslak", variant: "default" },
  pending: { label: "Kuyrukta", variant: "default" },
  preparing: { label: "Hazirlaniyor", variant: "info" },
  opening_flow: { label: "Flow Aciliyor", variant: "info" },
  waiting_for_login: { label: "Giris Bekliyor", variant: "warning" },
  selecting_project: { label: "Proje Seciliyor", variant: "info" },
  uploading_reference: { label: "Referans Yukleniyor", variant: "info" },
  configuring_model: { label: "Model Ayarlaniyor", variant: "info" },
  entering_prompt: { label: "Prompt Yaziliyor", variant: "info" },
  generating: { label: "Uretiliyor", variant: "primary" },
  waiting_for_completion: { label: "Uretim Bekleniyor", variant: "primary" },
  downloading: { label: "Indiriliyor", variant: "primary" },
  validating_download: { label: "Dogrulaniyor", variant: "info" },
  extracting_last_frame: { label: "Son Kare Cikariliyor", variant: "info" },
  completed: { label: "Tamamlandi", variant: "success" },
  retrying: { label: "Yeniden Denenecek", variant: "warning" },
  paused: { label: "Duraklatildi", variant: "warning" },
  needs_manual_action: { label: "Elle Mudahale", variant: "danger" },
  failed: { label: "Basarisiz", variant: "danger" },
};

const ACTIVE_CLIP_STATES = new Set([
  "preparing",
  "opening_flow",
  "selecting_project",
  "uploading_reference",
  "configuring_model",
  "entering_prompt",
  "generating",
  "waiting_for_completion",
  "downloading",
  "validating_download",
  "extracting_last_frame",
]);

export function ClipStatusBadge({ status }: { status: string }) {
  const config = CLIP_STATUS[status] ?? { label: status, variant: "default" as const };
  return (
    <Badge variant={config.variant} dot pulse={ACTIVE_CLIP_STATES.has(status)}>
      {config.label}
    </Badge>
  );
}

/** Kucuk istatistik karti. */
export function StatCard({
  label,
  value,
  icon,
  tone = "default",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "danger" | "warning" | "primary";
  hint?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[18px] border border-border bg-surface p-5 card-shadow card-lift">
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-[3px]",
          tone === "default" && "bg-gradient-to-r from-[#cbd5e1] to-[#e2e8f0]",
          tone === "primary" && "bg-gradient-to-r from-[#2563eb] to-[#0ea5e9]",
          tone === "success" && "bg-gradient-to-r from-[#0e9f6e] to-[#34d399]",
          tone === "danger" && "bg-gradient-to-r from-[#dc2626] to-[#f87171]",
          tone === "warning" && "bg-gradient-to-r from-[#c2410c] to-[#fb923c]"
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="section-label">{label}</div>
          <div className="mt-3 text-[32px] font-extrabold tabular-nums leading-none tracking-[-0.035em] text-foreground">
            {value}
          </div>
          {hint && <div className="mt-2.5 text-[11.5px] font-medium text-muted-2 leading-relaxed">{hint}</div>}
        </div>
        {icon && (
          <span
            className={cn(
              "icon-tile h-11 w-11 shrink-0 rounded-[13px]",
              tone === "default" && "icon-tile-neutral",
              tone === "primary" && "icon-tile-solid",
              tone === "success" && "icon-tile-success",
              tone === "danger" && "icon-tile-danger",
              tone === "warning" && "icon-tile-warning"
            )}
          >
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}

/** Sistem durumu satiri (dashboard + kurulum). */
export function CheckRow({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0 last:pb-0 first:pt-0">
      <span
        className={cn(
          "icon-tile mt-0.5 h-7 w-7 shrink-0 rounded-[9px]",
          ok === true && "icon-tile-success",
          ok === false && "icon-tile-danger",
          ok === null && "icon-tile-neutral"
        )}
      >
        {ok === true ? (
          <Check className="h-3.5 w-3.5" />
        ) : ok === false ? (
          <X className="h-3.5 w-3.5" />
        ) : (
          <Minus className="h-3.5 w-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold">{label}</span>
          {ok === false && (
            <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-bold text-danger shrink-0">EKSİK</span>
          )}
        </div>
        <div className="text-[11.5px] text-muted break-all leading-relaxed mt-0.5">{detail}</div>
      </div>
    </div>
  );
}

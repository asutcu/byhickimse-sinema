"use client";

import * as React from "react";
import { Check, Loader2, Rocket, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProgressPayload {
  exists: boolean;
  templateType?: string;
  autopilot?: { running: boolean; phase: string; message: string; error: string; stale?: boolean } | null;
  longform?: {
    phase: string;
    message: string;
    step: number;
    totalSteps: number;
    finished: boolean;
    error: string | null;
  } | null;
  counts?: {
    story: boolean;
    clipTotal: number;
    clipCompleted: number;
    clipFailed: number;
    stillCount: number;
    promptReady: number;
    castTotal: number;
    castWithImage: number;
  };
  activeClip?: { index: number; status: string } | null;
  events?: Array<{ message: string; level: string; step: string; at: string }>;
}

const NARRATOR_STEPS = [
  { key: "story", label: "Hikaye" },
  { key: "clips", label: "Klipler" },
  { key: "characters", label: "Karakterler" },
  { key: "prompts", label: "Promptlar" },
  { key: "automation", label: "Otomasyon" },
  { key: "thumbnail", label: "Kapak" },
] as const;

const LONGFORM_STEPS = [
  { key: "story", label: "Senaryo" },
  { key: "beats", label: "Parçalar" },
  { key: "tts", label: "Ses" },
  { key: "stills", label: "Kareler" },
  { key: "thumbnail", label: "Kapak" },
] as const;

function stepState(
  stepKey: string,
  data: ProgressPayload
): "done" | "active" | "pending" {
  const phase = data.autopilot?.phase || "";
  const c = data.counts;
  const lfPhase = data.longform?.phase || "";
  if (!c) return "pending";

  if (data.templateType === "longform") {
    const order = ["story", "beats", "tts", "stills", "thumbnail"];
    const doneBy: Record<string, boolean> = {
      story: c.story,
      beats: c.clipTotal > 0,
      tts: false,
      stills: c.clipTotal > 0 && c.stillCount >= c.clipTotal,
      thumbnail: false,
    };
    const activeKey =
      phase === "thumbnail"
        ? "thumbnail"
        : lfPhase && order.includes(lfPhase)
          ? lfPhase
          : phase === "produce"
            ? "story"
            : "";
    if (stepKey === activeKey && data.autopilot?.running) return "active";
    if (doneBy[stepKey]) return "done";
    const ai = order.indexOf(activeKey);
    const si = order.indexOf(stepKey);
    if (ai >= 0 && si >= 0 && si < ai) return "done";
    return "pending";
  }

  const order = ["story", "clips", "characters", "prompts", "automation", "thumbnail"];
  const doneBy: Record<string, boolean> = {
    story: c.story,
    clips: c.clipTotal > 0,
    characters: c.castTotal > 0 && c.castWithImage >= c.castTotal,
    prompts: c.clipTotal > 0 && c.promptReady >= c.clipTotal,
    automation: c.clipTotal > 0 && c.clipCompleted >= c.clipTotal,
    thumbnail: false,
  };
  if (stepKey === phase && data.autopilot?.running) return "active";
  if (doneBy[stepKey]) return "done";
  const ai = order.indexOf(phase);
  const si = order.indexOf(stepKey);
  if (ai >= 0 && si >= 0 && si < ai) return "done";
  return "pending";
}

/** Otopilot ilerleme paneli: adimlar + sayaclar + son olaylar. Hafif (6 sn'de tek istek). */
export function AutoPilotBanner({ projectId }: { projectId: string }) {
  const [data, setData] = React.useState<ProgressPayload | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [acting, setActing] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/autopilot/progress`, { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          const body = (await res.json()) as { ok: boolean; data: ProgressPayload };
          if (body?.ok) setData(body.data);
        }
      } catch {
        // sunucu mesgulse sessiz gec
      }
      if (alive) timer = setTimeout(poll, 6_000);
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);

  const ap = data?.autopilot;
  if (!data?.exists || !ap || dismissed) return null;

  const running = ap.running;
  const failed = ["failed", "cancelled"].includes(ap.phase) || ap.stale;
  const done = ap.phase === "done";
  if (!running && !failed && !done) return null;

  const steps = data.templateType === "longform" ? LONGFORM_STEPS : NARRATOR_STEPS;
  const c = data.counts;
  const isLongform = data.templateType === "longform";
  const produced = isLongform ? c?.stillCount || 0 : c?.clipCompleted || 0;
  const total = c?.clipTotal || 0;
  const pct = total > 0 ? Math.min(100, Math.round((produced / total) * 100)) : 0;
  const liveMessage = (isLongform && running ? data.longform?.message : "") || ap.error || ap.message;

  return (
    <div
      className={cn(
        "mb-4 rounded-[14px] border card-shadow overflow-hidden",
        failed ? "border-danger/25 bg-danger-soft/50" : done ? "border-success/25 bg-success-soft/50" : "border-primary/20 bg-surface"
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-[9px] border bg-surface",
            failed ? "border-danger/25 text-danger" : done ? "border-success/25 text-success" : "border-primary/25 text-primary"
          )}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">
            Otopilot{" "}
            {failed
              ? "· durdu — kaldığı yerden devam edebilirsiniz"
              : done
                ? "· tamamlandı — render sizde"
                : ap.phase === "retrying"
                  ? "· hata aldı, otomatik toparlıyor"
                  : "· çalışıyor"}
          </div>
          <div className="truncate text-[11.5px] text-muted">{liveMessage}</div>
        </div>
        {running ? (
          <Button
            size="sm"
            variant="outline"
            loading={acting}
            onClick={async () => {
              setActing(true);
              await fetch(`/api/projects/${projectId}/autopilot`, { method: "DELETE" }).catch(() => {});
              setActing(false);
            }}
          >
            <Square className="h-3.5 w-3.5" /> Durdur
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {failed && (
              <Button
                size="sm"
                loading={acting}
                onClick={async () => {
                  setActing(true);
                  await fetch(`/api/projects/${projectId}/autopilot`, { method: "POST" }).catch(() => {});
                  setActing(false);
                }}
              >
                <Rocket className="h-3.5 w-3.5" /> Kaldığı yerden devam et
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setDismissed(true)}>
              Kapat
            </Button>
          </div>
        )}
      </div>

      {/* Adim gostergesi */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        {steps.map((s) => {
          const state = stepState(s.key, data);
          return (
            <span
              key={s.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                state === "done" && "border-success/25 bg-success-soft text-success",
                state === "active" && "border-primary/30 bg-primary-soft text-primary",
                state === "pending" && "border-border bg-surface-2 text-muted-2"
              )}
            >
              {state === "done" ? (
                <Check className="h-3 w-3" />
              ) : state === "active" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
              )}
              {s.label}
            </span>
          );
        })}
      </div>

      {/* Uretim sayaci */}
      {total > 0 && (
        <div className="px-4 pt-3">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>
              {isLongform ? "Kare" : "Klip"}: <span className="font-semibold text-foreground tabular-nums">{produced}/{total}</span>
              {!isLongform && data.activeClip ? ` · şu an #${data.activeClip.index}` : ""}
              {c && c.clipFailed > 0 ? ` · ${c.clipFailed} atlandı` : ""}
              {!isLongform && c ? ` · kadro ${c.castWithImage}/${c.castTotal}` : ""}
            </span>
            <span className="tabular-nums font-semibold text-foreground">%{pct}</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-4">
            <div
              className={cn("h-full rounded-full", failed ? "bg-danger" : "bg-primary progress-glow")}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
        </div>
      )}

      {/* Son olaylar */}
      {(data.events?.length || 0) > 0 && (
        <div className="mt-3 border-t border-border/70 bg-surface-2/60 px-4 py-2 space-y-0.5">
          {data.events!.slice(0, 3).map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[10.5px] leading-relaxed">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  e.level === "error" ? "bg-danger" : e.level === "warning" ? "bg-warning" : "bg-success"
                )}
              />
              <span className="truncate text-muted">{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

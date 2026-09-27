"use client";

import * as React from "react";
import { Anchor, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { analyzeCuriosityFlow, curiosityWarnings } from "@/lib/curiosity-flow";
import type { ClipData } from "@/components/project/types";
import { cn } from "@/lib/utils";

/**
 * Merak akisi paneli: izleyicinin "acaba ne olacak?" hissini kaybettigi
 * noktalari gosterir. Cubuklar klip bazinda merak puanidir.
 */
export function CuriosityCard({ clips, unit = "Sahne" }: { clips: ClipData[]; unit?: string }) {
  const report = React.useMemo(
    () => analyzeCuriosityFlow(clips.map((c) => ({ index: c.index, curiosityScore: c.curiosityScore, hasHook: c.hasHook }))),
    [clips]
  );
  const warnings = React.useMemo(() => curiosityWarnings(report), [report]);

  if (clips.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle>Merak Akisi</CardTitle>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant={report.averageScore >= 6 ? "success" : "warning"}>Ortalama {report.averageScore}/10</Badge>
            <Badge variant={report.hasPeak ? "primary" : "warning"}>Doruk {report.peakScore}/10</Badge>
          </div>
        </div>
        <CardDescription>
          Izleyici her {unit.toLowerCase()} sonunda bir sonrakini merak etmeli. Dusuk cubuklar izleyicinin birakabilecegi yerlerdir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-1 h-20">
          {clips.map((clip) => (
            <div key={clip.id} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${unit} ${clip.index}: ${clip.curiosityScore}/10`}>
              <div
                className={cn(
                  "w-full rounded-t-[3px]",
                  clip.curiosityScore >= 9
                    ? "bg-primary"
                    : clip.curiosityScore >= 5
                      ? "bg-info"
                      : "bg-warning"
                )}
                style={{ height: `${Math.max(6, (clip.curiosityScore / 10) * 64)}px` }}
              />
              {clip.hasHook && <Anchor className="h-2.5 w-2.5 text-muted-2 shrink-0" />}
            </div>
          ))}
        </div>
        {warnings.length > 0 ? (
          <div className="mt-3 space-y-1 rounded-[10px] border border-warning/30 bg-warning-soft/40 p-3">
            {warnings.map((warning) => (
              <p key={warning} className="text-[11.5px] text-warning leading-relaxed">
                {warning}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[11.5px] text-success">
            Akis saglam: kancasiz {unit.toLowerCase()} yok, art arda dusuk merak yok, doruk noktasi var.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

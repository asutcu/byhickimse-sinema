"use client";

import * as React from "react";
import { AlertTriangle, BookMarked, Clock, Crown, ExternalLink, Globe, Landmark, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TimeTravelResearch } from "@/lib/time-travel";

/** Arastirma dosyasini okunur bicimde gosterir (duraklar, yerliler, unluler, kaynaklar). */
export function TimeTravelResearchPanel({ research }: { research: TimeTravelResearch }) {
  const [showSources, setShowSources] = React.useState(false);
  return (
    <div className="space-y-4">
      <div className="rounded-[16px] border border-primary/15 bg-gradient-to-br from-[#f5f9ff] to-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary">
            <Landmark className="h-3 w-3" /> {research.era}
          </Badge>
          <Badge variant="info">{research.place}</Badge>
          {research.webSearched ? (
            <Badge variant="success">
              <Globe className="h-3 w-3" /> Web araştırması · {research.sources.length} kaynak
            </Badge>
          ) : (
            <Badge variant="warning">Web araması yapılamadı — model bilgisi</Badge>
          )}
        </div>
        {research.title && <div className="mt-3 text-[15px] font-bold tracking-[-0.015em]">{research.title}</div>}
        {research.summary && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{research.summary}</p>}
        {research.hostAngle && (
          <p className="mt-2 text-[12.5px] leading-relaxed">
            <span className="font-semibold text-primary-strong">Sunucunun hikâyesi: </span>
            {research.hostAngle}
          </p>
        )}
      </div>

      {research.stops.length > 0 && (
        <div>
          <div className="section-label mb-2">Yolculuk planı · {research.stops.length} durak</div>
          <ol className="relative space-y-2 border-l-2 border-primary/15 pl-5">
            {research.stops.map((stop, i) => (
              <li key={`${stop.time}-${i}`} className="relative">
                <span className="absolute -left-[29px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-b from-[#3b82f6] to-[#1d4ed8] text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="rounded-[12px] border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold">
                    <span className="inline-flex items-center gap-1 text-primary-strong">
                      <Clock className="h-3 w-3" /> {stop.time}
                    </span>
                    <span className="text-foreground">{stop.location}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">{stop.happening}</p>
                  {stop.facts.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {stop.facts.map((fact, j) => (
                        <li key={j} className="text-[11.5px] leading-relaxed text-foreground/80">
                          • {fact}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {research.locals.length > 0 && (
          <div className="rounded-[14px] border border-border bg-surface p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold">
              <Users className="h-3.5 w-3.5 text-primary" /> Dönem yerlileri
            </div>
            <div className="flex flex-wrap gap-1.5">
              {research.locals.map((local) => (
                <Badge key={local.name}>
                  {local.name} · {local.role}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {research.famousFigures.length > 0 && (
          <div className="rounded-[14px] border border-border bg-surface p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold">
              <Crown className="h-3.5 w-3.5 text-primary" /> Ünlü kişiler — yalnızca uzaktan
            </div>
            <ul className="space-y-1">
              {research.famousFigures.map((figure) => (
                <li key={figure.name} className="text-[11.5px] leading-relaxed text-muted">
                  <span className="font-semibold text-foreground">{figure.name}</span> — {figure.staging}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {research.cautions.length > 0 && (
        <div className="rounded-[14px] border border-warning/25 bg-warning-soft/60 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Doğruluk notları (senaryo bunlara uyar)
          </div>
          <ul className="space-y-0.5">
            {research.cautions.map((note, i) => (
              <li key={i} className="text-[11.5px] leading-relaxed text-foreground/80">
                • {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {research.sources.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-primary-strong hover:underline cursor-pointer"
          >
            <BookMarked className="h-3.5 w-3.5" /> {showSources ? "Kaynakları gizle" : `Kaynakları göster (${research.sources.length})`}
          </button>
          {showSources && (
            <ul className="mt-2 space-y-1">
              {research.sources.map((source) => (
                <li key={source.url} className="text-[11.5px]">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted hover:text-primary-strong"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="line-clamp-1">{source.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

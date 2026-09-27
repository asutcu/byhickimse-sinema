"use client";

import type { LucideIcon } from "lucide-react";
import {
  Ban,
  BookHeart,
  Building2,
  Clapperboard,
  CloudLightning,
  Crown,
  DoorOpen,
  Drama,
  Eye,
  FileSignature,
  Flame,
  Gavel,
  Ghost,
  HandCoins,
  Heart,
  HeartCrack,
  HeartOff,
  Home,
  KeyRound,
  Landmark,
  Lock,
  PenLine,
  Repeat2,
  Scale,
  Search,
  Sparkles,
  Sunrise,
  TrendingUp,
  UserRoundX,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NARRATOR_GENRE_GROUPS,
  narratorGenreById,
  type NarratorGenreId,
} from "@/lib/narrator-genres";

/** NetShort taksonomisiyle hizali kompakt tur kartlari — kucuk ikon + etiket. */
const GENRE_ICONS: Record<string, LucideIcon> = {
  aldatma: HeartCrack,
  ihanet: UserRoundX,
  "yasak-ask": Ban,
  kiskanclik: Eye,
  intikam: Flame,
  bosanma: FileSignature,
  "aile-sirri": Lock,
  kayinvalide: Home,
  "hesap-sorma": Gavel,
  "guclu-donus": Crown,
  "yeniden-dogus": Sunrise,
  "kadin-gelisimi": TrendingUp,
  "gizli-kimlik": KeyRound,
  "sozlesmeli-evlilik": Scale,
  "yildirim-nikahi": CloudLightning,
  "zengin-aile": Landmark,
  pismanlik: DoorOpen,
  "trajik-ask": HeartOff,
  "aile-bagi": Users,
  "ahlaki-ikilem": Drama,
  gizem: Search,
  gerilim: Building2,
  dram: Clapperboard,
  "gercek-yasam": HandCoins,
  romantik: Heart,
  korku: Ghost,
  ozel: PenLine,
};

export function NarratorGenrePicker({
  value,
  onChange,
}: {
  value: NarratorGenreId;
  onChange: (id: NarratorGenreId) => void;
}) {
  return (
    <div className="space-y-4">
      {NARRATOR_GENRE_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="mb-1.5 flex items-baseline gap-2">
            <div className="section-label">{group.title}</div>
            <p className="text-[10.5px] text-muted-2 truncate">{group.hint}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5">
            {group.ids.map((id) => {
              const g = narratorGenreById(id);
              const selected = value === g.id;
              const Icon = GENRE_ICONS[g.id] ?? Sparkles;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChange(g.id)}
                  title={g.tagline}
                  className={cn(
                    "focus-ring flex items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left",
                    selected
                      ? "border-primary bg-primary-soft/50 ring-1 ring-primary/25"
                      : "border-border bg-surface hover:border-primary/40 hover:bg-surface-2"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border",
                      selected ? "border-primary/25 bg-primary-soft text-primary" : "border-border bg-surface-3 text-muted"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-[11.5px] font-semibold", selected && "text-primary")}>
                      {g.label}
                    </span>
                    <span className="block truncate text-[9.5px] text-muted-2 leading-tight">{g.tagline}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

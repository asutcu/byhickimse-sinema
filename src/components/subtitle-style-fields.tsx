"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_FONTS,
  SUBTITLE_FONT_LABELS,
  SUBTITLE_LOOKS,
  SUBTITLE_LOOK_LABELS,
  SUBTITLE_POSITIONS,
  SUBTITLE_POSITION_LABELS,
  SUBTITLE_SIZES,
  SUBTITLE_SIZE_LABELS,
  type BurnSubtitleStyle,
  type SubtitleFont,
  type SubtitleLook,
  type SubtitlePosition,
  type SubtitleSize,
} from "@/lib/subtitle-style";

function ColorField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-11 cursor-pointer rounded-[8px] border border-border bg-surface p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={label}
        />
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 flex-1 rounded-[10px] border border-border bg-surface px-2.5 text-[12px] tabular-nums uppercase disabled:opacity-50"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function previewPlacement(position: SubtitlePosition): React.CSSProperties {
  if (position === "top") return { top: "10%", left: "50%", transform: "translateX(-50%)" };
  if (position === "center") return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  if (position === "below") return { bottom: "10px", left: "50%", transform: "translateX(-50%)" };
  return { bottom: "11%", left: "50%", transform: "translateX(-50%)" };
}

function previewTextClass(style: BurnSubtitleStyle): string {
  const size = style.size === "small" ? "text-[11px]" : style.size === "large" ? "text-[16px]" : "text-[13px]";
  const weight = style.bold ? "font-semibold" : "font-normal";
  const font =
    style.font === "impact" ? "font-[Impact,Arial,sans-serif]" : style.font === "segoe" ? "font-[Segoe_UI,Arial,sans-serif]" : "font-sans";
  return cn("max-w-[86%] text-center leading-snug", size, weight, font);
}

function previewTextStyle(style: BurnSubtitleStyle): React.CSSProperties {
  if (style.look === "box") {
    return {
      color: style.color,
      background: `${style.outlineColor}CC`,
      padding: "3px 8px",
      borderRadius: 3,
    };
  }
  if (style.look === "shadow") {
    return {
      color: style.color,
      textShadow: `0 2px 4px ${style.outlineColor}`,
    };
  }
  return {
    color: style.color,
    WebkitTextStroke: `1px ${style.outlineColor}`,
    paintOrder: "stroke fill",
  };
}

export function SubtitleStyleFields({
  value,
  onChange,
  disabled = false,
}: {
  value: BurnSubtitleStyle;
  onChange: (next: BurnSubtitleStyle) => void;
  disabled?: boolean;
}) {
  const style = value.enabled !== undefined ? value : { ...DEFAULT_SUBTITLE_STYLE, ...value };

  function patch(partial: Partial<BurnSubtitleStyle>) {
    if (disabled) return;
    onChange({ ...style, ...partial });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-[12px] border border-border bg-surface-2 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Alt yazı</div>
          <p className="mt-0.5 text-[11.5px] text-muted leading-relaxed">
            Açıkken konuşma film gibi altta, en fazla iki satır durur. Sahnenin ortasını kaplamaz; punto bir
            kademe daha büyüktür.
          </p>
        </div>
        <Switch checked={style.enabled} onCheckedChange={(enabled) => patch({ enabled })} disabled={disabled} className="mt-0.5 shrink-0" />
      </div>

      {style.enabled && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Konum</Label>
              <Select value={style.position} onValueChange={(v) => patch({ position: v as SubtitlePosition })} disabled={disabled}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBTITLE_POSITIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {SUBTITLE_POSITION_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Yazı boyutu</Label>
              <Select value={style.size} onValueChange={(v) => patch({ size: v as SubtitleSize })} disabled={disabled}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBTITLE_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SUBTITLE_SIZE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Yazı tipi</Label>
              <Select value={style.font} onValueChange={(v) => patch({ font: v as SubtitleFont })} disabled={disabled}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBTITLE_FONTS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {SUBTITLE_FONT_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Biçim</Label>
              <Select value={style.look} onValueChange={(v) => patch({ look: v as SubtitleLook })} disabled={disabled}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBTITLE_LOOKS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {SUBTITLE_LOOK_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ColorField label="Yazı rengi" value={style.color} onChange={(color) => patch({ color })} disabled={disabled} />
            <ColorField
              label={style.look === "box" ? "Kutu rengi" : "Kontur rengi"}
              value={style.outlineColor}
              onChange={(outlineColor) => patch({ outlineColor })}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
            <div>
              <div className="text-[12.5px] font-medium">Kalın yazı</div>
              <p className="text-[10.5px] text-muted">Tüm kliplerde aynı kalınlık</p>
            </div>
            <Switch checked={style.bold} onCheckedChange={(bold) => patch({ bold })} disabled={disabled} />
          </div>

          <div>
            <Label>Önizleme</Label>
            <div
              className={cn(
                "mt-1.5 overflow-hidden rounded-[12px] border border-border bg-black",
                style.position === "below" ? "" : "relative aspect-video"
              )}
            >
              {style.position === "below" ? (
                <>
                  <div className="relative aspect-video bg-[#1a1f2c]">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(80,90,120,0.35),transparent_70%)]" />
                    <div className="absolute left-3 top-3 text-[10px] text-white/40">Örnek kare — yazı buraya binmez</div>
                  </div>
                  <div className="relative flex min-h-[52px] items-center justify-center bg-black px-3 py-2">
                    <span className={previewTextClass(style)} style={previewTextStyle(style)}>
                      Yazı görüntünün altında durur.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(80,90,120,0.35),transparent_70%)]" />
                  <div className="absolute left-3 top-3 text-[10px] text-white/40">Örnek kare</div>
                  <div className="absolute" style={previewPlacement(style.position)}>
                    <span className={previewTextClass(style)} style={previewTextStyle(style)}>
                      Her klipte yazı burada durur.
                    </span>
                  </div>
                </>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
              Film gibi altta seçiliyse yazı görüntünün altında, alt kenara yakındır. Görüntünün altı seçiliyse yazı kareye basılmaz; siyah bantta kalır.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Gomulu (burn-in) altyazi stili.
 * Tum klipler ayni konum / renk / bicimde yazar — sahne degisse de yer degismez.
 */

export const SUBTITLE_POSITIONS = ["below", "bottom", "center", "top"] as const;
export type SubtitlePosition = (typeof SUBTITLE_POSITIONS)[number];

export const SUBTITLE_SIZES = ["small", "medium", "large"] as const;
export type SubtitleSize = (typeof SUBTITLE_SIZES)[number];

export const SUBTITLE_LOOKS = ["box", "outline", "shadow"] as const;
export type SubtitleLook = (typeof SUBTITLE_LOOKS)[number];

export const SUBTITLE_FONTS = ["arial", "segoe", "impact"] as const;
export type SubtitleFont = (typeof SUBTITLE_FONTS)[number];

export interface BurnSubtitleStyle {
  enabled: boolean;
  /** below = video alt kenari, bottom = klasik alt orta */
  position: SubtitlePosition;
  /** #RRGGBB */
  color: string;
  outlineColor: string;
  size: SubtitleSize;
  look: SubtitleLook;
  bold: boolean;
  font: SubtitleFont;
}

export const DEFAULT_SUBTITLE_STYLE: BurnSubtitleStyle = {
  enabled: false,
  position: "bottom",
  color: "#FFFFFF",
  outlineColor: "#000000",
  size: "medium",
  look: "box",
  bold: true,
  font: "arial",
};

export interface AssDialogueCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface AssStyleLayout {
  fontName: string;
  fontSize: number;
  primaryColour: string;
  outlineColour: string;
  backColour: string;
  borderStyle: number;
  outline: number;
  shadow: number;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  bold: boolean;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function normalizeHexColor(value: string | undefined, fallback: string): string {
  const raw = (value || "").trim();
  if (HEX.test(raw)) return raw.toUpperCase();
  if (HEX.test(`#${raw}`)) return `#${raw}`.toUpperCase();
  return fallback;
}

function isPosition(value: string): value is SubtitlePosition {
  return (SUBTITLE_POSITIONS as readonly string[]).includes(value);
}

function isSize(value: string): value is SubtitleSize {
  return (SUBTITLE_SIZES as readonly string[]).includes(value);
}

function isLook(value: string): value is SubtitleLook {
  return (SUBTITLE_LOOKS as readonly string[]).includes(value);
}

function isFont(value: string): value is SubtitleFont {
  return (SUBTITLE_FONTS as readonly string[]).includes(value);
}

export function parseSubtitleStyle(raw: unknown): BurnSubtitleStyle {
  const src = raw && typeof raw === "object" ? (raw as Partial<BurnSubtitleStyle>) : {};
  return {
    enabled: src.enabled === true,
    position: isPosition(String(src.position || "")) ? (src.position as SubtitlePosition) : DEFAULT_SUBTITLE_STYLE.position,
    color: normalizeHexColor(src.color, DEFAULT_SUBTITLE_STYLE.color),
    outlineColor: normalizeHexColor(src.outlineColor, DEFAULT_SUBTITLE_STYLE.outlineColor),
    size: isSize(String(src.size || "")) ? (src.size as SubtitleSize) : DEFAULT_SUBTITLE_STYLE.size,
    look: isLook(String(src.look || "")) ? (src.look as SubtitleLook) : DEFAULT_SUBTITLE_STYLE.look,
    bold: src.bold !== false,
    font: isFont(String(src.font || "")) ? (src.font as SubtitleFont) : DEFAULT_SUBTITLE_STYLE.font,
  };
}

export function subtitleStyleFingerprint(style: BurnSubtitleStyle): string {
  if (!style.enabled) return "off";
  return [
    "on",
    style.position,
    style.color,
    style.outlineColor,
    style.size,
    style.look,
    style.bold ? "1" : "0",
    style.font,
  ].join("|");
}

/** ASS / libass rengi: &HAABBGGRR */
export function hexToAssColor(hex: string, alpha = 0): string {
  const h = normalizeHexColor(hex, "#FFFFFF").slice(1);
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const aa = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .padStart(2, "0");
  return `&H${aa}${b}${g}${r}`.toUpperCase();
}

export function subtitleFontName(font: SubtitleFont): string {
  if (font === "segoe") return "Segoe UI";
  if (font === "impact") return "Impact";
  return "Arial";
}

/** Numpad hizasi: 2 alt orta, 5 orta, 8 ust orta. */
export function subtitleAssAlignment(position: SubtitlePosition): number {
  if (position === "top") return 8;
  if (position === "center") return 5;
  return 2;
}

export function subtitleMarginV(position: SubtitlePosition, videoHeight: number): number {
  const h = videoHeight > 0 ? videoHeight : 1080;
  const scale = h / 1080;
  if (position === "below") return Math.round(subtitleBelowBandHeight(h, "medium") * 0.22);
  if (position === "bottom") return Math.round(48 * scale);
  if (position === "top") return Math.round(56 * scale);
  return 0;
}

/**
 * "Video alti": yazı görüntünün ÜZERİNE binmesin diye 16:9 karenin altına
 * eklenen siyah bant yüksekliği (çift piksel). Iki satir + bir punto payi.
 */
export function subtitleBelowBandHeight(contentHeight: number, size: SubtitleSize): number {
  const font = subtitleFontSize(size, contentHeight);
  const block = Math.round(font * 1.4 * 2 + 36);
  return Math.max(120, Math.round(block / 2) * 2);
}

/** Yatay pay: yazi kare ortasinda kalir, kenara yapismaz. */
export function subtitleMarginH(videoHeight: number): number {
  const h = videoHeight > 0 ? videoHeight : 1080;
  const width = Math.round((h * 16) / 9);
  return Math.max(64, Math.round(width * 0.1));
}

/** Gercek kare piksel — PlayRes video boyutuyla ayni olmali. */
export function subtitleFontSize(size: SubtitleSize, videoHeight: number): number {
  const h = videoHeight > 0 ? videoHeight : 1080;
  const scale = h / 1080;
  if (size === "small") return Math.max(28, Math.round(38 * scale));
  if (size === "large") return Math.round(56 * scale);
  return Math.round(46 * scale);
}

function estimatedTwoLineHeight(fontSize: number, outline: number): number {
  return Math.round(fontSize * 1.35 * 2 + outline * 2 + 8);
}

export function subtitleAssLayout(
  style: BurnSubtitleStyle,
  contentHeight: number,
  extras?: { belowBand?: number }
): AssStyleLayout {
  const look = style.look;
  const borderStyle = look === "box" ? 3 : 1;
  const outline = look === "outline" ? 3 : look === "box" ? 2 : 1;
  const shadow = look === "shadow" ? 2 : 0;
  const backAlpha = look === "box" ? 90 : 0;
  const fontSize = subtitleFontSize(style.size, contentHeight);
  const band =
    extras?.belowBand ??
    (style.position === "below" ? subtitleBelowBandHeight(contentHeight, style.size) : 0);
  const marginV =
    style.position === "below" && band > 0
      ? Math.max(14, Math.round((band - estimatedTwoLineHeight(fontSize, outline)) / 2))
      : subtitleMarginV(style.position, contentHeight);
  return {
    fontName: subtitleFontName(style.font),
    fontSize,
    primaryColour: hexToAssColor(style.color, 0),
    outlineColour: hexToAssColor(style.outlineColor, 0),
    backColour: hexToAssColor(style.outlineColor, backAlpha),
    borderStyle,
    outline,
    shadow,
    alignment: subtitleAssAlignment(style.position),
    marginL: subtitleMarginH(contentHeight),
    marginR: subtitleMarginH(contentHeight),
    marginV,
    bold: style.bold,
  };
}

/**
 * FFmpeg subtitles= force_style satiri.
 * Yalnizca PlayRes = video boyutu iken dogru piksel verir; burn-in icin ASS dosyasi kullan.
 */
export function buildAssForceStyle(
  style: BurnSubtitleStyle,
  videoHeight: number,
  extras?: { belowBand?: number }
): string {
  const layout = subtitleAssLayout(style, videoHeight, extras);
  return [
    `FontName=${layout.fontName}`,
    `FontSize=${layout.fontSize}`,
    `PrimaryColour=${layout.primaryColour}`,
    `OutlineColour=${layout.outlineColour}`,
    `BackColour=${layout.backColour}`,
    `BorderStyle=${layout.borderStyle}`,
    `Outline=${layout.outline}`,
    `Shadow=${layout.shadow}`,
    `Alignment=${layout.alignment}`,
    `MarginL=${layout.marginL}`,
    `MarginR=${layout.marginR}`,
    `MarginV=${layout.marginV}`,
    `Bold=${layout.bold ? 1 : 0}`,
  ].join(",");
}

export function formatAssTime(totalSeconds: number): string {
  const csTotal = Math.max(0, Math.round(totalSeconds * 100));
  const hours = Math.floor(csTotal / 360_000);
  const minutes = Math.floor((csTotal % 360_000) / 6_000);
  const seconds = Math.floor((csTotal % 6_000) / 100);
  const cs = csTotal % 100;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(cs)}`;
}

export function escapeAssDialogue(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r\n|\n|\r/g, "\\N");
}

/**
 * PlayRes = cikis karesi. Font/margin gercek pikseldir; yazi sahne ortasina sismez.
 */
export function buildAssContent(
  cues: AssDialogueCue[],
  style: BurnSubtitleStyle,
  playResX: number,
  playResY: number,
  extras?: { contentHeight?: number; belowBand?: number }
): string {
  const width = Math.max(2, Math.round(playResX / 2) * 2);
  const height = Math.max(2, Math.round(playResY / 2) * 2);
  const contentHeight =
    extras?.contentHeight && extras.contentHeight > 0
      ? extras.contentHeight
      : Math.max(2, height - (extras?.belowBand ?? 0));
  const layout = subtitleAssLayout(style, contentHeight, extras);
  const styleLine = [
    "Style: Default",
    layout.fontName,
    layout.fontSize,
    layout.primaryColour,
    "&H000000FF",
    layout.outlineColour,
    layout.backColour,
    layout.bold ? -1 : 0,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    layout.borderStyle,
    layout.outline,
    layout.shadow,
    layout.alignment,
    layout.marginL,
    layout.marginR,
    layout.marginV,
    1,
  ].join(",");
  const events = cues
    .filter((cue) => cue.text.trim() && cue.endSeconds > cue.startSeconds)
    .map((cue) => {
      const start = formatAssTime(cue.startSeconds);
      const end = formatAssTime(cue.endSeconds);
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${escapeAssDialogue(cue.text)}`;
    })
    .join("\n");
  return [
    "[Script Info]",
    "Title: Flow Bot",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    events,
    "",
  ].join("\n");
}

export const SUBTITLE_POSITION_LABELS: Record<SubtitlePosition, string> = {
  below: "Görüntünün altı (kareye binmez)",
  bottom: "Altta (film gibi)",
  center: "Orta",
  top: "Üst",
};

export const SUBTITLE_SIZE_LABELS: Record<SubtitleSize, string> = {
  small: "Küçük",
  medium: "Orta",
  large: "Büyük",
};

export const SUBTITLE_LOOK_LABELS: Record<SubtitleLook, string> = {
  box: "Kutu",
  outline: "Kontur",
  shadow: "Gölge",
};

export const SUBTITLE_FONT_LABELS: Record<SubtitleFont, string> = {
  arial: "Arial",
  segoe: "Segoe UI",
  impact: "Impact",
};

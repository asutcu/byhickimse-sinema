import fs from "node:fs";
import path from "node:path";

/** Uygulama koku (calisma dizini). */
export const APP_ROOT = process.cwd();

/** Tum proje icerikleri bu klasorun altinda yasar. */
export const PROJECTS_ROOT = path.join(APP_ROOT, "projects");

/** Varsayilan kalici Chrome profili klasoru. */
export const DEFAULT_CHROME_PROFILE_DIR = path.join(APP_ROOT, "chrome-profile");

/** Uygulama log dosyalari. */
export const LOGS_ROOT = path.join(APP_ROOT, "logs");

/**
 * Proje adindan guvenli, dosya sistemine uygun bir slug uretir.
 * Turkce karakterler cevrilir, tehlikeli karakterler temizlenir.
 */
export function slugify(name: string): string {
  const trMap: Record<string, string> = {
    ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", I: "i", İ: "i",
    ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
  };
  const replaced = name
    .split("")
    .map((ch) => trMap[ch] ?? ch)
    .join("")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = replaced
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
  return slug || "proje";
}

/**
 * Verilen goreli parcanin PROJECTS_ROOT disina cikmadigini garanti ederek
 * mutlak yol dondurur (path traversal korumasi).
 */
export function safeProjectPath(...segments: string[]): string {
  const target = path.resolve(PROJECTS_ROOT, ...segments);
  const rootResolved = path.resolve(PROJECTS_ROOT);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`Guvensiz dosya yolu engellendi: ${segments.join("/")}`);
  }
  return target;
}

/** Bir yolun PROJECTS_ROOT icinde olup olmadigini dogrular (okuma iceren API'ler icin). */
export function isInsideProjectsRoot(absolutePath: string): boolean {
  const rootResolved = path.resolve(PROJECTS_ROOT);
  const resolved = path.resolve(absolutePath);
  return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
}

/**
 * Eski kurulum klasorune (FLOW HIKAYE BOT, flow gorsel video bot, ...) yazilmis
 * mutlak yolu bu uygulamanin projects/ kokune tasir. Dosya yoksa null.
 */
export function relocateStoredProjectFile(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const raw = stored.trim();
  if (fs.existsSync(raw) && isInsideProjectsRoot(raw)) return path.resolve(raw);

  const norm = raw.replace(/\\/g, "/");
  const match = /\/projects\//i.exec(norm);
  if (match) {
    const rel = norm.slice(match.index + match[0].length).replace(/^\/+/, "");
    const parts = rel.split("/").filter(Boolean);
    if (parts.length > 0 && !parts.includes("..")) {
      const next = path.resolve(PROJECTS_ROOT, ...parts);
      if (isInsideProjectsRoot(next) && fs.existsSync(next)) return next;
    }
  }

  if (fs.existsSync(raw)) return path.resolve(raw);
  return null;
}

/** Proje klasor iskeletini olusturur ve kok yolu dondurur. */
export function ensureProjectDirs(slug: string): string {
  const root = safeProjectPath(slug);
  const dirs = [
    root,
    path.join(root, "story"),
    path.join(root, "character"),
    path.join(root, "prompts"),
    path.join(root, "clips"),
    path.join(root, "frames"),
    path.join(root, "screenshots"),
    path.join(root, "logs"),
    path.join(root, "output"),
    path.join(root, "output", "publish"),
    path.join(root, "song"),
    path.join(root, "longform"),
    path.join(root, "longform", "stills"),
    path.join(root, "longform", "segments"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  return root;
}

/** Ayni ada sahip dosyanin uzerine yazmamak icin bos bir yol bulur: name.ext, name-2.ext ... */
export function nextAvailablePath(desiredPath: string): string {
  if (!fs.existsSync(desiredPath)) return desiredPath;
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const base = path.basename(desiredPath, ext);
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Uygun dosya adi bulunamadi: ${desiredPath}`);
}

/**
 * Klip dosya adi: index + clipId — oncesine sahne eklenince 001.mp4 ezilmesini onler.
 * Ornek: 001-a1b2c3d4e5.mp4
 * Geriye uyum: clipFileName(7, ".png") -> 007.png
 */
export function clipFileName(index: number, clipIdOrExt?: string, ext = ".mp4"): string {
  const pad = String(Math.max(1, index)).padStart(3, "0");
  // Eski imza: ikinci arguman uzanti (.mp4 / .png)
  if (clipIdOrExt && /^\.\w+$/.test(clipIdOrExt)) {
    return `${pad}${clipIdOrExt}`;
  }
  if (clipIdOrExt?.trim()) {
    const idPart = clipIdOrExt.replace(/[^a-zA-Z0-9]/g, "").slice(-10) || "clip";
    return `${pad}-${idPart}${ext}`;
  }
  return `${pad}${ext}`;
}

/** Son kare / sahne gorseli adi (index+id — carpismasiz). */
export function clipFrameFileName(index: number, clipId: string, kind: "last" | "scene" = "last"): string {
  const pad = String(Math.max(1, index)).padStart(3, "0");
  const idPart = clipId.replace(/[^a-zA-Z0-9]/g, "").slice(-10) || "clip";
  return `${pad}-${idPart}-${kind}.png`;
}

/**
 * Medya dosyasini yeni yola tasir (uzerine yazmaz). Basarisizsa eski yolu dondurur.
 */
export function relocateMediaFile(fromPath: string | null | undefined, toPath: string): string | null {
  if (!fromPath || !fs.existsSync(fromPath)) return null;
  if (path.resolve(fromPath) === path.resolve(toPath)) return fromPath;
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  const dest = fs.existsSync(toPath) ? nextAvailablePath(toPath) : toPath;
  try {
    fs.renameSync(fromPath, dest);
    return dest;
  } catch {
    try {
      fs.copyFileSync(fromPath, dest);
      return dest;
    } catch {
      return fromPath;
    }
  }
}

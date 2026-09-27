"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CheckSquare,
  Copy,
  Download,
  FileText,
  Globe,
  Image as ImageIcon,
  Megaphone,
  MessageSquare,
  Save,
  Sparkles,
  Hash,
  Target,
  Clapperboard,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { api, mediaUrl, postJson, putJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { templateLabelShort } from "@/lib/templates";
import { canonicalizeSpeechLanguage, languageLabel, languageTagFor } from "@/lib/tts-catalog";
import type { ProjectData } from "@/components/project/types";

interface PublishMeta {
  titleVariants: string[];
  primaryTitle?: string;
  description: string;
  tags: string[];
  hashtags?: string[];
  seoKeywords?: { primary: string; secondary: string[] };
  targetAudience?: string;
  thumbnailPrompt: string;
  thumbnailText?: string;
  thumbnailConcepts?: Array<{ name: string; emotion: string; hook: string; prompt: string }>;
  chapters: Array<{ time: string; label: string; beat?: string }>;
  pinnedComment?: string;
  communityPost?: string;
  shortsHooks?: string[];
  endScreenCta?: string;
  postingStrategy?: string;
  uploadChecklist?: string[];
  kidsSafetyNotes?: string;
  contentWarnings?: string[];
  seriesHook?: string;
  modelUsed?: string;
  reasoningEffort?: string;
  generatedAt?: string;
}

interface PublishPackage {
  meta: PublishMeta | null;
  thumbnails: Array<{ path: string; createdAt: string }>;
  srtPath: string | null;
  subtitleFiles?: Array<{ code: string; name: string; youtube: string; path: string; downloadName: string }>;
  metaJsonPath: string | null;
  metaTxtPath: string | null;
}

interface VariantInfo {
  variant: string;
  clipCount: number;
  completedCount: number;
}

interface PresetInfo {
  id: string;
  name: string;
  templateType: string;
}

function CopyBlock({ label, text, mono }: { label: string; text: string; mono?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <Label>{label}</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigator.clipboard.writeText(text).then(() => toast.success(`${label} kopyalandi`))}
        >
          <Copy className="h-3 w-3" /> Kopyala
        </Button>
      </div>
      <pre
        className={`rounded-[10px] border border-border bg-surface-2 p-3 text-[11px] whitespace-pre-wrap max-h-56 overflow-y-auto ${
          mono ? "font-mono" : ""
        }`}
      >
        {text}
      </pre>
    </div>
  );
}

function youtubeFullPackage(meta: PublishMeta): string {
  const chapters = meta.chapters.map((c) => `${c.time} ${c.label}`).join("\n");
  return [
    meta.primaryTitle || meta.titleVariants[0] || "",
    "",
    meta.description,
    "",
    chapters ? `Bolumler:\n${chapters}` : "",
    "",
    meta.hashtags?.join(" ") || "",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();
}

export function PublishTab({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const [meta, setMeta] = React.useState<PublishMeta | null>(null);
  const [thumbnails, setThumbnails] = React.useState<Array<{ path: string; createdAt: string }>>([]);
  const [metaJsonPath, setMetaJsonPath] = React.useState<string | null>(null);
  const [metaTxtPath, setMetaTxtPath] = React.useState<string | null>(null);
  const [selectedThumb, setSelectedThumb] = React.useState<string | null>(null);
  const [variants, setVariants] = React.useState<VariantInfo[]>([]);
  const [presets, setPresets] = React.useState<PresetInfo[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = React.useState("");
  const [presetName, setPresetName] = React.useState(project.channelName || project.name);
  const [editing, setEditing] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState("");
  const [draftDescription, setDraftDescription] = React.useState("");
  const [draftTags, setDraftTags] = React.useState("");
  const [draftPinned, setDraftPinned] = React.useState("");
  const [overlayText, setOverlayText] = React.useState("");

  const applyPackage = React.useCallback((pkg: PublishPackage) => {
    setMeta(pkg.meta);
    setThumbnails(pkg.thumbnails || []);
    setMetaJsonPath(pkg.metaJsonPath);
    setMetaTxtPath(pkg.metaTxtPath);
    const latest = pkg.thumbnails?.[0]?.path ?? null;
    setSelectedThumb((prev) => prev || latest);
    if (pkg.meta) {
      setDraftTitle(pkg.meta.primaryTitle || "");
      setDraftDescription(pkg.meta.description || "");
      setDraftTags((pkg.meta.tags || []).join(", "));
      setDraftPinned(pkg.meta.pinnedComment || "");
      setOverlayText(pkg.meta.thumbnailText || "");
    }
  }, []);

  const loadExtras = React.useCallback(() => {
    api<VariantInfo[]>(`/api/projects/${project.id}/variants`, { silent: true }).then(setVariants).catch(() => {});
    api<PresetInfo[]>("/api/presets", { silent: true }).then(setPresets).catch(() => {});
    api<PublishPackage>(`/api/projects/${project.id}/publish/metadata`, { silent: true })
      .then(applyPackage)
      .catch(() => {});
  }, [project.id, applyPackage]);

  React.useEffect(() => {
    loadExtras();
  }, [loadExtras]);

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} kopyalandi`));
  }

  const completedCount = project.clips.filter((c) => c.status === "completed").length;
  const isKids = false;
  const previewThumb = selectedThumb || thumbnails[0]?.path || null;
  const coverLanguage = canonicalizeSpeechLanguage(project.speechLanguage || project.storyLanguage);
  const coverLanguageLabel = languageLabel(languageTagFor(coverLanguage) || "tr");
  const coverPlaceholder =
    coverLanguage === "German"
      ? "Suite 908 — auf seinem Handy"
      : coverLanguage === "English"
        ? "It was on his phone"
        : coverLanguage === "French"
          ? "C'était sur son téléphone"
          : coverLanguage === "Spanish"
            ? "Estaba en su teléfono"
            : "Telefonda o isim vardı";

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary-soft/20">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-[13px] font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Yayin Planlayici
            </div>
            <p className="text-[11px] text-muted leading-relaxed max-w-2xl">
              Baslik ve aciklama <strong>bu filmin kurulumu</strong>ndan gelir — slash SEO yigini yok. Aciklama
              kisa tutulur, spoiler yok; izleyici videoya cekilir. Kapak{" "}
              <strong>videodaki gercek kadro karesi</strong> + film dilinde oto yazidir.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              onClick={() =>
                run("meta", async () => {
                  const result = await postJson<{ meta: PublishMeta; thumbnailPath: string | null }>(
                    `/api/projects/${project.id}/publish/metadata`,
                    { autoThumbnail: true }
                  );
                  setMeta(result.meta);
                  setDraftTitle(result.meta.primaryTitle || "");
                  setDraftDescription(result.meta.description || "");
                  setDraftTags((result.meta.tags || []).join(", "));
                  setDraftPinned(result.meta.pinnedComment || "");
                  setOverlayText(result.meta.thumbnailText || "");
                  if (result.thumbnailPath) {
                    setThumbnails((prev) => [{ path: result.thumbnailPath!, createdAt: new Date().toISOString() }, ...prev]);
                    setSelectedThumb(result.thumbnailPath);
                  }
                  loadExtras();
                  toast.success(
                    result.thumbnailPath
                      ? `Plan + video kapagi hazir (${result.meta.modelUsed || "AI"})`
                      : `Plan hazir (${result.meta.modelUsed || "AI"}) — videodan kapak sonra secilebilir`
                  );
                })
              }
              loading={busy === "meta"}
            >
              <Megaphone className="h-4 w-4" /> Tam Paket (Plan + Thumbnail)
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                run("meta-only", async () => {
                  const result = await postJson<{ meta: PublishMeta; thumbnailPath: string | null }>(
                    `/api/projects/${project.id}/publish/metadata`,
                    { autoThumbnail: false }
                  );
                  setMeta(result.meta);
                  setDraftTitle(result.meta.primaryTitle || "");
                  setDraftDescription(result.meta.description || "");
                  setDraftTags((result.meta.tags || []).join(", "));
                  setDraftPinned(result.meta.pinnedComment || "");
                  setOverlayText(result.meta.thumbnailText || "");
                  toast.success("Yayin plani uretildi (thumbnail yok)");
                })
              }
              loading={busy === "meta-only"}
            >
              Sadece Plan
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" />
              <CardTitle>Thumbnail</CardTitle>
            </div>
            <CardDescription>
              Videodan gercek kadro karesi + flaş / sok kapak yazisi (film dilinde oto)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Kapak yazisi ({coverLanguageLabel})</Label>
              <Input
                className="mt-1"
                placeholder={`Ornek: ${coverPlaceholder}`}
                value={overlayText}
                onChange={(e) => setOverlayText(e.target.value)}
              />
              <p className="text-[10px] text-muted-2 mt-1">
                Bos birakirsan filmden flaş baslik yazilir — resmi gorunce “neymis bu?” densin. 5–9 kelime, 2
                satir; spoiler yok. 3 varyant: 3 farkli kare + 3 farkli sok yazi.
              </p>
            </div>
            <Button
              onClick={() =>
                run("thumb-variants", async () => {
                  const result = await postJson<{
                    variants: Array<{ path: string; label: string; overlayText?: string }>;
                    overlayText?: string;
                  }>(`/api/projects/${project.id}/publish/thumbnail-variants`, {});
                  setThumbnails((prev) => [
                    ...result.variants.map((v) => ({ path: v.path, createdAt: new Date().toISOString() })),
                    ...prev,
                  ]);
                  if (result.variants[0]) setSelectedThumb(result.variants[0].path);
                  const autoText = result.overlayText || result.variants[0]?.overlayText;
                  if (autoText) setOverlayText(autoText);
                  toast.success(`${result.variants.length} kapak varyanti hazir — asagidan secin`);
                })
              }
              loading={busy === "thumb-variants"}
              className="w-full"
            >
              <ImageIcon className="h-4 w-4" /> 3 Varyant Uret (kare + kapak yazisi)
            </Button>
            <Button
              onClick={() =>
                run("thumb", async () => {
                  const result = await postJson<{
                    path: string;
                    clipIndex?: number;
                    reason?: string;
                    overlayText?: string;
                  }>(`/api/projects/${project.id}/publish/thumbnail`, {
                    source: "video",
                    withText: true,
                    overlayText: overlayText.trim() || undefined,
                  });
                  setThumbnails((prev) => [{ path: result.path, createdAt: new Date().toISOString() }, ...prev]);
                  setSelectedThumb(result.path);
                  if (result.overlayText) setOverlayText(result.overlayText);
                  toast.success(
                    result.overlayText
                      ? `Kapak: #${result.clipIndex ?? "?"} — "${result.overlayText}"`
                      : result.clipIndex
                        ? `Kapak secildi: sahne #${result.clipIndex}`
                        : "Videodan thumbnail secildi"
                  );
                })
              }
              loading={busy === "thumb"}
              variant="secondary"
              className="w-full"
              disabled={completedCount === 0}
            >
              <ImageIcon className="h-4 w-4" /> Videodan Kare + Yazi Sec
            </Button>
            <Button
              onClick={() =>
                run("thumb-ai", async () => {
                  const result = await postJson<{ path: string }>(`/api/projects/${project.id}/publish/thumbnail`, {
                    source: "ai",
                  });
                  setThumbnails((prev) => [{ path: result.path, createdAt: new Date().toISOString() }, ...prev]);
                  setSelectedThumb(result.path);
                  toast.success("AI thumbnail uretildi");
                })
              }
              loading={busy === "thumb-ai"}
              variant="outline"
              className="w-full"
              disabled={!meta?.thumbnailPrompt}
            >
              AI ile Uret (yedek)
            </Button>
            {completedCount === 0 && (
              <p className="text-[10px] text-muted-2">Videodan kapak icin once tamamlanmis klip gerekir.</p>
            )}
            {!meta?.thumbnailPrompt && completedCount === 0 && (
              <p className="text-[10px] text-muted-2">AI yedek icin once yayin planini uretin.</p>
            )}
            {previewThumb && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={mediaUrl(previewThumb)}
                alt="Thumbnail"
                className="w-full rounded-[10px] border border-border"
              />
            )}
            {thumbnails.length > 1 && (
              <div className="grid grid-cols-4 gap-1.5">
                {thumbnails.map((t) => (
                  <button
                    key={t.path}
                    type="button"
                    onClick={() => setSelectedThumb(t.path)}
                    className={`rounded-[8px] overflow-hidden border ${
                      selectedThumb === t.path ? "border-primary ring-1 ring-primary" : "border-border"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(t.path)} alt="" className="w-full aspect-video object-cover" />
                  </button>
                ))}
              </div>
            )}
            {meta?.thumbnailPrompt && (
              <CopyBlock label="Birincil thumbnail prompt (EN)" text={meta.thumbnailPrompt} mono />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              <CardTitle>YouTube listeleme</CardTitle>
            </div>
            <CardDescription>
              Baslik · aciklama · etiket — bu hikaye + {coverLanguageLabel} arama niyeti
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted leading-relaxed">
              Ilk 40 karakterde bu filmin konu kelimesi, aciklamada ilk 150 karakter izleme nedeni, 8–15
              kisa etiket. Hikayeyle ayni evren; slash yigini / jenerik “youtube / video / yeni” yok; spoiler
              yok.
            </p>
            <Button
              onClick={() =>
                run("listing", async () => {
                  const result = await postJson<{ meta: PublishMeta; thumbnailPath: string | null }>(
                    `/api/projects/${project.id}/publish/metadata`,
                    { autoThumbnail: false }
                  );
                  setMeta(result.meta);
                  setDraftTitle(result.meta.primaryTitle || "");
                  setDraftDescription(result.meta.description || "");
                  setDraftTags((result.meta.tags || []).join(", "));
                  setDraftPinned(result.meta.pinnedComment || "");
                  setOverlayText(result.meta.thumbnailText || overlayText);
                  toast.success(`Listeleme hazir (${result.meta.modelUsed || "AI"})`);
                })
              }
              loading={busy === "listing"}
              className="w-full"
            >
              <Megaphone className="h-4 w-4" /> Baslik + aciklama + etiket uret
            </Button>
            {meta ? (
              <>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Label>Baslik</Label>
                    <span
                      className={`text-[10px] ${
                        (meta.primaryTitle || "").length >= 50 && (meta.primaryTitle || "").length <= 70
                          ? "text-success"
                          : "text-muted-2"
                      }`}
                    >
                      {(meta.primaryTitle || "").length} / 70
                    </span>
                  </div>
                  <p className="text-[13px] font-semibold mt-1 leading-snug">{meta.primaryTitle}</p>
                </div>
                <div>
                  <Label>Aciklama</Label>
                  <p className="text-[11px] text-muted mt-1 whitespace-pre-wrap leading-relaxed line-clamp-6">
                    {meta.description}
                  </p>
                </div>
                {meta.seoKeywords?.primary && (
                  <div>
                    <Label>Ana arama</Label>
                    <p className="text-[11px] mt-1">{meta.seoKeywords.primary}</p>
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Hash className="h-3 w-3 text-muted-2" />
                    <Label>Etiketler ({meta.tags.length})</Label>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {meta.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                </div>
                {meta.hashtags && meta.hashtags.length > 0 && (
                  <p className="text-[11px] text-muted">{meta.hashtags.join(" ")}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyText(meta.primaryTitle || "", "Baslik")}
                  >
                    <Copy className="h-3 w-3" /> Baslik
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copyText(meta.description || "", "Aciklama")}>
                    <Copy className="h-3 w-3" /> Aciklama
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => copyText(meta.tags.join(", "), "Etiketler")}>
                    <Copy className="h-3 w-3" /> Etiket
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyText(youtubeFullPackage(meta), "YouTube paketi")}
                  >
                    <Copy className="h-3 w-3" /> Paket
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-[10px] text-muted-2">
                Konu: {project.topic?.trim() || project.title || "henuz yazilmamis"} — uretince film dilinde
                listeleme gelir.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <CardTitle>Dosyalar</CardTitle>
            </div>
            <CardDescription>output/publish — JSON + TXT</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-muted leading-relaxed">
              Plan kaydedilir; model bilgisi meta dosyasinda tutulur.
              {meta?.modelUsed ? (
                <>
                  {" "}
                  Son plan: <Badge variant="info">{meta.modelUsed}</Badge>{" "}
                  <Badge variant="primary">{meta.reasoningEffort || "high"}</Badge>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {metaJsonPath && (
                <a href={mediaUrl(metaJsonPath)} download>
                  <Button variant="outline" size="sm">
                    <Download className="h-3 w-3" /> JSON
                  </Button>
                </a>
              )}
              {metaTxtPath && (
                <a href={mediaUrl(metaTxtPath)} download>
                  <Button variant="outline" size="sm">
                    <Download className="h-3 w-3" /> TXT
                  </Button>
                </a>
              )}
              {meta && (
                <Button variant="outline" size="sm" onClick={() => copyText(youtubeFullPackage(meta), "YouTube paketi")}>
                  <Copy className="h-3 w-3" /> Baslik+Aciklama
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {meta && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle>Baslik &amp; Aciklama</CardTitle>
                <div className="flex gap-1.5 flex-wrap">
                  {meta.modelUsed && <Badge variant="info">{meta.modelUsed}</Badge>}
                  {meta.reasoningEffort && <Badge variant="primary">reasoning: {meta.reasoningEffort}</Badge>}
                  <Button
                    variant={editing ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => {
                      if (!editing) {
                        setDraftTitle(meta.primaryTitle || "");
                        setDraftDescription(meta.description || "");
                        setDraftTags((meta.tags || []).join(", "));
                        setDraftPinned(meta.pinnedComment || "");
                      }
                      setEditing((v) => !v);
                    }}
                  >
                    <Pencil className="h-3 w-3" /> {editing ? "Iptal" : "Duzenle"}
                  </Button>
                  {editing && (
                    <Button
                      size="sm"
                      loading={busy === "save"}
                      onClick={() =>
                        run("save", async () => {
                          const result = await putJson<{ meta: PublishMeta }>(
                            `/api/projects/${project.id}/publish/metadata`,
                            {
                              primaryTitle: draftTitle,
                              description: draftDescription,
                              tags: draftTags
                                .split(",")
                                .map((t) => t.trim())
                                .filter(Boolean),
                              pinnedComment: draftPinned,
                            }
                          );
                          setMeta(result.meta);
                          setEditing(false);
                          toast.success("Yayin metinleri kaydedildi");
                        })
                      }
                    >
                      <Save className="h-3 w-3" /> Kaydet
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-3">
                {editing ? (
                  <div>
                    <Label>Birincil baslik</Label>
                    <Input className="mt-1" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
                  </div>
                ) : (
                  <div className="rounded-[10px] border border-border bg-surface-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Label>Birincil baslik</Label>
                        <p className="text-[14px] font-semibold mt-1 leading-snug">{meta.primaryTitle}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => copyText(meta.primaryTitle || "", "Baslik")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                <div>
                  <Label>Baslik varyantlari</Label>
                  <div className="space-y-1.5 mt-1">
                    {meta.titleVariants.map((title, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-2 px-3 py-2"
                      >
                        <span className="text-[10px] text-muted-2 w-4">{i + 1}</span>
                        <span className="text-xs flex-1">{title}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => {
                            copyText(title, "Baslik");
                            if (editing) setDraftTitle(title);
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {meta.seoKeywords && (
                  <div>
                    <Label>SEO anahtar kelimeler</Label>
                    <p className="text-xs mt-1">
                      <span className="font-medium">Ana:</span> {meta.seoKeywords.primary}
                    </p>
                    <div className="flex gap-1 flex-wrap mt-1">
                      {meta.seoKeywords.secondary.map((k) => (
                        <Badge key={k}>{k}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {meta.targetAudience && (
                  <div className="flex gap-2 items-start">
                    <Target className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    <p className="text-[11px] text-muted leading-relaxed">{meta.targetAudience}</p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {editing ? (
                  <>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <Label>Aciklama</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          loading={busy === "desc-refresh"}
                          onClick={() =>
                            run("desc-refresh", async () => {
                              const result = await postJson<{ meta: PublishMeta }>(
                                `/api/projects/${project.id}/publish/description`
                              );
                              setMeta(result.meta);
                              setDraftDescription(result.meta.description || "");
                              toast.success(`Aciklama yenilendi (${result.meta.modelUsed || "gpt-5"})`);
                            })
                          }
                        >
                          <RefreshCw className="h-3 w-3" /> Yenile
                        </Button>
                      </div>
                      <Textarea
                        className="mt-1 min-h-[120px] text-[12px]"
                        value={draftDescription}
                        onChange={(e) => setDraftDescription(e.target.value)}
                      />
                      <p className="text-[10px] text-muted-2 mt-1">
                        Yenile = GPT-5 ile kisa merak metni (spoiler yok).
                      </p>
                    </div>
                    <div>
                      <Label>Etiketler (virgulle)</Label>
                      <Textarea
                        className="mt-1 min-h-[72px] text-[12px]"
                        value={draftTags}
                        onChange={(e) => setDraftTags(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <Label>Aciklama</Label>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            loading={busy === "desc-refresh"}
                            onClick={() =>
                              run("desc-refresh", async () => {
                                const result = await postJson<{ meta: PublishMeta }>(
                                  `/api/projects/${project.id}/publish/description`
                                );
                                setMeta(result.meta);
                                setDraftDescription(result.meta.description || "");
                                toast.success(`Aciklama yenilendi (${result.meta.modelUsed || "gpt-5"})`);
                              })
                            }
                          >
                            <RefreshCw className="h-3 w-3" /> Yenile
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyText(meta.description || "", "Aciklama")}
                          >
                            <Copy className="h-3 w-3" /> Kopyala
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-[10px] border border-border bg-surface-2 p-3">
                        <p className="text-[12px] whitespace-pre-wrap leading-relaxed">{meta.description}</p>
                      </div>
                      <p className="text-[10px] text-muted-2 mt-1">
                        Yenile: GPT-5 kisa merak metni yazar; uzun makale otomatik kesilir.
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <Label>Etiketler ({meta.tags.length})</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyText(meta.tags.join(", "), "Etiketler")}
                        >
                          <Copy className="h-3 w-3" /> Kopyala
                        </Button>
                      </div>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {meta.tags.map((tag) => (
                          <Badge key={tag}>{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {meta.hashtags && meta.hashtags.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between">
                      <Label>Hashtagler</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyText(meta.hashtags!.join(" "), "Hashtag")}
                      >
                        <Copy className="h-3 w-3" /> Kopyala
                      </Button>
                    </div>
                    <p className="text-xs text-muted mt-1">{meta.hashtags.join(" ")}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Bolumler (chapters)</CardTitle>
                <CardDescription>Zamanlar klip timeline&apos;ina oturtuldu</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="rounded-[10px] border border-border bg-surface-2 p-3 text-[11px] whitespace-pre-wrap">
                  {meta.chapters.map((c) => `${c.time} ${c.label}${c.beat ? `  · ${c.beat}` : ""}`).join("\n")}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    copyText(meta.chapters.map((c) => `${c.time} ${c.label}`).join("\n"), "Bolumler")
                  }
                >
                  <Copy className="h-3 w-3" /> YouTube formatinda kopyala
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-primary" />
                  <CardTitle>Yukleme Checklist</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-[12px]">
                  {(meta.uploadChecklist || []).map((item, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-2">{i + 1}.</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                {meta.postingStrategy && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <Label>Yayin stratejisi</Label>
                    <p className="text-[11px] text-muted mt-1 leading-relaxed">{meta.postingStrategy}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {meta.pinnedComment && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    <CardTitle>Sabit Yorum</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {editing ? (
                    <Textarea
                      className="min-h-[100px] text-[12px]"
                      value={draftPinned}
                      onChange={(e) => setDraftPinned(e.target.value)}
                    />
                  ) : (
                    <CopyBlock label="Pinned comment" text={meta.pinnedComment} />
                  )}
                </CardContent>
              </Card>
            )}
            {meta.communityPost && (
              <Card>
                <CardHeader>
                  <CardTitle>Community Post</CardTitle>
                </CardHeader>
                <CardContent>
                  <CopyBlock label="Community" text={meta.communityPost} />
                </CardContent>
              </Card>
            )}
          </div>

          {(meta.shortsHooks?.length || meta.endScreenCta || meta.seriesHook) && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clapperboard className="h-4 w-4 text-primary" />
                  <CardTitle>Shorts / CTA / Seri</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {meta.shortsHooks && meta.shortsHooks.length > 0 && (
                  <div>
                    <Label>Shorts kancalari</Label>
                    <ol className="mt-1 space-y-1 text-[11px] list-decimal list-inside">
                      {meta.shortsHooks.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {meta.endScreenCta && (
                  <div>
                    <Label>End screen CTA</Label>
                    <p className="text-[11px] text-muted mt-1 leading-relaxed">{meta.endScreenCta}</p>
                  </div>
                )}
                {meta.seriesHook && (
                  <div>
                    <Label>Seri kancasi</Label>
                    <p className="text-[11px] text-muted mt-1 leading-relaxed">{meta.seriesHook}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {meta.thumbnailConcepts && meta.thumbnailConcepts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Thumbnail Konseptleri</CardTitle>
                <CardDescription>Her konsept ayri uretilir; galeriye eklenir</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {meta.thumbnailConcepts.map((c) => (
                  <div key={c.name} className="rounded-[12px] border border-border bg-surface-2 p-3 space-y-2">
                    <div className="text-[13px] font-semibold">{c.name}</div>
                    <div className="flex gap-1 flex-wrap">
                      <Badge variant="info">{c.emotion}</Badge>
                    </div>
                    <p className="text-[11px] text-muted">{c.hook}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      loading={busy === `thumb-${c.name}`}
                      onClick={() =>
                        run(`thumb-${c.name}`, async () => {
                          const result = await postJson<{ path: string }>(
                            `/api/projects/${project.id}/publish/thumbnail`,
                            { source: "ai", customPrompt: c.prompt }
                          );
                          setThumbnails((prev) => [
                            { path: result.path, createdAt: new Date().toISOString() },
                            ...prev,
                          ]);
                          setSelectedThumb(result.path);
                          toast.success(`Thumbnail: ${c.name}`);
                        })
                      }
                    >
                      <ImageIcon className="h-3.5 w-3.5" /> Bu Konsepti Uret
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {isKids && meta.kidsSafetyNotes && (
            <Card className="border-success/30">
              <CardHeader>
                <CardTitle>Cocuk Guvenligi Notlari</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[12px] leading-relaxed">{meta.kidsSafetyNotes}</p>
                {meta.contentWarnings && meta.contentWarnings.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    {meta.contentWarnings.map((w) => (
                      <Badge key={w} variant="warning">
                        {w}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <CardTitle>Coklu Dil Varyantlari</CardTitle>
            </div>
            <CardDescription>Ayni klip setinden hedef dilde diyaloglar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Hedef dil (or. English, Deutsch)"
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
              />
              <Button
                onClick={() =>
                  run("variant", async () => {
                    if (!targetLanguage.trim()) {
                      toast.error("Hedef dil girin");
                      return;
                    }
                    const result = await postJson<{ variant: string; clipCount: number }>(
                      `/api/projects/${project.id}/variants`,
                      { targetLanguage: targetLanguage.trim() }
                    );
                    toast.success(`"${result.variant}" varyanti hazir (${result.clipCount} klip)`);
                    setTargetLanguage("");
                    loadExtras();
                    await reload();
                  })
                }
                loading={busy === "variant"}
              >
                Olustur
              </Button>
            </div>
            {variants.length > 0 && (
              <div className="space-y-1.5">
                {variants.map((variant) => (
                  <div
                    key={variant.variant}
                    className="flex items-center justify-between rounded-[8px] border border-border bg-surface-2 px-3 py-2"
                  >
                    <span className="text-xs font-medium">
                      {variant.variant === "primary" ? "Ana dil" : variant.variant}
                    </span>
                    <Badge variant={variant.completedCount === variant.clipCount ? "success" : "default"}>
                      {variant.completedCount}/{variant.clipCount} klip
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Save className="h-4 w-4 text-primary" />
              <CardTitle>Kanal On Ayarlari</CardTitle>
            </div>
            <CardDescription>Karakter + stil + ayar kombinasyonu</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="On ayar adi" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <Button
                onClick={() =>
                  run("preset", async () => {
                    if (!presetName.trim()) {
                      toast.error("On ayar adi girin");
                      return;
                    }
                    await postJson("/api/presets", {
                      mode: "from_project",
                      projectId: project.id,
                      name: presetName.trim(),
                    });
                    toast.success("On ayar kaydedildi");
                    loadExtras();
                  })
                }
                loading={busy === "preset"}
              >
                Kaydet
              </Button>
            </div>
            {presets.length > 0 && (
              <div className="space-y-1.5">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center justify-between rounded-[8px] border border-border bg-surface-2 px-3 py-2"
                  >
                    <div>
                      <span className="text-xs font-medium">{preset.name}</span>
                      <span className="text-[10px] text-muted-2 ml-2">
                        {templateLabelShort(preset.templateType)}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          run(`apply-${preset.id}`, async () => {
                            await postJson(`/api/presets/${preset.id}`, { projectId: project.id });
                            toast.success(`"${preset.name}" bu projeye uygulandi`);
                            await reload();
                          })
                        }
                        loading={busy === `apply-${preset.id}`}
                      >
                        Uygula
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          run(`export-${preset.id}`, async () => {
                            const full = await api<{ payload: string }>(`/api/presets/${preset.id}`);
                            copyText(full.payload, "On ayar JSON");
                          })
                        }
                      >
                        JSON
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

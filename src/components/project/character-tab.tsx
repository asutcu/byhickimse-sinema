"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Clapperboard, ImagePlus, RefreshCw, Save, Sparkles, Upload, User } from "lucide-react";
import { api, mediaUrl, patchJson, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { CharacterData, ProjectData } from "@/components/project/types";
import { CastCard } from "@/components/project/cast-card";
import { CharacterStyleCloset } from "@/components/project/character-style-closet";
import { resolveFlowImageModel } from "@/lib/flow-generation-settings";

const FIELDS: Array<{ key: keyof CharacterData; label: string; placeholder?: string }> = [
  { key: "name", label: "Karakter adi", placeholder: "Lena" },
  { key: "nationalityLook", label: "Milliyet / gorunum", placeholder: "German" },
  { key: "hair", label: "Sac", placeholder: "long blonde hair" },
  { key: "faceFeatures", label: "Yuz ozellikleri" },
  { key: "makeup", label: "Makyaj" },
  { key: "wardrobe", label: "Kiyafet" },
  { key: "bodyFraming", label: "Vucut kadraji" },
  { key: "sittingPose", label: "Oturma sekli" },
  { key: "gestureLevel", label: "Jest seviyesi" },
  { key: "voiceCharacter", label: "Ses karakteri" },
  { key: "emotionTone", label: "Duygu tonu" },
  { key: "environment", label: "Ortam" },
  { key: "lighting", label: "Isik" },
  { key: "cameraAngle", label: "Kamera acisi" },
  { key: "lensLook", label: "Lens gorunumu" },
  { key: "background", label: "Arka plan" },
  { key: "flowCharacterReference", label: "Flow karakter referansi (@ad)", placeholder: "@Lena" },
];

export function CharacterTab({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const [character, setCharacter] = React.useState<CharacterData | null>(
    project.characters.find((c) => c.role === "main") ?? null
  );
  const [form, setForm] = React.useState<Record<string, string | number>>({});
  const [noteDraft, setNoteDraft] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [imagePromptDraft, setImagePromptDraft] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const busyRef = React.useRef(false);

  const loadCharacter = React.useCallback(async () => {
    const data = await api<{ main: CharacterData; sides: CharacterData[] }>(`/api/projects/${project.id}/character`, { silent: true });
    setCharacter(data.main);
    setImagePromptDraft(data.main.imagePrompt);
  }, [project.id]);

  React.useEffect(() => {
    loadCharacter().catch(() => {});
  }, [loadCharacter]);

  React.useEffect(() => {
    if (character) {
      const initial: Record<string, string | number> = {};
      for (const field of FIELDS) initial[field.key] = (character[field.key] as string) ?? "";
      initial.age = character.age;
      initial.negativePrompt = character.negativePrompt;
      setForm(initial);
      setNoteDraft(character.storyNote || "");
    }
  }, [character]);

  if (!character) return null;

  const isNarrator = project.templateType === "narrator";
  const isKidsAnim = false;
  const isTimeTravelProject = project.templateType === "time_travel";
  const dirty = isNarrator
    ? noteDraft.trim() !== (character.storyNote || "").trim()
    : FIELDS.some((f) => form[f.key] !== undefined && form[f.key] !== (character[f.key] as string)) ||
      (form.age !== undefined && form.age !== character.age) ||
      (form.negativePrompt !== undefined && form.negativePrompt !== character.negativePrompt);

  async function save() {
    setBusy("save");
    try {
      if (isNarrator) {
        if (!noteDraft.trim()) {
          toast.error("Once karakter notunu yazin");
          return;
        }
        await patchJson(`/api/projects/${project.id}/character`, { storyNote: noteDraft.trim() });
        await loadCharacter();
        await reload();
        toast.success("Not kilide islendi — sahneler bu tarifi kullanir");
        return;
      }
      const age = Number(form.age) || 20;
      if (age < 18) {
        toast.error("Karakter yasi 18'in altina ayarlanamaz");
        return;
      }
      await patchJson(`/api/projects/${project.id}/character`, { ...form, age });
      await loadCharacter();
      await reload();
      toast.success("Karakter profili ve Karakter Kilidi guncellendi");
    } finally {
      setBusy(null);
    }
  }

  async function uploadImage(file: File) {
    setBusy("upload");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/projects/${project.id}/upload-character`, { method: "POST", body: formData });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!result.ok) throw new Error(result.error ?? "Yukleme basarisiz");
      await loadCharacter();
      toast.success("Referans gorseli yuklendi ve onaylandi");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Yukleme basarisiz");
    } finally {
      setBusy(null);
    }
  }

  async function generateImage() {
    if (busyRef.current) return;
    if (isNarrator && !noteDraft.trim()) {
      toast.error("Once ortadaki karakter notunu yazin");
      return;
    }
    busyRef.current = true;
    setBusy("generate-flow");
    toast.message("Flow açılıyor…");
    try {
      await postJson(`/api/projects/${project.id}/generate-character`, {
        ...(imagePromptDraft.trim() ? { customPrompt: imagePromptDraft } : {}),
        ...(isNarrator && noteDraft.trim() ? { notes: noteDraft.trim() } : {}),
      });
      await loadCharacter();
      toast.success("Gorsel uretildi — onaylamadan otomasyon baslamaz");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    try {
      await postJson(`/api/projects/${project.id}/character`);
      await loadCharacter();
      toast.success("Gorsel onaylandi");
    } finally {
      setBusy(null);
    }
  }

  // Bu sekmede IKI ayri gorsel turu var; hangisinin nerede kullanildigi
  // acikca yazilmazsa karisiyor. Sayilar da o yuzden gosteriliyor.
  const mainRoleLabel = isNarrator ? "Anlatici" : "Ana Karakter";
  const cutawayClipCount = project.clips.filter((c) => c.shotType === "cutaway").length;
  const sideCastCount = project.characters.filter((c) => c.role === "side").length;

  return (
    <div className="space-y-4">
      {!project.useReference && (
        <Card className="border-warning/40 bg-warning-soft/40">
          <CardContent className="p-3 text-[12px] text-warning leading-relaxed">
            <span className="font-semibold">Referans kullanimi kapali.</span> Proje Ayarlari&apos;ndaki &quot;Referans kullan&quot;
            anahtari kapali oldugu icin buradaki hicbir gorsel Flow&apos;a yuklenmez; klipler yalnizca metin tarifine gore uretilir.
          </CardContent>
        </Card>
      )}

      {isNarrator && (
        <Card>
          <CardContent className="p-3 text-[12px] text-muted leading-relaxed space-y-1">
            <div className="text-[12.5px] font-semibold text-foreground">Film formati — voice-over only</div>
            <div>
              <span className="font-medium text-foreground">1) {mainRoleLabel} sesi:</span> kadin yalnizca dis ses; ekranda
              yok. Anlatici referans gorseli simdilik kapali.
            </div>
            <div>
              <span className="font-medium text-foreground">2) Hikaye kadrosu ({cutawayClipCount} sahne):</span> ekranda
              gorunen kisiler. Asagidaki karttan her kisi icin TEK, net bir kimlik gorseli uretin — cift/on-arka yok.
            </div>
            <div className="text-muted-2">
              Her klip hikayedeki yer, esya, hava ve isigi gosterir. Film plani hikaye bolunurken otomatik yazilir.
            </div>
          </CardContent>
        </Card>
      )}

      {isKidsAnim && (
        <Card>
          <CardContent className="p-3 text-[12px] text-muted leading-relaxed space-y-1">
            <div className="text-[12.5px] font-semibold text-foreground">Sabit kadro — tum sahnelerde ayni yuzler</div>
            <div>
              <span className="font-medium text-foreground">1) Ana kahraman:</span> Flow&apos;a{" "}
              <span className="font-medium text-foreground">ön + arka turnaround sheet</span> olarak yuklenir (
              {project.clips.length} sahne). Asagidaki karttan uretin/yenileyin.
            </div>
            <div>
              <span className="font-medium text-foreground">2) Yan kadro ({sideCastCount}):</span> &quot;Sahneleri Olustur&quot;
              ile hikayeden gelir. Ustteki karttan her biri icin ayni formatta (yalnizca ön+arka) sheet uretin; sonra
              Promptlar sekmesinden promptlari yenileyin.
            </div>
          </CardContent>
        </Card>
      )}

      {isTimeTravelProject && (
        <Card>
          <CardContent className="p-4 text-[12px] text-muted leading-relaxed space-y-1.5">
            <div className="text-[13px] font-bold text-foreground">Zaman Yolcusu kadrosu — her klipte aynı yüzler</div>
            <div>
              <span className="font-semibold text-foreground">1) Sunucu:</span> kameraya konuşan kişi. Ön + arka sheet
              selfie, yerli ve geniş planlarda Flow&apos;a yüklenir.
            </div>
            <div>
              <span className="font-semibold text-foreground">2) Yol arkadaşı ve yerliler:</span> aşağıdaki kadro kartında.
              Hayvanın yan + ön görseli, yerlilerin dönem kıyafetli görseli ayrı üretilir.
            </div>
            <div className="text-muted-2">Görünümü değiştirmek için Proje Ayarları &gt; Zaman Yolcusu kartını kullanın.</div>
          </CardContent>
        </Card>
      )}

      {(isNarrator || isKidsAnim || isTimeTravelProject) && <CastCard project={project} reload={reload} />}

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        {!isNarrator && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle>{mainRoleLabel} Referans Gorseli</CardTitle>
              {character.name && <Badge variant="primary">{character.name}</Badge>}
            </div>
            <CardDescription>
              {isKidsAnim
                  ? "Hikayenin ana kahramani. Referans: tek gorselde ON + ARKA turnaround sheet. Tum sahnelerde bu sheet Flow'a yuklenir."
                  : "Hikayenin ana karakteri. Kliplerde bu gorsel Flow'a referans olarak yuklenir."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {character.referenceImagePath ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaUrl(character.referenceImagePath)}
                  alt="Karakter referansi"
                  className="w-full rounded-[10px] border border-border object-cover"
                />
                <div className="absolute top-2 right-2">
                  {character.imageApproved ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" /> Onayli
                    </Badge>
                  ) : (
                    <Badge variant="warning">Onay bekliyor</Badge>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-44 items-center justify-center rounded-[10px] border border-dashed border-border-strong text-muted-2">
                <User className="h-10 w-10" />
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadImage(file);
                e.target.value = "";
              }}
            />
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()} loading={busy === "upload"}>
                <Upload className="h-4 w-4" /> Kendi Gorselimi Yukle
              </Button>
              <Button variant="outline" onClick={generateImage} loading={busy === "generate-flow"} disabled={busy !== null}>
                <Clapperboard className="h-4 w-4" /> {resolveFlowImageModel(project)} ile Olustur
              </Button>
              <p className="text-[10.5px] text-muted-2 leading-relaxed">
                Sitedeki tum resimler Flow / {resolveFlowImageModel(project)} ile uretilir — video uretilmez. Once Karakterler sayfasi;
                olmazsa editorde Metinden goruntuye. Karakter adiyla kaydedilir ve kliplerde @adiyla cagirilabilir.
                Flow acik olmali, otomasyon durmus olmali.
              </p>
              {character.referenceImagePath && !character.imageApproved && (
                <Button variant="success" onClick={approve} loading={busy === "approve"}>
                  <CheckCircle2 className="h-4 w-4" /> Onayla
                </Button>
              )}
            </div>
            <div>
              <Label>Gorsel uretim promptu (duzenlenebilir)</Label>
              <Textarea
                className="text-[11px] font-mono min-h-[100px]"
                value={imagePromptDraft}
                onChange={(e) => setImagePromptDraft(e.target.value)}
                placeholder="Bos birakirsaniz karakter tanimindan otomatik uretilir"
              />
            </div>
          </CardContent>
        </Card>
        )}

        {isKidsAnim && (
          <CharacterStyleCloset projectId={project.id} characterName={character.name} enabled={isKidsAnim} />
        )}

        <Card>
          <CardHeader>
            <CardTitle>Karakter Kilidi</CardTitle>
            <CardDescription>Bu metinler her klipte aynen kullanilir</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-[11px] font-mono text-muted break-words">
            <div>
              <span className="text-primary">[GORUNUM]</span> {character.baseAppearancePrompt || "—"}
            </div>
            <div>
              <span className="text-primary">[KIYAFET]</span> {character.baseWardrobePrompt || "—"}
            </div>
            <div>
              <span className="text-primary">[ORTAM]</span> {character.baseEnvironmentPrompt || "—"}
            </div>
            <div>
              <span className="text-primary">[KAMERA]</span> {character.baseCameraPrompt || "—"}
            </div>
            <div>
              <span className="text-primary">[SES]</span> {character.baseVoicePrompt || "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{isNarrator ? "Ses / kimlik notu" : "Karakter Profili"}</CardTitle>
              <CardDescription>
                {isNarrator
                  ? "Dis ses kimligi icin kisa not. Anlatici ekranda yok; gorsel uretilmez. Ekrandaki yuzler Hikaye Kadrosu sheet'leridir."
                  : "Degisiklikler Karakter Kilidi'ni yeniden uretir"}
              </CardDescription>
            </div>
            <Button onClick={save} loading={busy === "save"} disabled={isNarrator ? !noteDraft.trim() : !dirty}>
              <Save className="h-4 w-4" /> {isNarrator ? "Notu kilide isle" : "Kaydet"}
            </Button>
          </div>
        </CardHeader>
        {isNarrator ? (
          <CardContent className="space-y-3">
            <Textarea
              className="min-h-[220px] text-[14px] leading-relaxed"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="or. sakin, soguk zafer tonu; yetiskin kadin dis ses"
            />
            <p className="text-[12px] text-muted leading-relaxed">
              Bu not ses/kimlik kilidine islenir. Referans portre uretimi kapali — yalnizca ustteki Hikaye Kadrosu sheet
              uretin.
            </p>
            {character.name && (
              <p className="text-[11px] text-muted-2">
                Arka plan adi: {character.name}
                {character.flowCharacterReference ? ` · ${character.flowCharacterReference}` : ""}
              </p>
            )}
          </CardContent>
        ) : (
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Yas (en az 18, yetiskin varsayilani 20)</Label>
            <Input
              type="number"
              min={18}
              value={Number(form.age ?? character.age)}
              onChange={(e) => setForm((prev) => ({ ...prev, age: Number(e.target.value) }))}
            />
          </div>
          {FIELDS.map((field) => (
            <div key={field.key}>
              <Label>{field.label}</Label>
              <Input
                value={String(form[field.key] ?? "")}
                placeholder={field.placeholder}
                onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="md:col-span-2">
            <Label>Negatif talimatlar</Label>
            <Textarea
              value={String(form.negativePrompt ?? "")}
              onChange={(e) => setForm((prev) => ({ ...prev, negativePrompt: e.target.value }))}
            />
          </div>
          {character.dnaCard && character.dnaCard !== "{}" && (
            <div className="md:col-span-2 rounded-[10px] border border-primary/30 bg-primary-soft/30 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-primary mb-2">
                <Sparkles className="h-3.5 w-3.5" /> DNA Karti
              </div>
              <pre className="text-[11px] text-muted whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(JSON.parse(character.dnaCard), null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
        )}
      </Card>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { Hourglass, Save, Search } from "lucide-react";
import { api, patchJson, postJson } from "@/lib/client-api";
import { TimeTravelResearchPanel } from "@/components/time-travel-research-panel";
import { formatElapsed, useElapsedSeconds } from "@/lib/use-elapsed";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/shared";
import type { ProjectData } from "@/components/project/types";
import {
  COMPANION_LOOK_PRESETS,
  companionLookFor,
  isHostPreset,
  parseTimeTravelSettings,
  randomHostPreset,
  resolveCompanionLook,
  serializeTimeTravelSettings,
  type TimeTravelResearch,
  type TimeTravelSettings,
} from "@/lib/time-travel";

/** Zaman Yolcusu: donem, sunucu, yol arkadasi, muzik ve kapak yazisi. */
export function TimeTravelSettingsCard({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const initial = React.useMemo(() => parseTimeTravelSettings(project.timeTravelSettings), [project.timeTravelSettings]);
  const [form, setForm] = React.useState<TimeTravelSettings>(initial);
  const [topic, setTopic] = React.useState(project.topic);
  const [music, setMusic] = React.useState<Array<{ fileName: string }>>([]);
  const [saving, setSaving] = React.useState(false);
  const [researching, setResearching] = React.useState(false);
  const researchSeconds = useElapsedSeconds(researching);

  React.useEffect(() => setForm(initial), [initial]);
  React.useEffect(() => setTopic(project.topic), [project.topic]);
  React.useEffect(() => {
    api<{ files: Array<{ fileName: string }> }>(`/api/projects/${project.id}/longform/music`, { silent: true })
      .then((data) => setMusic(data.files))
      .catch(() => setMusic([]));
  }, [project.id]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || topic !== project.topic;
  const set = <K extends keyof TimeTravelSettings>(key: K, value: TimeTravelSettings[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** Tur degisince gorunum o turun tarifine gecer (elle yazilmis ve ture uyan metin korunur). */
  const setSpecies = (species: string) =>
    setForm((prev) => {
      const look = prev.companionLook.trim();
      const isPreset = !look || Object.values(COMPANION_LOOK_PRESETS).includes(look) || look.startsWith("small friendly ");
      return {
        ...prev,
        companionSpecies: species,
        companionLook: isPreset ? companionLookFor(species) : resolveCompanionLook(species, look),
      };
    });

  /** Cinsiyet degisince HAZIR gorunum/kiyafet/ses o cinsiyete gecer; elle yazilanlar kalir. */
  const setGender = (gender: "female" | "male") =>
    setForm((prev) => {
      if (prev.hostGender === gender) return prev;
      const preset = randomHostPreset(gender);
      return {
        ...prev,
        hostGender: gender,
        hostLook: isHostPreset(prev.hostLook, "look") ? preset.hostLook : prev.hostLook,
        hostWardrobe: isHostPreset(prev.hostWardrobe, "wardrobe") ? preset.hostWardrobe : prev.hostWardrobe,
        hostVoice: isHostPreset(prev.hostVoice, "voice") ? preset.hostVoice : prev.hostVoice,
      };
    });

  async function research() {
    if (!topic.trim() && !form.era.trim()) {
      toast.error("Önce konu yazın");
      return;
    }
    setResearching(true);
    try {
      if (topic !== project.topic) await patchJson(`/api/projects/${project.id}`, { topic });
      const result = await postJson<TimeTravelResearch>(`/api/projects/${project.id}/time-travel/research`);
      await reload();
      toast.success(`Araştırma güncellendi: ${result.stops.length} durak. Senaryoyu Hikaye sekmesinden yeniden oluşturun.`);
    } finally {
      setResearching(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await patchJson(`/api/projects/${project.id}`, {
        timeTravelSettings: serializeTimeTravelSettings(form),
        topic,
      });
      await reload();
      toast.success("Yolculuk ayarları kaydedildi — sunucu ve yol arkadaşı güncellendi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="icon-tile icon-tile-solid h-10 w-10 shrink-0 rounded-[12px]">
            <Hourglass className="h-[18px] w-[18px]" />
          </span>
          <div>
            <CardTitle>Zaman Yolcusu</CardTitle>
            <CardDescription>
              Dönem, sunucu ve yol arkadaşı. Görünüm değişirse ilgili referans görseli silinir; Karakter sekmesinden yeniden
              üretin. Senaryoyu yeniden yazmak için Hikaye sekmesini kullanın.
            </CardDescription>
          </div>
        </div>
        <Button onClick={save} loading={saving} disabled={!dirty}>
          <Save className="h-4 w-4" /> Kaydet
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Dönem">
            <Input value={form.era} onChange={(e) => set("era", e.target.value)} />
          </Field>
          <Field label="Yer">
            <Input value={form.place} onChange={(e) => set("place", e.target.value)} />
          </Field>
        </div>
        <Field label="Konu (araştırma bunu esas alır)">
          <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={research} loading={researching} disabled={saving}>
            <Search className="h-4 w-4" /> {form.research ? "Konuyu yeniden araştır" : "Konuyu araştır"}
          </Button>
          {researching && (
            <span className="text-[12px] text-muted">İnternette araştırılıyor… {formatElapsed(researchSeconds)}</span>
          )}
        </div>
        {form.research ? (
          <TimeTravelResearchPanel research={form.research} />
        ) : (
          <p className="text-[12px] text-muted">
            Bu yolculuğun araştırma dosyası yok. Senaryo oluşturulurken otomatik araştırılır; şimdi de araştırabilirsin.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Sunucu adı">
            <Input value={form.hostName} onChange={(e) => set("hostName", e.target.value)} />
          </Field>
          <Field label="Cinsiyet">
            <Select value={form.hostGender} onValueChange={(v) => setGender(v === "male" ? "male" : "female")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Kadın</SelectItem>
                <SelectItem value="male">Erkek</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Yaş">
            <Input
              type="number"
              min={18}
              max={80}
              value={form.hostAge}
              onChange={(e) => set("hostAge", Number(e.target.value) || 27)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Sunucu görünümü">
            <Textarea value={form.hostLook} onChange={(e) => set("hostLook", e.target.value)} rows={3} />
          </Field>
          <Field label="Sabit kıyafet">
            <Textarea value={form.hostWardrobe} onChange={(e) => set("hostWardrobe", e.target.value)} rows={3} />
          </Field>
        </div>
        <Field label="Ses">
          <Input value={form.hostVoice} onChange={(e) => set("hostVoice", e.target.value)} />
        </Field>

        <div className="rounded-[14px] border border-border bg-surface-2 p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-bold">Yol arkadaşı</span>
            <Switch checked={form.companionEnabled} onCheckedChange={(v) => set("companionEnabled", v)} />
          </label>
          {form.companionEnabled && (
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Tür">
                <Input value={form.companionSpecies} onChange={(e) => setSpecies(e.target.value)} />
              </Field>
              <Field label="Adı">
                <Input value={form.companionName} onChange={(e) => set("companionName", e.target.value)} />
              </Field>
              <Field label="Görünüm">
                <Input value={form.companionLook} onChange={(e) => set("companionLook", e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Arka plan müziği"
            hint={music.length === 0 ? "music klasörüne mp3/wav koyarsan burada çıkar." : "Final render sırasında kısık seviyede eklenir."}
          >
            <Select value={form.musicFileName || "__none__"} onValueChange={(v) => set("musicFileName", v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Müzik yok</SelectItem>
                {music.map((m) => (
                  <SelectItem key={m.fileName} value={m.fileName}>
                    {m.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kapak yazısı">
            <Input value={form.thumbnailText} onChange={(e) => set("thumbnailText", e.target.value)} placeholder="ör. 4500 YIL ÖNCE" />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

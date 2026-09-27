"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Compass, Hourglass, Lightbulb, Music2, PawPrint, Play, Search, Sparkles, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TimeTravelResearchPanel } from "@/components/time-travel-research-panel";
import { formatElapsed, useElapsedSeconds } from "@/lib/use-elapsed";
import { api, postJson, putJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormSection, PageHeader } from "@/components/shared";
import { FlowImageModelField } from "@/components/flow-image-model-field";
import { defaultLongformImageModel } from "@/lib/longform-catalog";
import { SPEECH_LANGUAGES } from "@/lib/tts-catalog";
import {
  COMPANION_LOOK_PRESETS,
  companionLookFor,
  DEFAULT_TIME_TRAVEL_SETTINGS,
  FLOW_PROJECT_URL_EXAMPLE,
  isHostPreset,
  normalizeFlowProjectUrl,
  randomHostPreset,
  resolveCompanionLook,
  serializeTimeTravelSettings,
  TIME_TRAVEL_IDEA_CATEGORIES,
  type TimeTravelResearch,
  type TimeTravelSettings,
} from "@/lib/time-travel";
import { cn } from "@/lib/utils";

const TOPIC_EXAMPLES = [
  "Titanik batarken insanları uyarmaya çalıştım",
  "29 Ekim 1923, Cumhuriyet'in ilan edildiği gün Ankara",
  "Kanuni döneminde İstanbul'da bir gün",
  "Keops Piramidi inşa edilirken Gize",
  "Pompeii'nin son günü, Vezüv patlamadan önce",
  "1996'da Türkiye'de sıradan bir gün",
];

type Idea = { topic: string; era: string; place: string; hook: string };

const SPECIES_PRESETS = ["kedi", "köpek", "papağan", "tavşan", "tilki", "baykuş"];

const DURATIONS = [
  { label: "5 dk", value: 300 },
  { label: "10 dk", value: 600 },
  { label: "14 dk", value: 840 },
  { label: "20 dk", value: 1200 },
];

export default function NewTimeTravelPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [settings, setSettings] = React.useState<TimeTravelSettings>({ ...DEFAULT_TIME_TRAVEL_SETTINGS, era: "", place: "" });
  const [duration, setDuration] = React.useState(840);
  const [language, setLanguage] = React.useState("Turkish");
  const [imageModel, setImageModel] = React.useState(defaultLongformImageModel());
  const [music, setMusic] = React.useState<Array<{ fileName: string }>>([]);
  const [creating, setCreating] = React.useState(false);
  const [researching, setResearching] = React.useState(false);
  const [researchedTopic, setResearchedTopic] = React.useState("");
  const [ideaCategory, setIdeaCategory] = React.useState<string>(TIME_TRAVEL_IDEA_CATEGORIES[0]);
  const [ideas, setIdeas] = React.useState<Idea[]>([]);
  const [loadingIdeas, setLoadingIdeas] = React.useState(false);
  const researchSeconds = useElapsedSeconds(researching);
  const [flowUrl, setFlowUrl] = React.useState("");
  const [saveFlowDefault, setSaveFlowDefault] = React.useState(true);
  const [flowConflicts, setFlowConflicts] = React.useState<Array<{ id: string; name: string }>>([]);
  const flowUrlValid = !flowUrl.trim() || normalizeFlowProjectUrl(flowUrl) !== null;

  React.useEffect(() => {
    api<{ flowProjectUrl: string }>("/api/time-travel/module", { silent: true })
      .then((data) => setFlowUrl((prev) => prev || data.flowProjectUrl))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    const normalized = normalizeFlowProjectUrl(flowUrl);
    if (!normalized) {
      setFlowConflicts([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api<{ usedOutside: Array<{ id: string; name: string }> }>(
        `/api/time-travel/module?check=${encodeURIComponent(normalized)}`,
        { silent: true }
      )
        .then((data) => setFlowConflicts(data.usedOutside))
        .catch(() => setFlowConflicts([]));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [flowUrl]);
  const research = settings.research;
  const researchStale = Boolean(research) && researchedTopic.trim() !== topic.trim();

  async function runResearch() {
    if (topic.trim().length < 3) {
      toast.error("Önce gitmek istediğin tarihi veya olayı yaz");
      return;
    }
    setResearching(true);
    try {
      const result = await postJson<TimeTravelResearch>("/api/time-travel/research", {
        topic: topic.trim(),
        speechLanguage: language,
        targetDurationSeconds: duration,
        hostName: settings.hostName,
        companion: settings.companionEnabled ? `${settings.companionName} (${settings.companionSpecies})` : "",
      });
      setSettings((prev) => ({
        ...prev,
        era: result.era || prev.era,
        place: result.place || prev.place,
        thumbnailText: prev.thumbnailText || result.thumbnailText,
        research: result,
      }));
      setResearchedTopic(topic.trim());
      if (!name.trim() && result.title) setName(result.title.slice(0, 120));
      toast.success(`Araştırma hazır: ${result.stops.length} durak, ${result.sources.length} kaynak`);
    } finally {
      setResearching(false);
    }
  }

  async function loadIdeas() {
    setLoadingIdeas(true);
    try {
      const data = await postJson<{ ideas: Idea[] }>("/api/time-travel/ideas", {
        category: ideaCategory,
        speechLanguage: language,
        exclude: ideas.map((i) => i.topic),
      });
      setIdeas(data.ideas);
    } finally {
      setLoadingIdeas(false);
    }
  }

  React.useEffect(() => {
    api<{ files: Array<{ fileName: string }> }>("/api/music", { silent: true })
      .then((data) => setMusic(data.files))
      .catch(() => setMusic([]));
  }, []);

  const set = <K extends keyof TimeTravelSettings>(key: K, value: TimeTravelSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  // Her yeni yolculuk farkli bir sunucu gorunumuyle acilsin (ayni tarif = Flow'da ayni yuz).
  // Istemcide, montajdan sonra: sunucu ile ilk HTML ayni kalir (hydration).
  React.useEffect(() => {
    setSettings((prev) => ({ ...prev, ...randomHostPreset(prev.hostGender, prev) }));
  }, []);

  /** Tur degisince gorunum o turun tarifine gecer (elle yazilmis ve ture uyan metin korunur). */
  const setSpecies = (species: string) =>
    setSettings((prev) => {
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
    setSettings((prev) => {
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

  async function create(auto: boolean) {
    if (!name.trim()) {
      toast.error("Yolculuğa bir ad verin");
      return;
    }
    if (!topic.trim() && (!settings.era.trim() || !settings.place.trim())) {
      toast.error("Gitmek istediğin tarihi / olayı yaz ve araştır");
      return;
    }
    if (researching) {
      toast.error("Araştırma bitmeden oluşturulamaz");
      return;
    }
    if (!flowUrlValid) {
      toast.error("Google Flow adresi geçersiz — proje sayfasının adresini yapıştırın");
      return;
    }
    const normalizedFlowUrl = normalizeFlowProjectUrl(flowUrl) ?? "";
    if (!settings.hostName.trim()) {
      toast.error("Sunucunun adını yazın");
      return;
    }
    setCreating(true);
    try {
      const project = await postJson<{ id: string }>("/api/projects", {
        name: name.trim(),
        topic: topic.trim(),
        genre: "Zaman Yolcusu",
        targetDurationSeconds: duration,
        storyLanguage: language,
        speechLanguage: language,
        speechPace: "fast",
        templateType: "time_travel",
        aspectRatio: "16:9",
        clipSeconds: 10,
        flowImageModel: imageModel,
        visualStyle: "photorealistic",
        allowSubtitles: false,
        // Konu arastirmadan sonra degistiyse eski dosya gonderilmez; senaryo yeni konuyu arastirir.
        timeTravelSettings: serializeTimeTravelSettings(researchStale ? { ...settings, research: null } : settings),
        character: { name: settings.hostName.trim(), age: settings.hostAge },
        flowProjectUrl: normalizedFlowUrl,
        reuseFlowProject: true,
      });
      if (saveFlowDefault && normalizedFlowUrl) {
        await putJson("/api/time-travel/module", { flowProjectUrl: normalizedFlowUrl }, { silent: true }).catch(() => {});
      }
      toast.success("Yolculuk oluşturuldu");
      if (auto) {
        try {
          await postJson(`/api/projects/${project.id}/autopilot`, {});
          toast.success("Otopilot başladı — senaryo, çekim planı, karakterler ve klipler sırayla yürür");
        } catch {
          toast.error("Otopilot başlatılamadı; çalışma alanından elle başlatabilirsiniz");
        }
      }
      router.push(`/zaman-yolcusu/${project.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-6xl pb-28">
      <PageHeader
        eyebrow="Zaman Yolcusu"
        title="Yeni yolculuk"
        description="Dönemi ve yeri seç, sunucunu ve yol arkadaşını tanımla. Senaryo, çekim planı ve Flow klipleri bu bilgilerle üretilir."
      />

      <div className="space-y-4">
        <FormSection step={1} title="Yolculuk adı" description="Listede ve çalışma alanında bu isimle durur.">
          <Field label="Yolculuk adı" required htmlFor="journey-name">
            <Input
              id="journey-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="ör. Keops Piramidi yolculuğu"
              disabled={creating}
            />
          </Field>
        </FormSection>

        <FormSection
          step={2}
          title="Konu ve araştırma"
          description="İstediğin tarihi, olayı ya da günü yaz. Program internette araştırıp tarih, yer, durak durak plan ve doğru bilgileri çıkarır."
        >
          <Field
            label="Hangi tarihe / hangi olaya gidiyoruz?"
            required
            hint="Ne kadar açık yazarsan plan o kadar isabetli olur: yıl, yer, görmek istediğin anlar."
          >
            <Textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              placeholder="ör. Titanik batarken insanları uyarmaya çalıştım · 29 Ekim 1923 Ankara · Kanuni döneminde İstanbul'da bir gün"
              disabled={creating || researching}
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            {TOPIC_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setTopic(example)}
                disabled={creating || researching}
                className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[11.5px] font-semibold text-muted hover:border-primary/30 hover:text-primary-strong cursor-pointer disabled:opacity-50"
              >
                <Compass className="h-3 w-3" /> {example}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={runResearch} loading={researching} disabled={creating || topic.trim().length < 3}>
              <Search className="h-4 w-4" /> {research && !researchStale ? "Yeniden araştır" : "Araştır ve planla"}
            </Button>
            {researching && (
              <span className="text-[12px] text-muted">
                İnternette araştırılıyor… {formatElapsed(researchSeconds)} (genelde 1–3 dk)
              </span>
            )}
            {researchStale && !researching && (
              <Badge variant="warning">Konu değişti — yeniden araştır</Badge>
            )}
          </div>

          <div className="mt-5 rounded-[16px] border border-border bg-surface-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[13px] font-bold">
                <Lightbulb className="h-4 w-4 text-primary" /> Fikir lazım mı?
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={ideaCategory} onValueChange={setIdeaCategory}>
                  <SelectTrigger className="h-9 w-[240px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_TRAVEL_IDEA_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="secondary" size="sm" onClick={loadIdeas} loading={loadingIdeas} disabled={creating}>
                  <Sparkles className="h-3.5 w-3.5" /> {ideas.length ? "Başka fikirler" : "Fikir öner"}
                </Button>
              </div>
            </div>
            {ideas.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {ideas.map((idea) => (
                  <button
                    key={idea.topic}
                    type="button"
                    onClick={() => setTopic(idea.topic)}
                    className={cn(
                      "focus-ring rounded-[12px] border bg-surface p-3 text-left cursor-pointer card-lift",
                      topic === idea.topic ? "border-primary/40 ring-1 ring-primary/20" : "border-border"
                    )}
                  >
                    <div className="text-[12.5px] font-bold">{idea.topic}</div>
                    <div className="mt-0.5 text-[11px] text-primary-strong">
                      {idea.era} · {idea.place}
                    </div>
                    <div className="mt-1 text-[11.5px] leading-relaxed text-muted">{idea.hook}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {research && (
            <div className="mt-5">
              <TimeTravelResearchPanel research={research} />
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Dönem" hint={research ? "Araştırmadan geldi; istersen düzelt." : "Araştırma sonrası otomatik dolar."}>
              <Input value={settings.era} onChange={(e) => set("era", e.target.value)} disabled={creating} />
            </Field>
            <Field label="Yer" hint={research ? "Araştırmadan geldi; istersen düzelt." : "Araştırma sonrası otomatik dolar."}>
              <Input value={settings.place} onChange={(e) => set("place", e.target.value)} disabled={creating} />
            </Field>
          </div>
          {!research && (
            <p className="mt-3 text-[11.5px] text-muted-2">
              Araştırmadan oluşturursan senaryo yazılmadan önce araştırma otomatik yapılır.
            </p>
          )}
        </FormSection>

        <FormSection step={3} title="Sunucu" description="Kameraya konuşan kişi. Görünümü ve kıyafeti her klipte aynı kalır.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Adı" required>
              <Input value={settings.hostName} onChange={(e) => set("hostName", e.target.value)} disabled={creating} />
            </Field>
            <Field label="Cinsiyet">
              <div className="grid grid-cols-2 gap-2">
                {(["female", "male"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={cn(
                      "focus-ring h-10 rounded-[11px] border text-[13px] font-semibold cursor-pointer",
                      settings.hostGender === g
                        ? "border-primary/40 bg-primary-soft text-primary-strong"
                        : "border-border bg-surface text-muted hover:border-primary/30"
                    )}
                  >
                    {g === "female" ? "Kadın" : "Erkek"}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Yaş">
              <Input
                type="number"
                min={18}
                max={80}
                value={settings.hostAge}
                onChange={(e) => set("hostAge", Number(e.target.value) || 27)}
                disabled={creating}
              />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Görünüm" hint="Saç, göz, yüz. İngilizce yazarsan Flow daha iyi anlar.">
              <Textarea value={settings.hostLook} onChange={(e) => set("hostLook", e.target.value)} rows={3} disabled={creating} />
              <button
                type="button"
                onClick={() => setSettings((prev) => ({ ...prev, ...randomHostPreset(prev.hostGender, prev) }))}
                disabled={creating}
                className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-primary hover:underline cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" /> Farklı görünüm ve kıyafet öner
              </button>
            </Field>
            <Field label="Sabit kıyafet" hint="Tüm bölüm boyunca değişmez (kolye, çanta dahil).">
              <Textarea
                value={settings.hostWardrobe}
                onChange={(e) => set("hostWardrobe", e.target.value)}
                rows={3}
                disabled={creating}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Ses" hint="Veo her klipte bu tarifle konuşur.">
              <Input value={settings.hostVoice} onChange={(e) => set("hostVoice", e.target.value)} disabled={creating} />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-border bg-surface-2 px-4 py-3">
            <span className="icon-tile icon-tile-primary h-9 w-9 rounded-[11px]">
              <UserRound className="h-4 w-4" />
            </span>
            <p className="text-[12px] leading-relaxed text-muted">
              Oluşturduktan sonra Karakter sekmesinde sunucunun ön ve arka referans görseli üretilir; her klipte bu görsel
              Flow&apos;a gönderilir.
            </p>
          </div>
        </FormSection>

        <FormSection
          step={4}
          title="Yol arkadaşı"
          description="Sunucunun yanında gezen hayvan. Kendi referans görseli olur, konuşmaz."
          action={
            <label className="flex items-center gap-2 text-[12px] font-semibold text-muted">
              <Switch checked={settings.companionEnabled} onCheckedChange={(v) => set("companionEnabled", v)} />
              {settings.companionEnabled ? "Açık" : "Kapalı"}
            </label>
          }
        >
          {settings.companionEnabled ? (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {SPECIES_PRESETS.map((species) => (
                  <button
                    key={species}
                    type="button"
                    onClick={() => setSpecies(species)}
                    className={cn(
                      "focus-ring inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] font-semibold capitalize cursor-pointer",
                      settings.companionSpecies === species
                        ? "border-primary/40 bg-primary-soft text-primary-strong"
                        : "border-border bg-surface text-muted hover:border-primary/30 hover:text-primary-strong"
                    )}
                  >
                    <PawPrint className="h-3.5 w-3.5" />
                    {species}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Tür">
                  <Input
                    value={settings.companionSpecies}
                    onChange={(e) => setSpecies(e.target.value)}
                    disabled={creating}
                  />
                </Field>
                <Field label="Adı">
                  <Input value={settings.companionName} onChange={(e) => set("companionName", e.target.value)} disabled={creating} />
                </Field>
                <Field label="Görünüm" className="md:col-span-1">
                  <Input value={settings.companionLook} onChange={(e) => set("companionLook", e.target.value)} disabled={creating} />
                </Field>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-muted">Sunucu bu yolculuğa yalnız çıkar.</p>
          )}
        </FormSection>

        <FormSection step={5} title="Süre, dil ve üretim" description="Klipler Flow video modeliyle 16:9 üretilir.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Hedef süre">
              <div className="grid grid-cols-4 gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDuration(d.value)}
                    className={cn(
                      "focus-ring h-10 rounded-[11px] border text-[13px] font-semibold cursor-pointer",
                      duration === d.value
                        ? "border-primary/40 bg-primary-soft text-primary-strong"
                        : "border-border bg-surface text-muted hover:border-primary/30"
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-2">≈ {Math.round(duration / 9)} klip (8–10 sn)</p>
            </Field>
            <Field label="Konuşma dili">
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPEECH_LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <FlowImageModelField value={imageModel} onChange={setImageModel} />
            <Field
              label="Arka plan müziği"
              hint={music.length === 0 ? "music klasörüne mp3/wav koyarsan burada çıkar." : "Final render sırasında kısık seviyede eklenir."}
            >
              <Select value={settings.musicFileName || "__none__"} onValueChange={(v) => set("musicFileName", v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Müzik yok</SelectItem>
                  {music.map((m) => (
                    <SelectItem key={m.fileName} value={m.fileName}>
                      <span className="inline-flex items-center gap-1.5">
                        <Music2 className="h-3.5 w-3.5" /> {m.fileName}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Kapak yazısı (isteğe bağlı)" hint="Boş bırakırsan senaryo önerir (ör. 4500 YIL ÖNCE).">
              <Input value={settings.thumbnailText} onChange={(e) => set("thumbnailText", e.target.value)} disabled={creating} />
            </Field>
          </div>
        </FormSection>

        <FormSection
          step={6}
          title="Google Flow proje adresi"
          description="Yalnızca Zaman Yolcusu için. Genel Ayarlar'daki Flow adresinden ve Anlatılar'daki projelerden bağımsızdır."
        >
          <Field
            label="Flow proje adresi"
            hint="flow.google.com'da bu kanal için bir proje aç, adres çubuğundaki bağlantıyı (flow.google.com/project/...) buraya yapıştır. Eski labs.google adresleri de kabul edilir. Boş bırakırsan ilk üretimde yeni bir Flow projesi açılır ve bu yolculuğa bağlanır."
            error={flowUrlValid ? undefined : `Geçersiz adres. Örnek: ${FLOW_PROJECT_URL_EXAMPLE}`}
          >
            <Input
              value={flowUrl}
              onChange={(e) => setFlowUrl(e.target.value.trim())}
              placeholder="https://flow.google.com/project/..."
              aria-invalid={!flowUrlValid}
              disabled={creating}
            />
          </Field>
          <label className="mt-3 flex items-center gap-2.5 text-[12.5px] font-semibold text-foreground/80">
            <Switch checked={saveFlowDefault} onCheckedChange={setSaveFlowDefault} />
            Sonraki yolculuklar için varsayılan olarak hatırla
          </label>
          {flowConflicts.length > 0 && (
            <div className="mt-3 rounded-[12px] border border-warning/25 bg-warning-soft/60 px-3 py-2 text-[12px] leading-relaxed text-warning">
              Bu Flow projesi Anlatılar&apos;da da kullanılıyor ({flowConflicts.map((c) => c.name).join(", ")}). Karakter ve klipler
              aynı Flow kütüphanesine düşer ve karışabilir; Zaman Yolcusu için ayrı bir Flow projesi açmanı öneririm.
            </div>
          )}
        </FormSection>
      </div>

      <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-border bg-surface/95 px-5 py-4 elevated backdrop-blur">
        <div className="flex items-center gap-3 text-[12px] text-muted">
          <span className="icon-tile icon-tile-solid h-9 w-9 rounded-[11px]">
            <Hourglass className="h-4 w-4" />
          </span>
          <span className="line-clamp-2 max-w-[560px]">
            <span className="font-bold text-foreground">{settings.era || topic || "Dönem"}</span> · {settings.place || "Yer"} ·{" "}
            {settings.hostName || "Sunucu"}
            {settings.companionEnabled ? ` + ${settings.companionName || settings.companionSpecies}` : ""} ·{" "}
            {Math.round(duration / 60)} dk
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/zaman-yolcusu")} disabled={creating}>
            Vazgeç
          </Button>
          <Button variant="secondary" onClick={() => create(false)} loading={creating} disabled={researching}>
            Yolculuğu oluştur
          </Button>
          <Button onClick={() => create(true)} loading={creating} disabled={researching}>
            <Play className="h-4 w-4" /> Oluştur + Otomatik yürüt
          </Button>
        </div>
      </div>
    </div>
  );
}

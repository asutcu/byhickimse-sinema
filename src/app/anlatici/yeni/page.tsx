"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clapperboard, ImageIcon, Sparkles } from "lucide-react";
import { postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormSection, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LONGFORM_SETTINGS,
  LONGFORM_DURATION_PRESETS,
  LONGFORM_GENRES,
  LONGFORM_STILL_INTERVALS,
  LONGFORM_VOICES,
  defaultLongformImageModel,
  estimateLongformStillCount,
  formatLongformCastBudget,
  longformDefaultSpeed,
  longformNamedCastBudget,
  serializeLongformSettings,
  type LongformGenreId,
  type LongformImageProvider,
  type LongformStillInterval,
  type LongformVoiceId,
  type NarratorFormat,
} from "@/lib/longform-catalog";
import {
  narratorGenreLabel,
  type NarratorGenreId,
} from "@/lib/narrator-genres";
import { NarratorGenrePicker } from "@/components/narrator-genre-picker";
import { LongformImageSourcePicker } from "@/components/longform-image-source-picker";
import { TtsVoicePicker } from "@/components/tts-voice-picker";
import { NarrationNameField } from "@/components/narration-name-editor";
import { SubtitleStyleFields } from "@/components/subtitle-style-fields";
import { DEFAULT_SUBTITLE_STYLE, type BurnSubtitleStyle } from "@/lib/subtitle-style";
import { Switch } from "@/components/ui/switch";
import { ELEVENLABS_VOICE_ID, SPEECH_LANGUAGES } from "@/lib/tts-catalog";

const CINEMA_TO_STILLS: Record<NarratorGenreId, LongformGenreId> = {
  aldatma: "aldatma",
  "yasak-ask": "yasak-ask",
  ihanet: "ihanet",
  kiskanclik: "kiskanclik",
  intikam: "intikam",
  bosanma: "bosanma",
  "aile-sirri": "aile-sirri",
  kayinvalide: "kayinvalide",
  "hesap-sorma": "hesap-sorma",
  "guclu-donus": "guclu-donus",
  "yeniden-dogus": "yeniden-dogus",
  "kadin-gelisimi": "kadin-gelisimi",
  "gizli-kimlik": "gizli-kimlik",
  "sozlesmeli-evlilik": "sozlesmeli-evlilik",
  "yildirim-nikahi": "yildirim-nikahi",
  "zengin-aile": "zengin-aile",
  pismanlik: "pismanlik",
  "trajik-ask": "trajik-ask",
  "aile-bagi": "aile-bagi",
  "ahlaki-ikilem": "ahlaki-ikilem",
  gizem: "mystery",
  gerilim: "gerilim",
  dram: "dram",
  "gercek-yasam": "documentary",
  romantik: "romantik",
  korku: "korku",
  ozel: "ozel",
};

const CARTOON_STYLES = [
  {
    id: "pixar3d" as const,
    label: "3D animasyon",
    hint: "Pixar / DreamWorks",
    detail: "Everest hattı. Hacimli 3D karakter, tüylü ve kumaşlı. Ön-arka kart aynı yüz ve kostüm.",
  },
  {
    id: "anime" as const,
    label: "2D anime",
    hint: "Çizgi",
    detail: "Temiz çizgi, düz renk, büyük göz. 3D ile karışmaz.",
  },
];

const CARTOON_AGES = [
  { id: "1-3", label: "1–3 yaş", detail: "Çok kısa cümle" },
  { id: "3-5", label: "3–5 yaş", detail: "Sade macera" },
  { id: "6-8", label: "6–8 yaş", detail: "Biraz daha olay" },
];

const VIDEO_DURATION_PRESETS = [
  { label: "1 dakika", value: 60 },
  { label: "3 dakika", value: 180 },
  { label: "5 dakika", value: 300 },
  { label: "10 dakika", value: 600 },
  { label: "Ozel sure", value: -1 },
];

export default function NewNarrationPage() {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [suggestingTopic, setSuggestingTopic] = React.useState(false);
  const [format, setFormat] = React.useState<NarratorFormat>("stills");
  const [name, setName] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [durationChoice, setDurationChoice] = React.useState(1800);
  const [customDuration, setCustomDuration] = React.useState(1800);
  const [language, setLanguage] = React.useState("Turkish");
  const [genreId, setGenreId] = React.useState<LongformGenreId>("aldatma");
  const [cinemaGenreId, setCinemaGenreId] = React.useState<NarratorGenreId>("aldatma");
  const [customCinemaGenre, setCustomCinemaGenre] = React.useState("");
  const [voiceId, setVoiceId] = React.useState<string>(ELEVENLABS_VOICE_ID);
  const [ttsExpressive, setTtsExpressive] = React.useState(true);
  const [stillInterval, setStillInterval] = React.useState<LongformStillInterval>(15);
  const [imageProvider, setImageProvider] = React.useState<LongformImageProvider>("flow");
  const [imageModel, setImageModel] = React.useState(defaultLongformImageModel());
  const [subtitles, setSubtitles] = React.useState<BurnSubtitleStyle>({ ...DEFAULT_SUBTITLE_STYLE });
  const [cartoonStyle, setCartoonStyle] = React.useState<(typeof CARTOON_STYLES)[number]["id"]>("pixar3d");
  const [cartoonAge, setCartoonAge] = React.useState("6-8");
  const [cartoonLesson, setCartoonLesson] = React.useState("");

  const isStills = format === "stills";
  const isCartoon = format === "cartoon";
  const durationPresets = isStills ? LONGFORM_DURATION_PRESETS : VIDEO_DURATION_PRESETS;
  const targetDurationSeconds = durationChoice === -1 ? customDuration : durationChoice;
  const stillCount = estimateLongformStillCount(targetDurationSeconds, stillInterval);
  const genre = LONGFORM_GENRES.find((g) => g.id === genreId) ?? LONGFORM_GENRES[0];

  function selectCinemaGenre(id: NarratorGenreId) {
    setCinemaGenreId(id);
    const stillsId = CINEMA_TO_STILLS[id];
    if (stillsId) setGenreId(stillsId);
  }

  async function fillTopicSuggestion() {
    if (!isCartoon && cinemaGenreId === "ozel" && !customCinemaGenre.trim()) {
      toast.error("Ozel tur icin once bir ad yazin");
      return;
    }
    setSuggestingTopic(true);
    try {
      const result = await postJson<{ topic: string; title: string; hook: string }>("/api/narrator/suggest-topic", {
        genreId: isCartoon ? "cizgi" : cinemaGenreId,
        customGenre: customCinemaGenre,
        topic,
        speechLanguage: language,
        storyLanguage: language,
        targetDurationSeconds,
        kind: isCartoon ? "cartoon" : isStills ? "brief" : "full",
        ...(isCartoon
          ? { narrationStyle: cartoonStyle, audience: cartoonAge, openingHook: cartoonLesson.trim() }
          : {}),
        // full modda kelime hedefini sunucu, ayarlardaki konusma temposundan hesaplar
        ...(isStills ? { targetWordCount: 140 } : {}),
      });
      setTopic(result.topic);
      if (!name.trim() && result.title?.trim()) {
        setName(result.title.trim().slice(0, 120));
      }
      toast.success("OpenAI secilen ture gore hikaye yazdi");
    } finally {
      setSuggestingTopic(false);
    }
  }

  React.useEffect(() => {
    if (format === "stills") {
      setDurationChoice(1800);
      setCustomDuration(1800);
    } else if (format === "cartoon") {
      setDurationChoice(300);
      setCustomDuration(300);
    } else {
      setDurationChoice(180);
      setCustomDuration(180);
    }
  }, [format]);

  async function create(auto = false) {
    if (!name.trim()) {
      toast.error("Anlati adi gerekli");
      return;
    }
    if (!topic.trim()) {
      toast.error("Hikaye konusu gerekli");
      return;
    }
    if (!isCartoon && cinemaGenreId === "ozel" && !customCinemaGenre.trim()) {
      toast.error("Ozel tur icin bir ad yazin");
      return;
    }
    const startAutoPilot = async (projectId: string) => {
      if (!auto) return;
      try {
        await postJson(`/api/projects/${projectId}/autopilot`, {});
        toast.success("Otopilot basladi — render haric her sey otomatik yurur");
      } catch {
        toast.error("Otopilot baslatilamadi; studyodan elle baslatabilirsiniz");
      }
    };
    setCreating(true);
    try {
      if (isStills) {
        const project = await postJson<{ id: string }>("/api/projects", {
          name: name.trim(),
          topic: topic.trim(),
          genre: genreId === "ozel" ? customCinemaGenre.trim() : genreId,
          targetDurationSeconds: Math.max(20, Math.min(3600, targetDurationSeconds)),
          storyLanguage: language,
          speechLanguage: language,
          speechPace: genre.defaultPace,
          templateType: "longform",
          aspectRatio: "16:9",
          clipSeconds: stillInterval,
          flowImageModel: imageModel,
          visualStyle: "documentary-stills",
          allowSubtitles: subtitles.enabled,
          longformSettings: serializeLongformSettings({
            ...DEFAULT_LONGFORM_SETTINGS,
            genreId,
            customGenre: genreId === "ozel" ? customCinemaGenre.trim() : "",
            voiceId,
            ttsExpressive,
            ttsSpeed: longformDefaultSpeed(genre),
            stillIntervalSeconds: stillInterval,
            imageProvider,
            imageModel,
            subtitles,
          }),
        });
        toast.success("Gorsel anlati olusturuldu");
        await startAutoPilot(project.id);
        router.push(`/anlatici/${project.id}`);
        return;
      }

      if (isCartoon) {
        const project = await postJson<{ id: string }>("/api/projects", {
          name: name.trim(),
          topic: topic.trim(),
          genre: "Çizgi film",
          audience: `${cartoonAge} yaş`,
          targetDurationSeconds: Math.max(20, Math.min(3600, targetDurationSeconds)),
          storyLanguage: language,
          speechLanguage: language,
          speechPace: "normal",
          templateType: "kids_animation",
          aspectRatio: "16:9",
          clipSeconds: 10,
          flowImageModel: imageModel,
          visualStyle: cartoonStyle,
          allowSubtitles: false,
          ageBand: cartoonAge,
          moralLesson: cartoonLesson.trim(),
        });
        toast.success("Çizgi film oluşturuldu");
        await startAutoPilot(project.id);
        router.push(`/anlatici/sinema/${project.id}`);
        return;
      }

      const project = await postJson<{ id: string }>("/api/projects", {
        name: name.trim(),
        topic: topic.trim(),
        genre: narratorGenreLabel(cinemaGenreId, customCinemaGenre),
        targetDurationSeconds: Math.max(20, Math.min(3600, targetDurationSeconds)),
        storyLanguage: language,
        speechLanguage: language,
        speechPace: "fast",
        templateType: "narrator",
        aspectRatio: "16:9",
        clipSeconds: 10,
        flowImageModel: imageModel,
        visualStyle: "photorealistic",
        allowSubtitles: false,
      });
      toast.success("Video anlati olusturuldu");
      await startAutoPilot(project.id);
      router.push(`/anlatici/sinema/${project.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-6xl pb-28">
      <PageHeader
        eyebrow="Anlatı"
        title="Yeni anlatı"
        description="Önce bir ad verin, sonra biçimi seçin. Adı sonra listeden veya stüdyo başlığından da değiştirebilirsiniz."
      />

      <div className="space-y-4">
        <FormSection step={1} title="Anlatı adı" description="Listede ve stüdyoda bu isimle durur. Hikaye başlığından ayrıdır.">
          <NarrationNameField value={name} onChange={setName} disabled={creating} />
        </FormSection>

        <FormSection
          step={2}
          title="Biçim"
          description="Görsel anlatı, sinema film ve çizgi film ayrı üretim hatlarıdır."
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => {
                setFormat("stills");
              }}
              className={cn(
                "rounded-[14px] border p-4 text-left",
                isStills
                  ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                  : "border-border bg-surface hover:border-primary/40"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-primary/20 bg-primary-soft">
                  <ImageIcon className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <div className="text-[14px] font-semibold">Görsel anlatı</div>
                  <div className="text-[10.5px] text-primary">TTS + slayt</div>
                </div>
              </div>
              <p className="mt-2 text-[12px] text-muted leading-relaxed">
                30 dk hikaye gibi uzun anlatida, konusma metni parcaya bolunur. Her 10 / 15 / 20 saniyede o anki akisi
                gosteren duragan gorsel uretilir. Ses + muzik + altyazi sonra slayt olarak birlesir.
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                setFormat("video");
              }}
              className={cn(
                "rounded-[14px] border p-4 text-left",
                format === "video"
                  ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                  : "border-border bg-surface hover:border-primary/40"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-surface-3">
                  <Clapperboard className="h-4 w-4 text-muted" />
                </span>
                <div>
                  <div className="text-[14px] font-semibold">Sinema film</div>
                  <div className="text-[10.5px] text-muted-2">Flow video klipleri</div>
                </div>
              </div>
              <p className="mt-2 text-[12px] text-muted leading-relaxed">
                Kameraya konusan kadin anlatıcı. Her sahne video klip olarak uretilir. Zamanli duragan kare bu bicimde
                yoktur.
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                setFormat("cartoon");
              }}
              className={cn(
                "rounded-[14px] border p-4 text-left",
                isCartoon
                  ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                  : "border-border bg-surface hover:border-primary/40"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-surface-3">
                  <Sparkles className="h-4 w-4 text-muted" />
                </span>
                <div>
                  <div className="text-[14px] font-semibold">Çizgi film</div>
                  <div className="text-[10.5px] text-muted-2">3D · Flow klipleri</div>
                </div>
              </div>
              <p className="mt-2 text-[12px] text-muted leading-relaxed">
                Everest hattı: Pixar tarzı 3D karakterler, ön-arka kimlik kartı, film boyunca kilitli kostüm. Konuşma
                Türkçe, ekranda yazı yok.
              </p>
            </button>
          </div>
        </FormSection>

        <FormSection
          step={3}
          title="Konu"
          description={
            isCartoon
              ? "Konuyu yaz veya Hikaye öner. Karakterler, dünya ve kostüm renkleri bu metinden gelir."
              : "Once turu sec, sonra Hikaye oner — OpenAI o türe ozel yeni bir konu yazar."
          }
        >
          <div className="space-y-3">
            {isCartoon && (
              <p className="text-[12px] text-muted leading-relaxed">
                Yetişkin dram türü bu biçimde yok. Özgün 3D karakterler üretilir; yüz, renk ve kıyafet her klipte aynı
                kalır.
              </p>
            )}
            {!isCartoon && (
            <div>
              <Label>Hikaye turu</Label>
              <div className="mt-1.5">
                <NarratorGenrePicker value={cinemaGenreId} onChange={selectCinemaGenre} />
              </div>
              {cinemaGenreId === "ozel" && (
                <div className="mt-3 max-w-md">
                  <Label>Ozel tur adi</Label>
                  <Input
                    value={customCinemaGenre}
                    onChange={(e) => setCustomCinemaGenre(e.target.value)}
                    placeholder="or. ikinci es, evlatlik sirri"
                  />
                  <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                    Yazdigin kelime hikayenin turu olur — konu ve senaryo buna gore gelir.
                  </p>
                </div>
              )}
            </div>
            )}
            <div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Hikaye konusu *</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={suggestingTopic}
                  disabled={suggestingTopic || creating}
                  onClick={() => void fillTopicSuggestion()}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Hikaye oner
                </Button>
              </div>
              <Textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={7}
                placeholder={
                  isCartoon
                    ? "Örnek: küçük bir kedi ekibi karlı bir dağda kayıp bir çanı arar"
                    : "Turu secip Hikaye oner'e bas — OpenAI o türe ozel yeni bir konu yazar"
                }
              />
              <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                {isCartoon
                  ? "Çizgi film"
                  : isStills
                    ? genreId === "ozel" && customCinemaGenre.trim()
                      ? customCinemaGenre.trim()
                      : genre.label
                    : narratorGenreLabel(cinemaGenreId, customCinemaGenre)}{" "}
                icin OpenAI konu yazar.
                Tekrar basarsan onceki konuyu tekrarlamaz.
              </p>
            </div>
          </div>
        </FormSection>

        {isCartoon && (
          <FormSection
            step={4}
            title="Görünüm"
            description="3D ya da 2D. Seçim karakter kartına, hikâyeye ve her klip istemine işlenir."
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {CARTOON_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setCartoonStyle(style.id)}
                    className={cn(
                      "rounded-[14px] border p-4 text-left",
                      cartoonStyle === style.id
                        ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                        : "border-border bg-surface hover:border-primary/40"
                    )}
                  >
                    <div className="text-[14px] font-semibold">{style.label}</div>
                    <div className="text-[10.5px] text-primary">{style.hint}</div>
                    <p className="mt-2 text-[12px] text-muted leading-relaxed">{style.detail}</p>
                  </button>
                ))}
              </div>
              <div>
                <Label>Yaş aralığı</Label>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {CARTOON_AGES.map((age) => (
                    <button
                      key={age.id}
                      type="button"
                      onClick={() => setCartoonAge(age.id)}
                      className={cn(
                        "rounded-[12px] border px-3 py-3 text-center",
                        cartoonAge === age.id
                          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                          : "border-border bg-surface hover:border-primary/40"
                      )}
                    >
                      <div className="text-[14px] font-semibold">{age.label}</div>
                      <div className="text-[10px] text-muted">{age.detail}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Ders</Label>
                <Textarea
                  className="mt-1.5"
                  rows={2}
                  value={cartoonLesson}
                  onChange={(e) => setCartoonLesson(e.target.value)}
                  placeholder="İsteğe bağlı. Örnek: korkunca arkadaşından yardım ister"
                />
                <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                  Boş bırakabilirsin. Doluysa hikâyenin içine girer, vaaz gibi okunmaz.
                </p>
              </div>
            </div>
          </FormSection>
        )}

        <FormSection
          step={isCartoon ? 5 : 4}
          title={isStills ? "Sure ve gorsel ritmi" : isCartoon ? "Süre" : "Sure"}
          description={
            isStills
              ? "Konusma bu araliga bolunur; her parca o andaki sahnenin gorselini ister."
              : "Video biciminde klip suresi Flow modeline gore (genelde 8 sn) ayridir."
          }
        >
          <div className={cn("grid grid-cols-1 gap-4", isStills && "md:grid-cols-2")}>
            <div>
              <Label>Hedef sure</Label>
              <Select value={String(durationChoice)} onValueChange={(v) => setDurationChoice(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {durationPresets.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {durationChoice === -1 && (
                <Input
                  className="mt-2"
                  type="number"
                  min={20}
                  max={3600}
                  value={customDuration}
                  onChange={(e) => setCustomDuration(Number(e.target.value) || (isStills ? 1800 : 180))}
                />
              )}
            </div>
            {isStills && (
              <div>
                <Label>Gorsel araligi</Label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {LONGFORM_STILL_INTERVALS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setStillInterval(n)}
                      className={cn(
                        "rounded-[12px] border px-3 py-3 text-center",
                        stillInterval === n
                          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                          : "border-border bg-surface hover:border-primary/40"
                      )}
                    >
                      <div className="text-[16px] font-semibold tabular-nums">{n} sn</div>
                      <div className="text-[10px] text-muted">bir gorsel</div>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted leading-relaxed">
                  {Math.round(targetDurationSeconds / 60)} dk konusma × her {stillInterval} sn ≈{" "}
                  <span className="font-semibold text-foreground">{stillCount} gorsel</span>
                  {", "}
                  hikayede ≈{" "}
                  <span className="font-semibold text-foreground">
                    {formatLongformCastBudget(longformNamedCastBudget(targetDurationSeconds))} isimli yuz
                  </span>
                  . Video klip uretilmez.
                </p>
              </div>
            )}
          </div>
        </FormSection>

        {isStills && (
          <FormSection
            step={5}
            title="Görsel motoru"
            description="Kareler bu kaynaktan ve bu modelden üretilir. Seçimi stüdyoda da değiştirebilirsin."
          >
            <LongformImageSourcePicker
              provider={imageProvider}
              model={imageModel}
              onChange={({ imageProvider: nextProvider, imageModel: nextModel }) => {
                setImageProvider(nextProvider);
                setImageModel(nextModel);
              }}
            />
          </FormSection>
        )}

        {isStills && (
          <FormSection
            step={6}
            title="Seslendirme"
            description="İki ayrı şey: dil (hikaye hangi dilde) ve ses (o metni kim okur)."
          >
            <div className="space-y-4">
              <div className="max-w-sm">
                <Label>Konuşma dili</Label>
                <p className="mt-1 mb-1.5 text-[11.5px] text-muted leading-relaxed">
                  Hikaye bu dilde yazılır ve okunur. Türkçe = metin Türkçe. Ses motoru burası değil.
                </p>
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
              </div>
              <TtsVoicePicker language={language} value={voiceId} onChange={setVoiceId} />
              <div className="flex items-start justify-between gap-4 rounded-[12px] border border-border bg-surface px-3 py-3">
                <div>
                  <Label>Duygulu anlatım</Label>
                  <p className="mt-1 text-[11px] text-muted leading-relaxed">
                    Sinirli sahnelerde ses sertleşir, pismanlikta yavaslar. ElevenLabs ile daha belirgin olur.
                  </p>
                </div>
                <Switch checked={ttsExpressive} onCheckedChange={setTtsExpressive} />
              </div>
            </div>
          </FormSection>
        )}

        {isStills && (
          <FormSection
            step={7}
            title="Alt yazı"
            description="Açık/kapalı. Açıkken her klibin metni filmde aynı konumda, aynı stilde görünür."
          >
            <SubtitleStyleFields value={subtitles} onChange={setSubtitles} />
          </FormSection>
        )}

        {!isStills && (
          <FormSection
            step={isCartoon ? 6 : 5}
            title="Dil"
            description={isCartoon ? "Karakterler bu dilde konuşur" : "Sinema anlaticinin konusma dili"}
          >
            <div className="max-w-sm">
              <Label>Konusma dili</Label>
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
            </div>
          </FormSection>
        )}
      </div>

      <div className="sticky bottom-0 z-20 -mx-6 mt-5 border-t border-border surface-glass shadow-raise lg:-mx-8">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 lg:px-8">
          <p className="text-[12px] text-muted">
            {isStills
              ? `Gorsel slayt · ${Math.round(targetDurationSeconds / 60)} dk · ${stillInterval} sn kare · ~${stillCount} gorsel · ${genre.label} · ${voiceId.startsWith("elevenlabs") ? "ElevenLabs" : "ses"} · alt yazı ${subtitles.enabled ? "açık" : "kapalı"}`
              : isCartoon
                ? `Çizgi film · ${Math.round(targetDurationSeconds / 60)} dk · ${cartoonStyle === "anime" ? "2D anime" : "3D animasyon"} · ${cartoonAge} yaş · Flow klipleri`
                : `Video · ${Math.round(targetDurationSeconds / 60)} dk · ${narratorGenreLabel(cinemaGenreId, customCinemaGenre)} · Flow klipleri`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => router.push("/anlatici")} disabled={creating}>
              Vazgec
            </Button>
            <Button variant="secondary" onClick={() => void create(false)} loading={creating}>
              {isStills ? "Gorsel anlatiyi olustur" : isCartoon ? "Çizgi filmi oluştur" : "Video anlatiyi olustur"}
            </Button>
            <Button onClick={() => void create(true)} loading={creating} title="Hikaye, klipler, karakterler ve uretim otomatik yurur; yalnizca render sizde kalir">
              <Sparkles className="h-4 w-4" /> Olustur + Otomatik yurut
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

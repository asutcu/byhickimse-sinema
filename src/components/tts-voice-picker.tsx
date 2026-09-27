"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import {
  ELEVENLABS_VOICE_ID,
  isLegacyVoiceId,
  ttsProviderInfo,
  type TtsProvider,
  type TtsVoice,
} from "@/lib/tts-catalog";

interface VoicesResponse {
  provider: TtsProvider;
  languageLabel: string;
  secrets: Record<"google" | "azure" | "elevenlabs" | "openai", boolean>;
  elevenLabsVoiceId?: string;
  voices: TtsVoice[];
}

const SECRET_HINT: Record<string, string> = {
  google: "Google API anahtari eksik — Ayarlar > Seslendirme",
  azure: "Azure anahtari eksik — Ayarlar > Seslendirme",
  elevenlabs: "ElevenLabs anahtari veya ses kimligi eksik — Ayarlar > Seslendirme",
  openai: "OpenAI anahtari eksik — Ayarlar > OpenAI",
};

const PROVIDER_ORDER: TtsProvider[] = ["elevenlabs", "google", "azure", "openai", "piper"];

function voiceOptionLabel(voice: TtsVoice): string {
  return voice.provider === "elevenlabs" ? voice.label : `${ttsProviderInfo(voice.provider).label} · ${voice.label}`;
}

function groupVoices(voices: TtsVoice[]): Array<{ provider: TtsProvider; label: string; voices: TtsVoice[] }> {
  return PROVIDER_ORDER.flatMap((provider) => {
    const list = voices.filter((v) => v.provider === provider);
    if (list.length === 0) return [];
    return [{ provider, label: ttsProviderInfo(provider).label, voices: list }];
  });
}

/**
 * Ses secici. ElevenLabs bagliysa o anlatıcı sesidir; diger motorlar istege bagli.
 */
export function TtsVoicePicker({
  language,
  value,
  onChange,
  speed = 1,
  pitchSemitones = 0,
  label = "Anlatıcı sesi",
}: {
  language: string;
  value: string;
  onChange: (voiceId: string) => void;
  speed?: number;
  pitchSemitones?: number;
  label?: string;
}) {
  const [data, setData] = React.useState<VoicesResponse | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [showOthers, setShowOthers] = React.useState(false);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    let cancelled = false;
    api<VoicesResponse>(`/api/tts/voices?language=${encodeURIComponent(language || "")}`, { silent: true })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [language]);

  const voices = data?.voices ?? [];
  const eleven = voices.find((v) => v.id === ELEVENLABS_VOICE_ID || v.provider === "elevenlabs") ?? null;
  const elevenReady = Boolean(data?.secrets.elevenlabs);

  React.useEffect(() => {
    if (!eleven) return;
    if (isLegacyVoiceId(value) || !value) onChangeRef.current(eleven.id);
  }, [eleven, value]);

  const selected = voices.find((v) => v.id === value) ?? null;
  const usingEleven = selected?.provider === "elevenlabs" || value === ELEVENLABS_VOICE_ID;
  const missingKey =
    selected && data
      ? selected.provider === "openai"
        ? !data.secrets.openai
        : selected.provider === "piper"
          ? false
          : Object.entries(data.secrets).some(([k, ok]) => k === selected.provider && !ok)
      : null;
  const groups = groupVoices(voices);
  const otherGroups = groups.filter((g) => g.provider !== "elevenlabs");

  async function preview(voiceId = value) {
    if (!voiceId) return;
    setPlaying(true);
    try {
      const response = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId, language, speed, pitchSemitones }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error || "Ses onizlemesi uretilemedi");
      }
      const fallback = decodeURIComponent(response.headers.get("X-Tts-Fallback") || "");
      if (fallback) toast.message(fallback);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ses onizlemesi uretilemedi");
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>{label}</Label>
        <p className="mt-1 text-[11.5px] text-muted leading-relaxed">
          Metni seslendiren kişi / motor. Konuşma dilini seçtiysen ElevenLabs o dilde okur (Türkçe, İngilizce, Almanca, Fransızca, İspanyolca).
        </p>
      </div>

      <div
        className={cn(
          "rounded-[14px] border p-3.5",
          usingEleven && elevenReady
            ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
            : elevenReady
              ? "border-border bg-surface"
              : "border-dashed border-border bg-surface-2"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold">ElevenLabs</div>
            <p className="mt-0.5 text-[11.5px] text-muted leading-relaxed">
              {elevenReady
                ? selected?.label?.includes("hikayeye")
                  ? "Voice ID yazmana gerek yok. Hikaye diline (TR/EN/DE/FR/ES) ve türüne göre hesabından ses seçilir."
                  : "Anlatıcı sesi ElevenLabs. Konuşma diline göre seçilir; istersen Ayarlar’da Voice ID sabitle."
                : "Henüz bağlı değil. Ayarlar > Seslendirme’ye yalnızca API anahtarı (sk_...) yeter."}
            </p>
          </div>
          {elevenReady ? (
            <Badge variant="primary">{usingEleven ? "kullanılıyor" : "hazır"}</Badge>
          ) : (
            <Badge>eksik</Badge>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {elevenReady && eleven && (
            <>
              <Button type="button" size="sm" onClick={() => onChange(eleven.id)} disabled={usingEleven}>
                Bunu kullan
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void preview(eleven.id)}
                loading={playing && usingEleven}
                disabled={playing}
              >
                <Play className="h-3.5 w-3.5" /> Dinle
              </Button>
            </>
          )}
          {!elevenReady && (
            <Link
              href="/settings"
              className="inline-flex h-8 items-center rounded-[10px] border border-border bg-surface px-3 text-xs font-medium hover:bg-surface-2"
            >
              Ayarlara git
            </Link>
          )}
        </div>
      </div>

      {(!elevenReady || showOthers || (selected && !usingEleven)) && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label>Başka motor</Label>
            {data && <span className="text-[10.5px] text-muted-2">{data.languageLabel}</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Select value={selected && !usingEleven ? value : undefined} onValueChange={onChange}>
              <SelectTrigger>
                <SelectValue placeholder="Google / Azure / OpenAI" />
              </SelectTrigger>
              <SelectContent>
                {otherGroups.map((group) => (
                  <SelectGroup key={group.provider}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.voices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {voiceOptionLabel(v)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void preview()}
              loading={playing && !usingEleven}
              disabled={playing || !selected || usingEleven}
            >
              <Play className="h-3.5 w-3.5" /> Dinle
            </Button>
          </div>
        </div>
      )}

      {elevenReady && !showOthers && usingEleven && (
        <button
          type="button"
          className="text-[12px] text-muted hover:text-foreground"
          onClick={() => setShowOthers(true)}
        >
          ElevenLabs yerine başka motor kullan
        </button>
      )}

      {missingKey && selected && (
        <p className="text-[11px] text-danger leading-relaxed">{SECRET_HINT[selected.provider]}</p>
      )}
    </div>
  );
}

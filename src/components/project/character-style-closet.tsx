"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Shirt, Sparkles, Trash2 } from "lucide-react";
import { api, mediaUrl, postJson } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type StyleGenerationMethod = "openai" | "flow";

interface StyleClosetEntry {
  id: string;
  slot: number;
  label: string;
  occasion: string;
  outfitDetail: string;
  imagePrompt: string;
  imagePath: string | null;
  approved: boolean;
  createdAt: string;
}

/**
 * Ana karakter yedek tarz dolabi (slot 2, 3+).
 * Aktif ON+ARKA sheet'e dokunmaz; onaylananlar uretimde kullanilmaz ta ki "Aktif yap" denene.
 */
export function CharacterStyleCloset({
  projectId,
  characterName,
  enabled,
}: {
  projectId: string;
  characterName: string;
  enabled: boolean;
}) {
  const [closet, setCloset] = React.useState<StyleClosetEntry[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<StyleGenerationMethod>("openai");

  const load = React.useCallback(async () => {
    const data = await api<{ closet: StyleClosetEntry[] }>(`/api/projects/${projectId}/character/styles`, { silent: true });
    setCloset(data.closet);
  }, [projectId]);

  React.useEffect(() => {
    if (!enabled) return;
    load().catch(() => {});
  }, [enabled, load]);

  if (!enabled) return null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Shirt className="h-4 w-4 text-primary" />
            <CardTitle>Tarz Dolabi (yedek 2, 3+)</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Select value={method} onValueChange={(v) => setMethod(v as StyleGenerationMethod)}>
              <SelectTrigger className="h-8 w-[168px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI ile (hizli)</SelectItem>
                <SelectItem value="flow">Flow ile (Nano Banana)</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              loading={busy === "suggest"}
              disabled={busy !== null}
              onClick={() =>
                run("suggest", async () => {
                  const result = await postJson<{ closet: StyleClosetEntry[]; created: StyleClosetEntry[]; failed: string[] }>(
                    `/api/projects/${projectId}/character/styles`,
                    { action: "suggest", count: 3, method }
                  );
                  setCloset(result.closet);
                  if (result.failed.length > 0) {
                    toast.warning(`${result.created.length} gorsel hazir, ${result.failed.length} basarisiz: ${result.failed.join(", ")}`);
                  } else {
                    toast.success(`${result.created.length} yedek tarz gorseli hazir — aktif sheet bozulmadi`);
                  }
                })
              }
            >
              <Sparkles className="h-3.5 w-3.5" /> Yeni Tarz Oner
            </Button>
          </div>
        </div>
        <CardDescription>
          <strong>{characterName || "Ana karakter"}</strong> ayni kalir: yeni gorseller aktif referans SHEET&apos;i kimlik
          kaynagi olarak kullanir (goruntu duzenleme) — yuz, tur, boy, kilo ve oranlar birebir korunur, sadece kiyafet
          degisir. Onayladiklariniz slot 2 / 3+ olarak saklanir — uretimde kullanilmaz ta ki &quot;Aktif yap&quot; deyin.
          Ustteki aktif referans hic degismez; aktif yapinca eski hali de burada yedek secenek olarak kalir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {busy === "suggest" && (
          <p className="text-[12px] text-info leading-relaxed animate-pulse">
            {method === "flow"
              ? "Tarz gorselleri Flow (Nano Banana) ile sirayla uretiliyor — otomasyon Flow sekmesinde gorunur, birkac dakika surebilir…"
              : "Tarz gorselleri referans korunarak paralel uretiliyor — birkac on saniye surebilir…"}
          </p>
        )}

        {closet.length === 0 ? (
          <p className="text-[12px] text-muted-2 leading-relaxed">
            Henuz yedek tarz yok. &quot;Yeni Tarz Oner&quot; ile deniz / yagmur gibi durumlar icin ayni karakterin farkli
            kiyafet gorsellerini direkt uretin.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-2 uppercase tracking-wide">
              Yedekler ({closet.length}) — uretimde kullanilmiyor
            </div>
            {closet.map((entry) => (
              <div key={entry.id} className="rounded-[10px] border border-border bg-surface-2 p-3 flex gap-3">
                {entry.imagePath ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={mediaUrl(entry.imagePath)}
                    alt={entry.label}
                    className="h-20 w-28 rounded-md object-cover border border-border shrink-0"
                  />
                ) : (
                  <div className="h-20 w-28 rounded-md border border-dashed border-border-strong shrink-0" />
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="primary">#{entry.slot}</Badge>
                    <span className="text-[13px] font-semibold">{entry.label}</span>
                    {entry.approved ? (
                      <Badge variant="success">
                        <CheckCircle2 className="h-3 w-3" /> Onayli yedek
                      </Badge>
                    ) : (
                      <Badge variant="warning">Onay bekliyor</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted leading-relaxed">{entry.occasion}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {!entry.approved && (
                      <Button
                        size="sm"
                        variant="success"
                        loading={busy === `approve-${entry.id}`}
                        disabled={busy !== null}
                        onClick={() =>
                          run(`approve-${entry.id}`, async () => {
                            await postJson(`/api/projects/${projectId}/character/styles`, {
                              action: "approve",
                              styleId: entry.id,
                            });
                            await load();
                            toast.success(`Slot ${entry.slot} onaylandi (yedek — aktif degil)`);
                          })
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Onayla (yedek)
                      </Button>
                    )}
                    {entry.approved && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === `activate-${entry.id}`}
                        disabled={busy !== null}
                        onClick={() => {
                          const ok = window.confirm(
                            `"${entry.label}" aktif yapilsin mi?\n\nSu anki aktif sheet once yedek olarak kaydedilir; Flow bundan sonra yeni tarzi kullanir.`
                          );
                          if (!ok) return;
                          run(`activate-${entry.id}`, async () => {
                            await postJson(`/api/projects/${projectId}/character/styles`, {
                              action: "activate",
                              styleId: entry.id,
                            });
                            await load();
                            toast.success(`${entry.label} aktif edildi (eski tarz yedekte)`);
                            window.location.reload();
                          });
                        }}
                      >
                        Aktif yap
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `del-${entry.id}`}
                      disabled={busy !== null}
                      onClick={() =>
                        run(`del-${entry.id}`, async () => {
                          await postJson(`/api/projects/${projectId}/character/styles`, {
                            action: "delete",
                            styleId: entry.id,
                          });
                          await load();
                          toast.success("Yedek silindi");
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

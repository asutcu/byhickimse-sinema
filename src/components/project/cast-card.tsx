"use client";

import * as React from "react";
import { toast } from "sonner";
import { Clapperboard, Images, Users } from "lucide-react";
import { mediaUrl, postJson } from "@/lib/client-api";
import { clipReferencesCastMember } from "@/lib/cast-clip-match";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProjectData } from "@/components/project/types";
import { formatElapsed, useElapsedSeconds } from "@/lib/use-elapsed";

/**
 * Hikaye kadrosu:
 * - Anlatici: hikayeden cikarilan diger kisiler (kesit planlari).
 * - Cocuk animasyonu: Sahneleri Olustur ile gelen sabit yan karakterler (tum sahnelerde ayni).
 */
export function CastCard({ project, reload }: { project: ProjectData; reload: () => Promise<ProjectData> }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);
  const elapsed = useElapsedSeconds(busy !== null);

  const isKids = false;
  const timeTravel = project.templateType === "time_travel";
  const cast = project.characters.filter((c) => c.role === "side");
  const cutawayClips = project.clips.filter((c) => c.shotType === "cutaway");
  const scenesPlanned = project.clips.filter((c) => Boolean(c.sceneDescription?.trim())).length;
  const cutawayCount = cutawayClips.length;
  const hasClips = project.clips.length > 0;
  const sceneUnit = isKids ? "sahne" : "kesit";
  const planPending = hasClips && scenesPlanned === 0;

  const missingImageNames = cast
    .filter((member) => {
      if (member.referenceImagePath) return false;
      if (isKids) {
        return project.clips.some((clip) => {
          const inFocus = clip.characterId === member.id;
          const inLine = clip.sceneDescription.toLowerCase().includes(member.name.toLowerCase());
          return inFocus || inLine;
        });
      }
      return project.clips.some((clip) => clipReferencesCastMember(clip, member));
    })
    .map((member) => member.name);
  const unassignedCutaways = isKids
    ? 0
    : cutawayClips.filter((clip) => {
        if (!clip.sceneDescription?.trim()) return false;
        if (clip.characterId) return false;
        return !cast.some((m) => clipReferencesCastMember(clip, m));
      }).length;
  const namedButUnlinked = isKids
    ? 0
    : cutawayClips.filter((clip) => {
        if (clip.characterId) return false;
        return cast.some((m) => clipReferencesCastMember({ ...clip, characterId: null }, m));
      }).length;
  const missingSheetCount = cast.filter((member) => !member.referenceImagePath).length;

  async function run(key: string, fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    try {
      await fn();
    } catch {
      // postJson toast gosterir — Next overlay olmasin
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function generateAllSheets() {
    if (busyRef.current) return;
    const missing = cast.filter((member) => !member.referenceImagePath);
    const targets = missing.length > 0 ? missing : cast;
    if (targets.length === 0) return;
    busyRef.current = true;
    setBusy("bulk");
    toast.message("Flow açılıyor… karakter görselleri sırayla üretilecek");
    const ok: string[] = [];
    const fail: string[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        const member = targets[i];
        setBulkProgress(`${member.name} (${i + 1}/${targets.length})`);
        try {
          toast.message(`${member.name}: Flow açılıyor…`);
          await postJson(`/api/projects/${project.id}/cast/${member.id}/image`);
          ok.push(member.name);
          await reload();
        } catch (error) {
          fail.push(member.name);
          toast.error(`${member.name}: ${error instanceof Error ? error.message : "görsel üretilemedi"}`);
        }
      }
      if (ok.length > 0) toast.success(`${ok.length} görsel hazır: ${ok.join(", ")}`);
      if (fail.length > 0) toast.error(`Yarida kalan: ${fail.join(", ")}`);
    } finally {
      busyRef.current = false;
      setBusy(null);
      setBulkProgress(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle>{timeTravel ? "Yol arkadaşı ve dönem yerlileri" : isKids ? "Sabit Hikaye Kadrosu" : "Hikaye Kadrosu"}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {hasClips && (
              <Badge variant="info">
                {timeTravel
                  ? `${cast.length} kişi / hayvan · ${project.clips.length} klip`
                  : isKids
                    ? `${cast.length} yan karakter`
                    : planPending
                      ? `${project.clips.length} klip · plan bekleniyor`
                      : `${cutawayCount} film sahnesi`}
              </Badge>
            )}
            {!isKids && !timeTravel && (
              <Button
                size="sm"
                variant={cast.length > 0 ? "outline" : "default"}
                disabled={!hasClips || busy !== null}
                loading={busy === "extract"}
                onClick={() =>
                  run("extract", async () => {
                    const result = await postJson<{ castCount: number; cutawayCount: number }>(
                      `/api/projects/${project.id}/cast`
                    );
                    await reload();
                    toast.success(
                      `${result.castCount} karakter, ${result.cutawayCount} film sahnesi — guncel hikayeden bastan planlandi`
                    );
                  })
                }
              >
                <Users className="h-3.5 w-3.5" /> {cast.length > 0 || cutawayCount > 0 ? "Film planini yenile" : "Film planini uret"}
              </Button>
            )}
          </div>
        </div>
        <CardDescription>
          {timeTravel ? (
            <>
              Senaryodan gelen <span className="font-medium text-foreground">dönem yerlileri</span> ve sunucunun{" "}
              <span className="font-medium text-foreground">yol arkadaşı</span>. Her biri için tek referans görseli üretin;
              yerli sahnelerinde ve yol arkadaşının göründüğü kliplerde Flow&apos;a bu görseller yüklenir. Çekim planı
              hikaye kliplere bölünürken yazılır; Klipler sekmesinden her klibin çekim türünü değiştirebilirsiniz.
            </>
          ) : isKids ? (
            <>
              Sahneler olusturulurken hikayeden cikarilan <span className="font-medium text-foreground">yan karakterler</span>.
              Her biri icin <span className="font-medium text-foreground">yalnizca ön + arka</span> turnaround referans
              gorseli uretin (tek gorselde iki panel). Uc-ceyrek / yan / aksiyon poz kullanmayin — Flow bunlari farkli
              kisi sanir. Ana karakter gorseli bu kartin altindadir; kliplerde Flow&apos;a bu sheet&apos;ler yuklenir.
            </>
          ) : (
            <>
              Hikayede gecen, <span className="font-medium text-foreground">ekrandaki kisiler</span> — her kayit tek
              yetiskin (tek kadinsa kadin, tek erkekse erkek). Anlatici kadini goruntude yoktur — yalnizca dis ses.
              Film plani her klibe kim + ne yaptigini yazar; prompt ve Flow gorsel yukleme bu atamadan gelir.
            </>
          )}
          {busy !== null && (
            <span className="block mt-1 text-foreground">
              {bulkProgress
                ? `${bulkProgress} · `
                : busy === "extract"
                  ? "Sahneler yerelde yazılıyor · "
                  : "Model calisiyor · "}
              {formatElapsed(elapsed)} gecti.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasClips ? (
          <p className="text-xs text-muted py-2">
            {isKids
              ? "Once Cocuk Studio'dan Sahneleri Olusturun; yan karakterler otomatik kadroya eklenir."
              : "Once hikayeyi kliplere bolun; film sahneleri otomatik planlanir."}
          </p>
        ) : cast.length === 0 ? (
          <p className="text-xs text-muted py-2">
            {isKids
              ? "Bu hikayede yan karakter yok (yalnizca ana kahraman). Yeni sahnelerde yan karakter isteniyorsa Sahneleri yeniden olusturun."
              : planPending
                ? "Film sahneleri henuz yok. \"Film planini uret\" hikayedeki yer, kisi ve esyalari her klibe yazar."
                : "Bu hikayede ekranda gosterilecek yan karakter yok; sahneler kisisiz mekan/esya cekimidir."}
          </p>
        ) : (
          <div className="space-y-3">
            {planPending && (
              <div className="rounded-[10px] border border-warning/40 bg-warning-soft/40 px-3 py-2 text-[11.5px] text-warning leading-relaxed">
                Kadro isimleri hazir ama kliplere sahne/karakter henuz yazilmamis. Bu yuzden herkes &quot;0 kesit&quot;
                ve Kliplerde &quot;Kimse yok&quot; gorunur. Once <span className="font-medium">Film planini yenile</span> —
                bitince kesit sayilari ve sahnedeki kisi dolacak.
              </div>
            )}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] text-muted">
                {missingSheetCount > 0
                  ? `${missingSheetCount} kisinin kimlik görseli yok — sırayla üretilir.`
                  : "Tüm kadronun görseli var; toplu yenile hepsini baştan üretir."}
              </p>
              <Button
                size="sm"
                disabled={busy !== null}
                loading={busy === "bulk"}
                onClick={() => void generateAllSheets()}
              >
                <Images className="h-3.5 w-3.5" />
                {missingSheetCount > 0 ? `Toplu uret (${missingSheetCount})` : `Toplu yenile (${cast.length})`}
              </Button>
            </div>
            {(missingImageNames.length > 0 || unassignedCutaways > 0 || namedButUnlinked > 0) && !planPending && (
              <div className="rounded-[10px] border border-warning/40 bg-warning-soft/40 px-3 py-2 text-[11.5px] text-warning leading-relaxed">
                {missingImageNames.length > 0 && (
                  <div>
                    Gorseli olmayan kadro: {missingImageNames.join(", ")}. Her kisi icin tek, net kimlik gorseli
                    uretmezseniz bu kisiler sahneden sahneye farkli gorunebilir.
                  </div>
                )}
                {namedButUnlinked > 0 && (
                  <div>
                    {namedButUnlinked} sahnede isim var ama karakter secili degil — Film planini yenileyin veya Kliplerden
                    kisiyi secin (aksi halde Flow sheet yanlis/eksik yuklenebilir).
                  </div>
                )}
                {unassignedCutaways > 0 && (
                  <div>
                    {unassignedCutaways} film sahnesi gercekten kisisiz (mekan/esya). Bu normal olabilir.
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {cast.map((member) => {
                const clipCount = isKids
                  ? project.clips.filter((c) => {
                      if (c.characterId === member.id) return true;
                      return c.sceneDescription.toLowerCase().includes(member.name.toLowerCase());
                    }).length
                  : project.clips.filter((c) => clipReferencesCastMember(c, member)).length;
                return (
                  <div key={member.id} className="rounded-[10px] border border-border bg-surface-2 p-3 flex gap-3">
                    {member.referenceImagePath ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={mediaUrl(member.referenceImagePath)}
                        alt={member.name}
                        className="h-20 w-14 shrink-0 rounded-md object-cover border border-border"
                      />
                    ) : (
                      <div className="h-20 w-14 shrink-0 rounded-md border border-dashed border-border-strong flex items-center justify-center text-[10px] text-muted-2 text-center px-1">
                        gorsel yok
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="text-[13px] font-semibold truncate">{member.name}</div>
                        {!isKids && (
                          <Badge variant={member.storyRole.startsWith("yol arkadaşı") ? "info" : "default"}>
                            {member.storyRole.startsWith("yol arkadaşı")
                              ? "hayvan"
                              : member.gender === "male"
                                ? "erkek"
                                : "kadin"}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted">{member.storyRole}</div>
                      <p className="text-[11px] text-muted-2 mt-1 leading-relaxed line-clamp-2">{member.storyNote}</p>
                      {member.baseAppearancePrompt && (
                        <p className="text-[10px] text-muted-2/80 mt-1 leading-relaxed line-clamp-2 italic">
                          {member.baseAppearancePrompt}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <Badge>{planPending ? "plan bekliyor" : `${clipCount} ${sceneUnit}`}</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          loading={busy === member.id}
                          onClick={() =>
                            run(member.id, async () => {
                              toast.message(`${member.name}: Flow açılıyor…`);
                              await postJson(`/api/projects/${project.id}/cast/${member.id}/image`);
                              await reload();
                              toast.success(`${member.name} görseli Flow ile üretildi`);
                            })
                          }
                        >
                          <Clapperboard className="h-3.5 w-3.5" />{" "}
                          {member.referenceImagePath ? "Görsel yenile" : "Görsel üret"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

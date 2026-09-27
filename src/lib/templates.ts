export const TEMPLATE_TYPES = ["narrator", "longform", "time_travel", "kids_animation"] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export function isLongform(templateType: string): boolean {
  return templateType === "longform";
}

/** Zaman Yolcusu: kameraya konusan sunucu + yol arkadasi hayvan + donem yerlileri. */
export function isTimeTravel(templateType: string): boolean {
  return templateType === "time_travel";
}

/** Flow video klibi ureten sinema hatti (anlatici film + zaman yolcusu + cizgi film). */
export function usesCinemaClipPipeline(templateType: string): boolean {
  return templateType === "narrator" || templateType === "time_travel" || templateType === "kids_animation";
}

/** Anlatici ailesi: gorsel slayt + Flow sinema. */
export function isNarratorFamily(templateType: string): boolean {
  return templateType === "longform" || templateType === "narrator";
}

/** Cocuk animasyonu. Yeni anlatida Cizgi film olarak acilir; Everest de bu turdedir. */
export function isLegacyAnimation(templateType: string): boolean {
  return templateType === "kids_animation";
}

/** Anlatilar listesinde gorunen turler. Zaman Yolcusu kendi bolumunde listelenir. */
export function isListedNarration(templateType: string): boolean {
  return isNarratorFamily(templateType) || isLegacyAnimation(templateType);
}

export function isSupportedTemplateType(templateType: string): templateType is TemplateType {
  return (TEMPLATE_TYPES as readonly string[]).includes(templateType);
}

/** Projenin calisma alani adresi. */
export function projectWorkspaceHref(project: { id: string; templateType: string }): string {
  if (isLongform(project.templateType)) return `/anlatici/${project.id}`;
  if (isTimeTravel(project.templateType)) return `/zaman-yolcusu/${project.id}`;
  return `/anlatici/sinema/${project.id}`;
}

/** Adres anlatici bolumune mi ait? */
export function isNarratorSectionPath(pathname: string): boolean {
  return pathname === "/anlatici" || pathname.startsWith("/anlatici/");
}

/** Adres Zaman Yolcusu bolumune mi ait? */
export function isTimeTravelSectionPath(pathname: string): boolean {
  return pathname === "/zaman-yolcusu" || pathname.startsWith("/zaman-yolcusu/");
}

export function usesStudioWizard(templateType: string): boolean {
  return isLongform(templateType);
}

export function templateLabel(templateType: string): string {
  if (templateType === "longform") return "Gorsel Anlati";
  if (isTimeTravel(templateType)) return "Zaman Yolcusu";
  if (isLegacyAnimation(templateType)) return "Cocuk Animasyonu";
  return "Sinema Anlatici";
}

export function templateLabelShort(templateType: string): string {
  if (templateType === "longform") return "Gorsel";
  if (isTimeTravel(templateType)) return "Zaman";
  if (isLegacyAnimation(templateType)) return "Animasyon";
  return "Sinema";
}

export function listKindLabel(templateType: string): string {
  if (templateType === "longform") return "Gorsel slayt";
  if (isTimeTravel(templateType)) return "Tarih vlogu";
  if (isLegacyAnimation(templateType)) return "Cocuk animasyonu";
  return "Video";
}

export function emptyDialogueHint(templateType: string): string {
  if (templateType === "longform") {
    return 'Studyo sekmesinde "Tek tus uret" ile senaryoyu, sesi ve konusmaya gore zamanli gorselleri uretin. Video klip yok.';
  }
  return "Klipler sekmesinden metinleri doldurun, sonra Promptlar sekmesinden promptlari yeniden olusturun.";
}

export function emptyClipsHint(templateType: string): string {
  if (templateType === "longform") {
    return "Studyo sekmesinden senaryo ve gorsel slaytlari uretin; Flow video klibi kullanilmaz.";
  }
  if (isTimeTravel(templateType)) {
    return "Hikaye sekmesinden once yolculuk senaryosunu olusturun, sonra 'Hikayeyi Kliplere Bol' ile cekim planini cikarin.";
  }
  return "Hikaye sekmesinden once hikaye olusturun, sonra 'Hikayeyi Kliplere Bol' dugmesini kullanin.";
}

import type { CharacterProfile, Clip, Project } from "@prisma/client";
import { isNarratorHardConflictGenre } from "@/lib/narrator-genres";
import { netShortFlowEmotionCue } from "@/lib/netshort-summaries";
import { flowVoiceDirection } from "@/lib/tts-performance";
import { stampNoOnscreenTextLock, stripEmbeddedOnscreenTextTails } from "@/lib/flow-prompt-compact";
import { prepareLiveActionFlowPrompt, stripCastNamesForFlow } from "@/lib/flow-prompt-safety";
import { filmCityFor, presentDayWorld, REALITY_LOCK_TAG, realityLockBlock } from "@/lib/reality-lock";

/**
 * Flow prompt uretimi.
 * Prompt = Ingilizce yonetmen talimatlari + secilen dilde konusma metni.
 * Sablon panelden proje bazinda duzenlenebilir (Project.promptTemplate);
 * bos ise buradaki varsayilan kullanilir.
 *
 * Sablon degiskenleri:
 * {{STYLE}} {{CHARACTER_REFERENCE}} {{SCENE_CONTINUITY}} {{CAMERA}} {{PERFORMANCE}}
 * {{VOICE}} {{LANGUAGE}} {{DIALOGUE}} {{SUBTITLES}} {{SPEECH_FIDELITY}} {{NEGATIVE}}
 * {{FLOW_CHARACTER}} {{SCENE_NOTES}} {{MUSIC}} {{LYRIC_VISUAL_LOCK}} {{DIALOGUE_VISUAL_LOCK}}
 * {{WORLD_DETAIL}}
 */

export const DEFAULT_NARRATOR_TEMPLATE = `{{FLOW_CHARACTER}}[SPOKEN LINE — AUDIO FIRST]
She speaks this exact {{LANGUAGE}} line ON CAMERA, word for word, filling the full clip:

"{{DIALOGUE}}"

[HARD EMOTION]
{{HARD_EMOTION}}

[STYLE]
{{STYLE}}

[CHARACTER REFERENCE]
{{CHARACTER_REFERENCE}}

[SCENE CONTINUITY]
{{SCENE_CONTINUITY}}

[WORLD — FULL LOCATION]
{{WORLD_DETAIL}}

[CAMERA]
{{CAMERA}}

[PERFORMANCE]
{{PERFORMANCE}}

[AUDIO AND SPEECH]
She speaks clearly in {{LANGUAGE}}. {{SPEECH_FIDELITY}} {{VOICE}}

She says exactly (verbatim in {{LANGUAGE}} — never translate to English or any other language):

"{{DIALOGUE}}"

[ON-SCREEN TEXT]
{{SUBTITLES}}

[RESTRICTIONS]
Do not add, remove, paraphrase or translate words.
Do not add background music.
Do not add other speakers.
Keep the same adult woman — face, hair, age, wardrobe. This is the NARRATOR ON CAMERA in a lived-in home, not a studio host.
She may cry, RAISE HER VOICE, shout, swear the quoted words, slam a table, stand and sit, look away and back. Frozen beauty-ad posing and pretty melancholy are forbidden.
Do not shoot this like a commercial, catalog, perfume ad or clean talking-head product spot.
Pace the exact quoted line across the FULL clip: start in the first second, last word in the final second. Forbidden: finishing in the first 3-5 seconds then standing silent. Do not add extra words — stretch with breaths. Never cut off mid-word.
{{NEGATIVE}}`;

/**
 * Kesit plani: ekranda olay gorunur, anlatici sesi DIS SES olarak devam eder.
 * Sahnedeki kisi konusmaz; boylece anlatim butunlugu bozulmadan gorsel cesitlilik kazanilir.
 */
export const DEFAULT_CUTAWAY_TEMPLATE = `{{FLOW_CHARACTER}}[SPOKEN LINE — AUDIO FIRST]
A female narrator voice-over says this exact {{LANGUAGE}} line off screen, word for word, filling the full clip:

"{{DIALOGUE}}"

[HARD EMOTION]
{{HARD_EMOTION}}

[STYLE]
{{STYLE}}

[SHOT]
Live-action cinema take, not a talking-head or product shot. The narrator woman is NEVER on camera. Picture is the story world only.
{{SCENE_NOTES}}

[STORY WORD → PICTURE LOCK]
{{DIALOGUE_VISUAL_LOCK}}

[WHO IS ON SCREEN]
{{CHARACTER_REFERENCE}}

[SCENE CONTINUITY]
{{SCENE_CONTINUITY}}

[WORLD — FULL LOCATION]
{{WORLD_DETAIL}}

[CAMERA]
{{CAMERA}}

[PERFORMANCE — EMOTION IS MANDATORY]
{{PERFORMANCE}}

[AUDIO]
No one speaks on camera. This is a cinema cutaway under narration.
{{SPEECH_FIDELITY}}
A female narrator voice-over says exactly, off screen:

"{{DIALOGUE}}"

{{VOICE}}

[ON-SCREEN TEXT]
{{SUBTITLES}}

[RESTRICTIONS]
Do not add, remove, paraphrase or translate the narration.
Nobody on screen moves their lips. Narrator woman is NOT in frame.
No beauty-ad plate, no frozen b-roll, no text/logo/watermark.
Pace the exact narration across the FULL clip.
{{NEGATIVE}}`;

/**
 * Gorsel stil on ayarlari. Panel bu anahtarlari gosterir; deger olarak
 * Ingilizce yonetmen tarifi prompta yazilir. Kullanici serbest metin de girebilir.
 */
export const VISUAL_STYLE_PRESETS: Array<{ id: string; label: string; prompt: string; recommendedFor: "narrator" | "both" }> = [
  {
    id: "photorealistic",
    label: "Gercekci (canli cekim)",
    prompt:
      "Cinematic live-action short drama shot like a theatrical feature: 35mm film texture with fine natural grain, spherical prime lenses, true optical depth of field with soft focus falloff. Motivated practical lighting only — window daylight, tungsten lamps, city neon spill through glass — mixed color temperatures kept honest; deep shadows that still hold detail, highlights rolling off like film, never clipped video white. Ordinary neighbor faces with natural asymmetry, honest lived-in texture, flyaway hair strands; wardrobe shows real fabric weave, wrinkles and wear. Rooms are inhabited with layered depth: foreground prop edge, mid-ground action, background life kept soft. Gentle atmosphere — dust motes in light shafts, faint kitchen steam or evening haze. Subtle handheld sway like a documentary operator breathing; one consistent light direction so every shadow and reflection agrees. No cartoon, no plastic airbrush, no studio-portrait glamour, no beauty-ad gloss.",
    recommendedFor: "narrator",
  },
  {
    id: "cinematic",
    label: "Sinematik film gorunumu (ReelShort / NetShort)",
    prompt:
      "ReelShort / NetShort premium short-drama look, graded like a streaming melodrama pilot: large-sensor digital cinema, 35mm-format sensor, 85mm portrait primes, crisp micro-contrast, deep blacks, rich controlled saturation, cool teal shadows against warm skin. Light is designed, not found: soft flattering key on the face, a hard rim separating hair and shoulders, background practicals melted into creamy shallow depth of field — towers, chandeliers, headlights as clean bokeh. Status production design: marble lobby, glass boardroom, black sedan interior, penthouse window at dusk. Wardrobe follows story status — money in a tailored suit, silk and heels; the ordinary character in simple clean clothes, both lit with the same care. Cast: attractive real adults, clean skin that keeps its texture, sharp catchlight in the eyes, emotion in jaw, eyes and hands — contempt, cold power, humiliation readable instantly even at thumbnail size. Framing tight and confrontational: chest-up singles, over-shoulder power angles, slow push-in on the reveal, held frame on the reaction. No documentary rawness, no flat phone video, no cartoon, no plastic airbrushed skin, no on-screen text.",
    recommendedFor: "narrator",
  },
  {
    id: "documentary",
    label: "Belgesel gorunumu",
    prompt:
      "Observational drama: available light, slight handheld, lived-in rooms, honest skin, unstaged clutter. Ordinary people in ordinary clothes.",
    recommendedFor: "narrator",
  },
  {
    id: "pixar3d",
    label: "3D Animasyon (Pixar tarzi)",
    prompt:
      "Feature-quality 3D CGI family animation (Pixar / DreamWorks theatrical look), NOT live-action, NOT 2D, NOT stop-motion. Physically based materials, subsurface scattering on surface/ears/fur, individually groomed hair and fur strands, wet living eyes with iris micro-detail and environment catchlights, soft global illumination with warm bounce, volumetric god-rays with floating ice crystals or dust, cinematic shallow depth of field with deep readable backgrounds, motion blur on fast moves, rich theatrical art direction, ultra-detailed prop and fabric textures, multi-layer sets that feel like a real inhabited adventure world. Character faces carry true emotional acting — clear expression in brows — never plastic dolls.",
    recommendedFor: "both",
  },
  {
    id: "anime",
    label: "2D Anime",
    prompt:
      "2D anime style: clean confident line art, expressive large eyes with layered iris highlights and reflections, vibrant cel-shaded colors with soft gradient lighting, detailed painted backgrounds with atmospheric perspective and depth, wind-reactive hair and clothing, smooth fluid character animation with strong key poses.",
    recommendedFor: "both",
  },
];

/**
 * Fiziksel gerceklik katmani: her klip promptunun [STYLE] blogunun sonuna
 * eklenir. Amac, gercek gozun gordugu HER SEYIN dogru islenmesi — bu bir
 * "guzel gorunsun" listesi degil, bir FIZIK dogrulama listesidir. Ornek:
 * yolda yuruyen bir adamin golgesi ayaklarina yapisik kalir, sahnedeki TUM
 * diger golgelerle ayni isik yonunu/rengini paylasir ve adimla birlikte
 * hareket eder. Ayni titizlik yansima, malzeme, atmosfer, kamera fizigi,
 * zemin etkilesimi ve insan biyomekanigi icin de gecerli.
 */
const LIVE_ACTION_REALISM = [
  "Film-camera physics, not a portrait shoot: one light direction for every shadow; glass/puddle/eye reflections match the real scene; feet planted; clothes follow the body a beat after it stops; no plastic skin, no floating props, no warped faces.",
].join(" ");

/** Reklam / katalog / parfum estetiğini ezer — NetShort kisa dramasi. */
export const FEATURE_DRAMA_LOOK = [
  "NETSHORT SHORT-DRAMA LOOK: lived-in city rooms, practical lights, cinema grain.",
  "Ordinary adults in everyday clothes — neighbor faces, not studio portraits.",
  "Modern city: car interiors, glass offices, kitchen tables, boutique exits. Mixed color temps.",
  "POWER ON SCREEN: look-down, slammed door, thrown phone/glass. No blood, no weapons.",
  "Acting: cold resolve, bitter smile, turning away, regret. No frozen postcard sadness.",
].join(" ");

const ANIMATED_REALISM = [
  "World-class theatrical 3D CGI fidelity — every frame must hold a close frame-by-frame look like a cinema still from a feature film.",
  "Physically based materials matched to whatever surfaces actually appear in THIS scene: correct specular response for wet/dry/metal/fabric/organic surfaces, fabric weave and ripples, reflective surfaces (water, glass, metal, eyes) mirroring the environment AND the cast accurately.",
  "Fur and hair are individually groomed strands that react to wind or water; fabric shows weave, stitching and wear appropriate to the scene's own environment; loose debris that fits the scene (dust, sand, spray, leaves, snow — whichever is actually present) scatters believably on contact.",
  "Eyes wet and alive with iris detail and catchlights; breath vapor in cold air OR material sheen in heat/exertion — whichever matches THIS scene's real climate and action.",
  "Soft contact shadows ground every foot and prop, all sharing ONE consistent light direction and color across the frame; bounce light from the scene's dominant nearby surface (snow, sand, water, foliage, walls) carries its color into faces; volumetric light shafts through the scene's natural atmosphere (dust, spray, pollen, mist).",
  "Every prop has believable thickness and weight and never floats or clips through geometry; silhouettes never warp between frames.",
].join(" ");

/** 2D anime secildiginde: canli-cekim fizigi veya 3D CGI malzeme dili YAZILMAZ — celiski yaratir. */
const ANIME_STYLE_CONSISTENCY = [
  "World-class 2D anime production fidelity — every frame reads like a key frame from a theatrical anime film. NOT 3D CGI, NOT live-action, NOT photoreal — never add skin-pore or camera-sensor realism here.",
  "Consistent clean line art weight and flat cel-shading throughout the whole clip; shadow shapes are stylized hard-edged anime cel shadows (not soft photographic gradients), always cast from ONE consistent light direction shared by every character and prop in the frame.",
  "Detailed painted backgrounds matching the characters' line/color style, with the same atmospheric perspective and palette from the first frame to the last — no photographic textures bleeding into the art.",
  "Hair, clothing and scarves flow with stylized wind physics that stay consistent in direction and intensity across the shot; eyes keep the same iris highlight pattern, size and proportions in every frame.",
  "Motion stays fluid with strong key poses, using smears/speed-lines only on fast action beats — never live-action motion blur, never global-illumination bounce light, never photographic skin texture.",
].join(" ");

type StyleFamily = "live-action" | "cgi3d" | "anime2d";

/** Bir on ayarin (id ile) ait oldugu gorsel aile — gerceklik katmani BUNA gore secilir. */
function styleFamilyOfPreset(presetId: string): StyleFamily {
  if (presetId === "anime") return "anime2d";
  if (presetId === "pixar3d") return "cgi3d";
  return "live-action"; // photorealistic / cinematic / documentary
}

/**
 * Serbest metin stil icin aile tahmini + sablon turune gore varsayilan.
 * Onemli: yanlis aile secilirse celiskili prompt olusur (or. anime + "skin pores").
 */
function resolveStyleFamily(templateType: string, customText: string | undefined, presetId: string | undefined): StyleFamily {
  if (templateType === "kids_animation") {
    if (presetId === "anime") return "anime2d";
    if (customText && /anime|manga|2d/i.test(customText)) return "anime2d";
    return "cgi3d";
  }
  if (presetId) return styleFamilyOfPreset(presetId);
  if (customText && /anime|manga|2d\s*cartoon|toon(?!ed)/i.test(customText)) return "anime2d";
  if (customText && /3d|pixar|cgi|animat/i.test(customText)) return "cgi3d";
  return "live-action";
}

/** Gorsel aileye uygun fiziksel/stilistik tutarlilik katmanini dondurur. */
function realismBlockForFamily(family: StyleFamily): string {
  if (family === "anime2d") return ANIME_STYLE_CONSISTENCY;
  if (family === "cgi3d") return ANIMATED_REALISM;
  return LIVE_ACTION_REALISM;
}

/** Sablon turune gore varsayilan stil tarifi. */
export function defaultStyleFor(_templateType: string): string {
  return VISUAL_STYLE_PRESETS.find((p) => p.id === "photorealistic")!.prompt;
}

/**
 * Gorsel anlati (longform) DRAMA kareleri: sinema kliplerindeki [STYLE] blogunun
 * birebir karsiligi — secilen preset (veya serbest metin) + ayni gerceklik katmani.
 * Bos ya da "documentary-stills" isaretinde varsayilan, gelistirilen sinematik
 * (ReelShort/NetShort) preset'tir; boylece iki hat ayni gorsel dili konusur.
 */
export function longformStillStyleText(visualStyle: string | null | undefined): string {
  const custom = visualStyle?.trim();
  const auto = !custom || custom === "documentary-stills";
  const preset = auto
    ? VISUAL_STYLE_PRESETS.find((p) => p.id === "cinematic")
    : VISUAL_STYLE_PRESETS.find((p) => p.id === custom);
  const base = preset ? preset.prompt : (custom as string);
  const family = resolveStyleFamily("longform", preset ? undefined : base, preset?.id);
  return `${base} ${realismBlockForFamily(family)}`;
}

/** Everest hatti: Pixar 3D, on+arka sheet kimligi, kilitli kostum, tek cekim, yazisiz kare. */
export const DEFAULT_KIDS_ANIMATION_TEMPLATE = `{{FLOW_CHARACTER}}[CAST LOCK — ANIMATED FILM]
Original animated characters only. Follow [STYLE]: 3D feature animation or 2D anime, never a mix, never live-action people, never a famous franchise or a real celebrity.
Same face, species, colors and costume in every clip. Match each uploaded front-and-back sheet exactly.
Broadcast-safe family film: no blood, no weapons, no injury.

[SPOKEN LINE — AUDIO FIRST]
The character speaks this exact {{LANGUAGE}} line on camera, word for word, filling the clip:

"{{DIALOGUE}}"

[STYLE]
{{STYLE}}

[CHARACTER REFERENCE]
{{CHARACTER_REFERENCE}}

[SCENE CONTINUITY]
{{SCENE_CONTINUITY}}

[WORLD]
{{WORLD_DETAIL}}

[CAMERA]
{{CAMERA}}

[PERFORMANCE]
{{PERFORMANCE}}

[AUDIO]
Spoken audio is {{LANGUAGE}} only. {{SPEECH_FIDELITY}} {{VOICE}}
They say exactly:
"{{DIALOGUE}}"

[ON-SCREEN TEXT]
{{SUBTITLES}}

[RESTRICTIONS]
{{NEGATIVE}}
One continuous take. No burned-in text of any kind. No background music.
`;

/** Sablon turune gore varsayilan Flow prompt sablonu. */
export function defaultTemplateFor(templateType: string, shotType = "narrator"): string {
  if (templateType === "kids_animation") return DEFAULT_KIDS_ANIMATION_TEMPLATE;
  if (templateType === "narrator") {
    return shotType === "narrator" ? DEFAULT_NARRATOR_TEMPLATE : DEFAULT_CUTAWAY_TEMPLATE;
  }
  if (shotType === "cutaway") return DEFAULT_CUTAWAY_TEMPLATE;
  return DEFAULT_NARRATOR_TEMPLATE;
}

export interface PromptContext {
  project: Pick<
    Project,
    | "templateType"
    | "speechLanguage"
    | "promptTemplate"
    | "useFlowCharacter"
    | "aspectRatio"
    | "visualStyle"
    | "allowSubtitles"
    | "emotionCurve"
    | "clipSeconds"
    | "useReference"
  > & { genre?: string | null; id?: string; topic?: string | null };
  character:
    | (Pick<
        CharacterProfile,
        | "baseAppearancePrompt"
        | "baseWardrobePrompt"
        | "baseEnvironmentPrompt"
        | "baseCameraPrompt"
        | "baseVoicePrompt"
        | "negativePrompt"
        | "flowCharacterReference"
      > & { name?: string })
    | null;
  clip: Pick<Clip, "dialogue" | "index" | "sceneDescription" | "voiceTone" | "imagePrompt" | "emotionLabel"> & {
    shotType?: string;
  };
  /** Kesit planinda sahnede gorunen kadro karakteri. */
  sceneCharacter?: Pick<CharacterProfile, "name" | "baseAppearancePrompt" | "baseWardrobePrompt" | "flowCharacterReference"> | null;
  /** Sahnedeki yan kadro (cocuk animasyonu + anlatici film) — yuz/kostum kilidi. */
  supportingCast?: Array<
    Pick<CharacterProfile, "name" | "role" | "baseAppearancePrompt" | "baseWardrobePrompt" | "flowCharacterReference" | "storyRole">
  >;
  /** Ilk klipte "onceki klip" referansi olmaz. */
  isFirstClip: boolean;
  /** Bir onceki klibin ozeti — seri sureklilik icin (dogrudan devam). */
  previousClip?: Pick<Clip, "index" | "sceneDescription" | "imagePrompt" | "dialogue" | "emotionLabel" | "voiceTone"> & {
    shotType?: string;
  } | null;
  /** Sabit sefer ekipmani kilidi (renk/malzeme) — klipler arasi bozulmasin. */
  storyGearLock?: string;
}

/** Sinema anlatici: cutaway = olay sahnesi (anlatici yok); shotType "narrator" = kadin kameraya anlatir. */
function isCutaway(ctx: PromptContext): boolean {
  if (ctx.project.templateType !== "narrator") return ctx.clip.shotType === "cutaway";
  return ctx.clip.shotType !== "narrator";
}

/**
 * Gorsel stil: cocuk sablonlarinda her zaman theatrical 3D/anime ailesi
 * zorlanir; narrator stilleri serbesttir. Gerceklik/tutarlilik katmani
 * SECILEN AILEYE gore secilir (canli-cekim / 3D CGI / 2D anime) — yanlis
 * aile secilirse celiskili prompt olusur (or. anime + "skin pores").
 */
function projectStyleFamily(ctx: PromptContext): StyleFamily {
  const custom = ctx.project.visualStyle?.trim();
  const preset = custom ? VISUAL_STYLE_PRESETS.find((p) => p.id === custom) : undefined;
  return resolveStyleFamily(ctx.project.templateType, custom, preset?.id);
}

/** Tum film boyunca ayni gerceklik/sureklilik kilidi (Flow kisaltmasinda dusmez). */
function realityLockForClip(ctx: PromptContext): string {
  if (ctx.project.templateType === "kids_animation") {
    const topic = (ctx.project.topic || "the story's own places and weather").replace(/\s+/g, " ").trim();
    return realityLockBlock({
      world: `one fictional 3D story world for the whole film, matching this premise: ${topic}`,
      crowd: "this film's original cast",
      family: projectStyleFamily(ctx),
      hasReferences: Boolean(ctx.project.useReference),
      castLine:
        "Other characters: only this film's original 3D cast, same colors and costumes, no live-action humans, no clones, no famous real people.",
    });
  }
  const seed = ctx.project.id || ctx.project.topic || "film";
  // Yalnizca projeye sabit metin: tek bir klibin repliginde gecen sehir o klibi baska sehre kaydirmasin.
  const story = ctx.project.topic || "";
  return realityLockBlock({
    world: presentDayWorld(ctx.project.speechLanguage, seed, story),
    crowd: `${filmCityFor(ctx.project.speechLanguage, seed, story).city} residents`,
    family: projectStyleFamily(ctx),
    hasReferences: Boolean(ctx.project.useReference),
  });
}

function styleBlock(ctx: PromptContext): string {
  const custom = ctx.project.visualStyle?.trim();
  const preset = custom ? VISUAL_STYLE_PRESETS.find((p) => p.id === custom) : undefined;

  const base = !custom ? defaultStyleFor(ctx.project.templateType) : preset ? preset.prompt : custom;
  const family = projectStyleFamily(ctx);
  const drama = ctx.project.templateType === "narrator" ? ` ${FEATURE_DRAMA_LOOK}` : "";
  return `${base} ${realismBlockForFamily(family)}${drama}`;
}

/**
 * Altyazi / ekran yazisi kontrolu.
 * Veo siklikla yanlis dilde veya kendiliginden altyazi basar; kapaliyken
 * yasak tekrarlanir ve prompt sonuna da sert kilit eklenir.
 */
function subtitlesBlock(_ctx: PromptContext): string {
  return [
    "HARD BAN — NO TEXT IN FRAME (NON-NEGOTIABLE):",
    "This exact rule is identical on EVERY clip of this film — clip 1 through clip 1000.",
    "Zero subtitles, captions, karaoke, titles, clothing tags, chalkboard letters, signs, posters, watermarks, UI or English auto-captions — 9:16 and 16:9. Audio only; clean picture.",
  ].join(" ");
}

/** Prompt sonuna yapisan son altyazi kilidi stampNoOnscreenTextLock kuyrugundadir. */

/**
 * Soz / sarki sadakati: duyulan ses, dudak hareketi ve yazili diyalog/soz
 * birebir ayni olsun (anlatici, cocuk hikaye, cocuk sarki).
 */
/**
 * Aldatma / yasak ask / ihanet: NetShort — sakin yikici + status, hüzün şiiri degil.
 * Bloğu kisa tut — Flow compact'ta SPOKEN LINE'dan hemen sonra kalır.
 */
function hardEmotionBlock(ctx: PromptContext): string {
  if (ctx.project.templateType !== "narrator") return "";
  const onCam = !isCutaway(ctx);
  return [
    "NETSHORT POWER DRAMA — NOT SOFT POEM:",
    isNarratorHardConflictGenre(ctx.project.genre)
      ? "HARD CONFLICT — NOT MELANCHOLY: cold resolve and status crush, never a sad poem."
      : "",
    onCam
      ? "She plays crushing humiliation OR cold devastating power — look-down dominance, bitter control. Soft whisper-host FORBIDDEN."
      : "On-screen: betrayal, status crush, look-down, slap/shove/slammed door. NO blood/weapons. Pretty frozen sadness FORBIDDEN.",
    netShortFlowEmotionCue(ctx.clip.emotionLabel),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Konusma, klip suresine orantili dolsun (8 sn sahnede 3-5 sn sessizlik YASAK). */
export function clipSpeechPaceLock(clipSeconds: number): string {
  const seconds = Math.max(4, Math.min(20, Math.round(clipSeconds) || 8));
  return `SPEECH PACING LOCK — ${seconds}s CLIP: fill the ${seconds}s; first word in second 1, last word in the final second. Do not rush the line into 3-5s then stand silent. Stretch the EXACT quote with breaths — never cut off mid-word.`;
}

function speechFidelityBlock(ctx: PromptContext): string {
  const lang = ctx.project.speechLanguage;
  const seconds = Math.max(4, Math.min(20, ctx.project.clipSeconds || 8));
  if (isCutaway(ctx)) {
    return [
      "NARRATION FIDELITY — NON-NEGOTIABLE:",
      `The off-screen narrator says ONLY the exact quoted lines in ${lang}, word for word.`,
      "No added phrases, no translation, no paraphrase. On-screen talent stays silent — no speaking lip movement.",
      clipSpeechPaceLock(seconds),
    ].join(" ");
  }
  return [
    "SPEECH FIDELITY — NON-NEGOTIABLE:",
    `Speak ONLY the exact quoted lines in ${lang}, word for word, in order. This is SPOKEN dialogue, not singing.`,
    `AUDIO LANGUAGE: ${lang} only. Do NOT speak English (or any other language) unless ${lang} itself is English.`,
    "Mouth shapes / visemes must match every spoken syllable of that audio (accurate lip-sync to the quoted line).",
    "Do not add, skip, reorder, paraphrase or translate words. Do not switch language mid-line. Do not hum or sing.",
    "Crisp diction first so each word is intelligible; emotional tone follows the line meaning.",
    clipSpeechPaceLock(seconds),
  ].join(" ");
}

function characterFidelityBlock(_ctx: PromptContext): string {
  return "";
}

function characterReferenceBlock(ctx: PromptContext): string {
  if (ctx.project.templateType === "kids_animation") {
    const hero = ctx.sceneCharacter?.baseAppearancePrompt ? ctx.sceneCharacter : ctx.character;
    const team = (ctx.supportingCast ?? [])
      .slice(0, 4)
      .map((member) => {
        const look = member.baseAppearancePrompt?.trim() || "";
        const costume = member.baseWardrobePrompt?.trim() || "";
        return `${member.name}${member.storyRole ? ` (${member.storyRole})` : ""}: ${look} Costume lock: ${costume}.`;
      })
      .filter((line) => line.trim().length > 8);
    return [
      "UPLOADED FRONT+BACK SHEETS are the identity bible. Match face, species, colors, costume and proportions. Do not redesign.",
      hero?.name ? `Speaking hero: ${hero.name}. Look: ${hero.baseAppearancePrompt || ""}. Costume lock: ${hero.baseWardrobePrompt || ""}.` : "",
      team.length ? `Rest of the cast, same every clip: ${team.join(" ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const c = ctx.character;
  const refActive = !!ctx.project.useReference && ctx.project.templateType !== "narrator";
  const hardLock = refActive
    ? [
          "UPLOADED REFERENCE IMAGE(S) = SOLO identity portraits (ground-truth identity).",
          "Each photo is exactly ONE character standing alone — not two people, not a couple, not a left/right split.",
          "Every frame must match those references 1:1 for face shape, eye color, species/silhouette, fur/hair pattern, costume colors, accessories, HEIGHT and body proportions.",
          "Do NOT invent a new design, recolor palette, change identity, morph species or swap outfits.",
          "If the model drifts even slightly from a reference, prefer the reference over any other description.",
        ].join(" ")
    : "";

  if (isCutaway(ctx)) {
    const onScreen: NonNullable<PromptContext["supportingCast"]> = [];
    const pushPerson = (
      person:
        | PromptContext["sceneCharacter"]
        | NonNullable<PromptContext["supportingCast"]>[number]
        | null
        | undefined
    ) => {
      const name = person?.name?.trim();
      if (!person || !name) return;
      if (onScreen.some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) return;
      onScreen.push({
        name,
        role: "role" in person && person.role ? person.role : "side",
        storyRole: "storyRole" in person ? person.storyRole || "" : "",
        baseAppearancePrompt: person.baseAppearancePrompt,
        baseWardrobePrompt: person.baseWardrobePrompt,
        flowCharacterReference: person.flowCharacterReference,
      });
    };
    pushPerson(ctx.sceneCharacter);
    for (const member of ctx.supportingCast ?? []) pushPerson(member);

    if (onScreen.length === 0) {
      return [
        "No featured portrait; if a figure appears, keep them distant, out of focus or seen from behind.",
        "Do not invent a new recurring face or morph extras into a named character.",
        "The narrator is NOT in this shot.",
      ].join(" ");
    }

    const parts = [
      hardLock,
      "Only the story adults in this beat may have a readable face. Follow wardrobe notes. Women: everyday light clothes — short dress or mini, slightly open neckline; no office-modest, no clubwear, no lingerie.",
    ];
    for (const person of onScreen) {
      const isLead =
        ctx.sceneCharacter?.name?.trim().toLowerCase() === person.name.trim().toLowerCase();
      const role = person.storyRole?.trim() || (isLead ? "the lead adult" : "another story adult");
      parts.push(
        [
          `${isLead ? "On screen (lead)" : "Also in frame"}: ${role}. Everyday neighbor face.`,
          person.baseWardrobePrompt ? `Wardrobe: ${person.baseWardrobePrompt}` : "",
          isLead ? "Stage what this adult DOES in the SHOT / PERFORMANCE blocks; other faces stay secondary or soft." : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    }
    parts.push("The narrator herself is NOT in this shot.");
    return parts.filter(Boolean).join(" ");
  }
  if (ctx.project.templateType === "narrator") {
    const parts: string[] = [];
    if (hardLock) parts.push(hardLock);
    parts.push(
      "This woman is the NARRATOR ON CAMERA — the cheated-on storyteller in a lived-in home, an ordinary adult, not a studio host."
    );
    parts.push(
      "Use the uploaded story-adult photo. Lived-in look: tired eyes, possible wet tears, rumpled clothes. Everyday neighbor, not a studio portrait."
    );
    if (c?.baseWardrobePrompt) parts.push(`Wardrobe: ${c.baseWardrobePrompt}`);
    return parts.join(" ");
  }
  const parts: string[] = [];
  if (hardLock) parts.push(hardLock);
  parts.push(
    "Use the uploaded story-adult photo. Everyday neighbor face, same wardrobe, stage the action."
  );
  if (c?.baseWardrobePrompt) parts.push(`Wardrobe: ${c.baseWardrobePrompt}`);
  return parts.join(" ");
}

function slimTaggedVisual(raw: string, max = 280): string {
  const tags = ["SHOT", "ON-SCREEN CAST LOCK", "EMOTION BEAT", "MATCH-ON-ACTION", "BRIDGE", "ENVIRONMENT", "CAST SIZE"];
  const parts: string[] = [];
  for (const tag of tags) {
    const m = raw.match(new RegExp(`\\[${tag}\\]\\s*([^\\[]+)`, "i"));
    if (m?.[1]) parts.push(`[${tag}] ${m[1].replace(/\s+/g, " ").trim().slice(0, 110)}`);
  }
  if (parts.length) return parts.join(" ").slice(0, max);
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

function sceneContinuityBlock(ctx: PromptContext): string {
  if (ctx.project.templateType === "kids_animation") {
    return ctx.isFirstClip
      ? "ONE continuous 3D short film. Opening take establishes the place with the hero alive, in costume, and speaking. Same world and costumes for every later clip."
      : "MATCH THE PREVIOUS CLIP: same 3D world, same faces, same costume colors, same time of day unless this line moves the story. Continue the action; do not redesign anyone.";
  }
  const c = ctx.character;
  const parts: string[] = [];
  if (ctx.project.templateType === "narrator") {
    const prev = ctx.previousClip;
    const prevWasNarrator = prev?.shotType === "narrator";
    const filmParts: string[] = [];
    if (isCutaway(ctx)) {
      filmParts.push(
        "ONE continuous short-drama film. CUTAWAY — narrator woman NOT in frame. Bodies follow the VO. No given names. Original fictional adults only."
      );
      if (ctx.isFirstClip) {
        filmParts.push("Opening take: establish THIS location from SHOT — lived-in, practical lights. Not studio sofa.");
      } else if (prevWasNarrator) {
        filmParts.push("SOFT CUT from confession into story world — pick up the beat; keep era/weather/locations.");
      } else {
        filmParts.push(
          "MATCH-ON-ACTION: continue previous clip's last second — same place/wardrobe/weather unless SHOT moves; advance one beat. No teleport."
        );
      }
    } else {
      filmParts.push("NARRATOR ON CAMERA in the same lived-in confession room — feature drama, not a commercial.");
      if (ctx.isFirstClip) {
        filmParts.push("Opening confession: establish her room; she is already in the emotion of the first line.");
      } else if (!prevWasNarrator) {
        filmParts.push("SOFT CUT back to the SAME confession room — same woman, wardrobe, space.");
      } else {
        filmParts.push("DIRECT CONTINUATION in confession room — same seat/spot, next sentence.");
      }
    }
    if (!ctx.isFirstClip && prev?.sceneDescription?.trim()) {
      filmParts.push(
        `Prev beat: ${stripCastNamesForFlow(prev.sceneDescription.trim().slice(0, 140), ctx.project.speechLanguage)}`
      );
    }
    if (!ctx.isFirstClip && prev?.imagePrompt?.trim()) {
      filmParts.push(
        `Prev visual: ${stripCastNamesForFlow(slimTaggedVisual(prev.imagePrompt, 160), ctx.project.speechLanguage)}`
      );
    }
    if (ctx.clip.imagePrompt?.trim()) filmParts.push(slimTaggedVisual(ctx.clip.imagePrompt, 300));
    return filmParts.join(" ");
  }
  if (ctx.isFirstClip) {
    parts.push(c?.baseEnvironmentPrompt || "A consistent, well-lit indoor environment.");
  } else {
    parts.push(
      "Use the same room, chair, background, lighting, camera height, camera distance, lens appearance and framing as the previous clip."
    );
    if (c?.baseEnvironmentPrompt) parts.push(`Environment: ${c.baseEnvironmentPrompt}`);
  }
  return parts.join(" ");
}

/**
 * Anlatici: mevcut SHOT/CONTINUITY bloklarini bozmadan tam mekan katmani.
 * Ic/dis/esik her yerde tavan veya gokyuzu, zemin, derinlik ve yasayan arka plan.
 */
function extractTaggedBlock(source: string, tag: string): string {
  const re = new RegExp(`\\[${tag}\\]\\s*([^\\[]+)`, "i");
  return source.match(re)?.[1]?.replace(/\s+/g, " ").trim() || "";
}

export function narratorWorldDetailBlock(imagePrompt: string, sceneDescription: string): string {
  const visual = `${imagePrompt || ""}\n${sceneDescription || ""}`;
  const setting = extractTaggedBlock(visual, "SETTING").toLowerCase();
  const env = extractTaggedBlock(visual, "ENVIRONMENT");
  const bg = extractTaggedBlock(visual, "BACKGROUND LAYERS") || extractTaggedBlock(visual, "BACKGROUND");
  const set = extractTaggedBlock(visual, "SET DRESSING");
  const atmo = extractTaggedBlock(visual, "ATMOSPHERE");
  const hasSpecific = Boolean(env || bg || set || atmo || setting);
  if (hasSpecific) {
    return [
      "LOCATION LOCK (inhabited; no empty studio):",
      setting ? `Setting: ${setting}.` : "",
      env ? `Env: ${env.slice(0, 160)}` : "",
      bg ? `BG: ${bg.slice(0, 120)}` : "",
      set ? `Dress: ${set.slice(0, 100)}` : "",
      atmo ? `Air: ${atmo.slice(0, 80)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "Dress this location as an inhabited world — ceiling/sky, floor, depth, practical lights. Never empty studio void.";
}

function worldDetailBlock(ctx: PromptContext): string {
  if (ctx.project.templateType === "kids_animation") {
    const scene = ctx.clip.sceneDescription?.replace(/\s+/g, " ").trim() || "";
    return [
      "A fully built 3D set with sky or ceiling, floor, depth, weather and props. A place that returns looks identical.",
      scene ? `This beat: ${scene.slice(0, 280)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (ctx.project.templateType !== "narrator") return "";
  return narratorWorldDetailBlock(ctx.clip.imagePrompt || "", ctx.clip.sceneDescription || "");
}

function cameraBlock(ctx: PromptContext): string {
  if (ctx.project.templateType === "kids_animation") {
    return "Feature 3D coverage, character readable head to toe or chest-up, deep set behind them, one gentle move, single continuous take, no cuts.";
  }
  if (isCutaway(ctx)) {
    return "NetShort coverage: MCU/CU or tight two-shot (max 1–2 faces). Prefer action then reaction CU across clips. One slow push/pan max. Single take, no cuts. Not beauty-ad, not empty b-roll.";
  }
  if (ctx.project.templateType === "narrator") {
    return "Intimate confession MCU: lived-in room, practical lamp, slight handheld. She may lean/look away. Not beauty-ad lock-off. Single take.";
  }
  return (
    ctx.character?.baseCameraPrompt ||
    "Fixed tripod camera. Medium close-up. No cuts, no zoom, no camera movement, no angle change."
  );
}

/**
 * Sinema anlatici oyunculugu. Klipler durgun gelmesin: sahnenin duygusu
 * (emotionLabel) bedende gorunur, her saniye fiziksel hareket vardir.
 * Yetiskin dram gerilimi (arzu, tahrik, kiskanclik, ofke) istenir; ancak
 * kiyafet uzerinde ve mahrem/cinsel eylem olmadan — aksi halde Veo reddeder.
 */
function cutawayPerformanceBlock(ctx: PromptContext): string {
  const seconds = Math.max(4, Math.min(20, ctx.project.clipSeconds || 8));
  const emotion = ctx.clip.emotionLabel?.replace(/\s+/g, " ").trim();
  const tone = ctx.clip.voiceTone?.replace(/\s+/g, " ").trim();
  const prevEmotion = ctx.previousClip?.emotionLabel?.replace(/\s+/g, " ").trim();
  const lead = ctx.sceneCharacter?.name?.trim();
  const isReaction =
    Boolean(emotion && /(tepki|pisman|yuzu dus|sok|kiril|reaction|regret|humiliat)/i.test(emotion)) ||
    (ctx.clip.index > 1 && Boolean(prevEmotion));
  return [
    "ACTED short-drama beat — not b-roll. Bodies and hands follow the VO. No given names.",
    lead ? "On screen: the story adult of this beat — body and action, not a portrait." : "",
    isReaction
      ? "REACTION TAKE: eyes/jaw/breath crack after the previous ACTION (insult, slap, shove, paper throw) — close-up allowed."
      : "ACTION TAKE: one clear power beat in the first 2s (look-down, shove, slap, door slam, paper throw, preferential smile). Next clip can be the crushed reaction.",
    emotion ? `EMOTION (must read on camera): ${emotion}.` : "EMOTION: play crush / dominance / humiliation / cold revenge — neutral decorative shot FORBIDDEN.",
    tone ? `Temp: ${tone}.` : "",
    prevEmotion ? `Hangover from prev: ${prevEmotion} — continue, do not reset.` : "",
    "POWER BODY: look-down, lean-in intimidation, turn-away victory, crushed collapse. Controlled violence OK (slap/shove/slam). NO blood, NO weapons, NO killing.",
    `ARC in ${seconds}s: second 0 ≠ last second.`,
    "MOVE every second — frozen tableau FORBIDDEN. One light camera move max.",
    ctx.clip.index >= 2 && ctx.clip.index <= 5
      ? `EARLY-MIDDLE #${ctx.clip.index}: energy UP — no soft melancholy b-roll.`
      : "",
    "Fully clothed; no nudity/sex. No on-camera talk (VO only).",
  ]
    .filter(Boolean)
    .join(" ");
}

function narratorOnCameraPerformanceBlock(ctx: PromptContext): string {
  const seconds = Math.max(4, Math.min(20, ctx.project.clipSeconds || 8));
  const emotion = ctx.clip.emotionLabel?.replace(/\s+/g, " ").trim();
  const tone = ctx.clip.voiceTone?.replace(/\s+/g, " ").trim();
  const prevEmotion = ctx.previousClip?.emotionLabel?.replace(/\s+/g, " ").trim();
  return [
    "FEATURE-FILM CONFESSION: this woman is ON CAMERA and SPEAKS the quoted line to camera in a lived-in room — ordinary adult, not a studio host.",
    emotion
      ? `EMOTION FOR THIS TAKE (NON-NEGOTIABLE — unmistakable): ${emotion}.`
      : "EMOTION FOR THIS TAKE: play the real feeling of the line (heartbreak, rage, shame, fear, numbness that cracks) — pretty-neutral posing is FORBIDDEN.",
    tone ? `Voice/body temperature: ${tone}.` : "",
    prevEmotion ? `Emotional hangover from the previous take: ${prevEmotion} — continue, do not reset to calm host energy.` : "",
    "She may deliver a COLD devastating line, CRY as RAGE when it fits, raise her voice OCCASIONALLY, slam a table, stand and sit, turn away in victory. Frozen sofa posing and pretty melancholy are forbidden. Endless shouting is forbidden.",
    `EMOTIONAL ARC INSIDE THE ${seconds}s: second 0 is not identical to the last second — the confession cracks, goes cold, or swells.`,
    clipSpeechPaceLock(seconds),
    "BROADCAST SAFE: fully clothed; no nudity, no graphic violence. Tears and a raised voice are allowed.",
  ]
    .filter(Boolean)
    .join(" ");
}

function performanceBlock(ctx: PromptContext): string {
  if (ctx.project.templateType === "kids_animation") {
    return "Theatrical 3D acting. Lip-sync the quoted line. A gesture or step every second. Kid-safe, no injury. Emotion comes from the line. Not a frozen portrait.";
  }
  if (isCutaway(ctx)) return cutawayPerformanceBlock(ctx);
  if (ctx.project.templateType === "narrator") return narratorOnCameraPerformanceBlock(ctx);
  return "She remains seated and looks naturally toward the camera. Natural blinking, subtle facial expressions, minimal head movement and restrained hand gestures. Do not make her stand up or change position.";
}

function voiceBlock(ctx: PromptContext): string {
  if (ctx.project.templateType === "kids_animation") {
    const parts = [
      "Same 3D character voice in every clip. Clear speech, lip-sync the quote. Warm story acting, not a presenter and not a song.",
    ];
    if (ctx.character?.baseVoicePrompt) parts.push(`Voice identity: ${ctx.character.baseVoicePrompt}.`);
    return parts.join(" ");
  }
  // Sinema klibinde sesi Veo uretir; TTS oyunculuk ayarlari oraya gecmez.
  // Ayni duygu haritasi burada yazili yonetmen notuna cevrilir.
  const direction = flowVoiceDirection(ctx.clip.emotionLabel, ctx.clip.voiceTone);
  if (isCutaway(ctx)) {
    const parts = [
      "The narrator voice-over keeps the exact same voice identity, accent and pitch across every clip of this film.",
      isNarratorHardConflictGenre(ctx.project.genre)
        ? "Delivery is NetShort short-drama VO: cold devastating lines, bitter control, occasional crack or raised voice — not endless shouting and not a sad commercial whisper. Match the quote's heat."
        : "Delivery is lived-in drama, not a calm commercial VO: broken voice, tears in the throat, a raised shout that cracks — when the line demands it.",
    ];
    if (ctx.character?.baseVoicePrompt) parts.push(`Voice identity: ${ctx.character.baseVoicePrompt}.`);
    if (ctx.clip.voiceTone) parts.push(`Emotional delivery for this clip: ${ctx.clip.voiceTone}.`);
    if (direction) parts.push(direction);
    return parts.join(" ");
  }
  if (ctx.project.templateType === "narrator") {
    const parts = [
      "Same woman, same voice identity as every other narrator take of this film.",
      isNarratorHardConflictGenre(ctx.project.genre)
        ? "She speaks ON CAMERA: cold devastating OR bitter — never a polished presenter, never melancholic poetry reading, never endless shout-host. Match the quote."
        : "She speaks ON CAMERA: cracked, tearful, angry or numb — never a polished presenter.",
    ];
    if (ctx.character?.baseVoicePrompt) parts.push(`Voice identity: ${ctx.character.baseVoicePrompt}.`);
    if (ctx.clip.voiceTone) parts.push(`Emotional delivery for this clip: ${ctx.clip.voiceTone}.`);
    if (direction) parts.push(direction);
    return parts.join(" ");
  }
  const parts: string[] = [
    ctx.isFirstClip
      ? "Keep a single consistent voice identity, accent, pitch, pace and emotional tone throughout the clip."
      : "Keep the same voice identity, accent, pitch, pace and emotional tone as the previous clip.",
  ];
  if (ctx.character?.baseVoicePrompt) parts.push(`Voice: ${ctx.character.baseVoicePrompt}.`);
  if (ctx.clip.voiceTone) parts.push(`Emotional delivery for this clip: ${ctx.clip.voiceTone}.`);
  if (direction) parts.push(direction);
  return parts.join(" ");
}

function musicBlock(_ctx: PromptContext): string {
  return "";
}

function sceneNotesBlock(ctx: PromptContext): string {
  if (isCutaway(ctx)) {
    const scene = ctx.clip.sceneDescription?.trim() || "";
    const visual = stripEmbeddedOnscreenTextTails(ctx.clip.imagePrompt?.trim() || "");
    const shot = extractTaggedBlock(visual, "SHOT");
    const timeline = visual.match(/\[TIMELINE[^\]]*\]\s*([^[]+)/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
    const motion = extractTaggedBlock(visual, "MOTION");
    const emotion = extractTaggedBlock(visual, "EMOTION BEAT");
    const env = extractTaggedBlock(visual, "ENVIRONMENT");
    const parts = [
      scene ? `Scene: ${scene}` : "",
      shot ? `Directed shot: ${shot}` : "",
      timeline ? `Seconds: ${timeline}` : "",
      motion ? `Motion: ${motion}` : "",
      emotion ? `Emotion: ${emotion}` : "",
      env ? `Environment: ${env}` : "",
    ].filter(Boolean);
    if (parts.length) return parts.join("\n");
    if (visual) return visual.slice(0, 700);
    return scene || "A lived-in real-world cinema shot that stages every concrete place, object, weather and person named in the narration.";
  }
  return ctx.clip.sceneDescription ? `Scene: ${ctx.clip.sceneDescription}` : "";
}

/**
 * Fiziksel dunya gercekciligi (cocuk animasyonu).
 *
 * Hicbir temaya ozel ekipman/mekan metni YOKTUR: sahne hangi ortami tarif
 * ediyorsa fizik ona gore istenir, tekrar eden esyalar ise projenin kendi
 * tema prop kilidinden (storyGearLock) gelir.
 */
function adventureRealismBlock(_ctx: PromptContext): string {
  return "";
}

/** Cizgi film / sinema yonetmenligi detaylari. */
function cinematicCraftBlock(_ctx: PromptContext): string {
  return "";
}

/**
 * Sozlerde gecen nesne/sayi ile kadroyu kilitler.
 * Ornek: "kac vagon 1 2 3" -> ekranda sayilabilir vagonlar zorunlu.
 */
function lyricVisualLockBlock(_ctx: PromptContext): string {
  return "";
}

/** Hikaye/diyalog kelimelerinin gorsel sadakati. */
function dialogueVisualLockBlock(ctx: PromptContext): string {
  if (ctx.project.templateType !== "narrator") return "";
  const dial = ctx.clip.dialogue?.replace(/\s+/g, " ").trim() || "";
  return [
    "STORY-WORD VISUAL LOCK (CINEMA — PICTURE ONLY):",
    "Stage people, places, weather and objects named in SHOT. Speech is AUDIO only — never paint letters on the picture.",
    dial ? `Spoken line stays AUDIO (never a subtitle).` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function negativeBlock(ctx: PromptContext): string {
  const parts: string[] = [];
  parts.push(
    "Negative constraints: no subtitles, no captions, no karaoke text, no on-screen writing, no clothing labels, no chalkboard letters, no logos, no watermarks, no burned-in dialogue text."
  );
  if (ctx.project.templateType === "narrator") {
    parts.push(
      "Also forbid: glossy beauty-ad lighting, catalog posing, perfume-commercial sheen, plastic skin, empty hotel interiors, frozen pretty sadness, sitting-still product-ad talking-head."
    );
  }
  if (ctx.project.templateType === "kids_animation") {
    parts.push(
      "Also forbid: live-action humans, photoreal skin, celebrity likeness, blood, weapons, injury, costume redesign, species swap."
    );
  }
  const negative = ctx.character?.negativePrompt?.trim();
  if (negative) parts.push(`Additional restrictions: ${negative}`);
  return parts.join(" ");
}

function flowCharacterBlock(ctx: PromptContext): string {
  // Kesitte @ ana kadin yok. Kameradaki itirafta ana kadin @ ile gelir.
  if (ctx.project.templateType === "narrator") {
    if (!ctx.project.useFlowCharacter) return "";
    const refs: string[] = [];
    const norm = (r: string) => r.replace(/^@+/, "").trim().toLowerCase();
    const pushRef = (raw: string | null | undefined) => {
      const t = raw?.trim();
      if (!t) return;
      const withAt = t.startsWith("@") ? t : `@${t}`;
      if (refs.some((r) => norm(r) === norm(withAt))) return;
      refs.push(withAt);
    };
    if (!isCutaway(ctx)) {
      pushRef(ctx.character?.flowCharacterReference);
    } else {
      pushRef(ctx.sceneCharacter?.flowCharacterReference);
      for (const member of ctx.supportingCast ?? []) {
        if (member.role === "main") continue;
        pushRef(member.flowCharacterReference);
      }
    }
    if (refs.length === 0) return "";
    return `${refs.join("\n")}\n\n`;
  }
  // Flow @karakter etiketleri YALNIZCA proje ayari aciksa — kapaliyken yan
  // karakter @Ada/@Ruzgar satirlari ana kahramani ezip videoda yok edebiliyordu.
  if (!ctx.project.useFlowCharacter) return "";

  const refs: string[] = [];
  const norm = (r: string) => r.replace(/^@+/, "").trim().toLowerCase();
  const pushRef = (raw: string | null | undefined) => {
    const t = raw?.trim();
    if (!t) return;
    const withAt = t.startsWith("@") ? t : `@${t}`;
    if (refs.some((r) => norm(r) === norm(withAt))) return;
    refs.push(withAt);
  };

  // Ana kahraman her zaman ilk @ — Flow once onu baglasin
  pushRef(ctx.character?.flowCharacterReference);

  for (const member of ctx.supportingCast ?? []) {
    if (member.role === "main") continue;
    if (ctx.character?.name && member.name?.trim().toLowerCase() === ctx.character.name.trim().toLowerCase()) continue;
    pushRef(member.flowCharacterReference);
  }
  if (refs.length === 0) return "";
  return `${refs.join("\n")}\n\n`;
}

/** Tek klip icin nihai Flow promptunu uretir. */
export function buildClipPrompt(ctx: PromptContext): string {
  const template =
    ctx.project.templateType === "kids_animation"
      ? DEFAULT_KIDS_ANIMATION_TEMPLATE
      : ctx.project.templateType === "narrator"
        ? isCutaway(ctx)
          ? DEFAULT_CUTAWAY_TEMPLATE
          : DEFAULT_NARRATOR_TEMPLATE
        : isCutaway(ctx)
          ? DEFAULT_CUTAWAY_TEMPLATE
          : ctx.project.promptTemplate?.trim() || defaultTemplateFor(ctx.project.templateType, ctx.clip.shotType);

  const subtitleCtx: PromptContext = { ...ctx, project: { ...ctx.project, allowSubtitles: false } };

  const replacements: Record<string, string> = {
    STYLE: styleBlock(ctx),
    CHARACTER_REFERENCE: characterReferenceBlock(ctx),
    CHARACTER_FIDELITY: characterFidelityBlock(ctx),
    SCENE_CONTINUITY: sceneContinuityBlock(ctx),
    CAMERA: cameraBlock(ctx),
    PERFORMANCE: performanceBlock(ctx),
    VOICE: voiceBlock(ctx),
    LANGUAGE: ctx.project.speechLanguage,
    DIALOGUE: ctx.clip.dialogue.replace(/"/g, "'"),
    HARD_EMOTION: hardEmotionBlock(ctx),
    SUBTITLES: subtitlesBlock(subtitleCtx),
    SPEECH_FIDELITY: speechFidelityBlock(ctx),
    NEGATIVE: negativeBlock(subtitleCtx),
    FLOW_CHARACTER: flowCharacterBlock(ctx),
    SCENE_NOTES: sceneNotesBlock(ctx),
    MUSIC: musicBlock(ctx),
    LYRIC_VISUAL_LOCK: lyricVisualLockBlock(ctx),
    DIALOGUE_VISUAL_LOCK: dialogueVisualLockBlock(ctx),
    ADVENTURE_REALISM: adventureRealismBlock(ctx),
    CINEMATIC_CRAFT: cinematicCraftBlock(ctx),
    WORLD_DETAIL: worldDetailBlock(ctx),
  };

  let prompt = template;
  for (const [key, value] of Object.entries(replacements)) {
    prompt = prompt.split(`{{${key}}}`).join(value);
  }

  // Eski/ozel sablonlarda {{SPEECH_FIDELITY}} veya [ON-SCREEN TEXT] yoksa
  // kurallari yine de ekle — Veo altyazi/soz sapmasini engellemek icin.
  if (!template.includes("{{SPEECH_FIDELITY}}")) {
    prompt = `${prompt}\n\n[SPEECH / LYRIC LOCK]\n${speechFidelityBlock(ctx)}`;
  }
  if (!template.includes("{{SUBTITLES}}") && !template.includes("[ON-SCREEN TEXT]")) {
    prompt = `${prompt}\n\n[ON-SCREEN TEXT]\n${subtitlesBlock(subtitleCtx)}`;
  }
  if (
    ctx.project.templateType === "narrator" &&
    !template.includes("{{DIALOGUE_VISUAL_LOCK}}") &&
    !/\[STORY WORD/i.test(prompt)
  ) {
    const lock = dialogueVisualLockBlock(ctx);
    if (lock) prompt = `${prompt}\n\n[STORY WORD → PICTURE LOCK]\n${lock}`;
  }

  // Altyazi yasagi stampNoOnscreenTextLock ile basa+sona yapisir (SABIT KURAL + FINAL HARD LOCK).

  // Dil kilidi en basa (Flow uzun promptlarda ortayi kesebiliyor / oncelik baslarda)
  const lang = ctx.project.speechLanguage?.trim() || "Turkish";
  const speechLangLock = [
    "[SPEECH LANGUAGE LOCK — NON-NEGOTIABLE]",
    `Spoken audio MUST be ${lang} only.`,
    `All audible dialogue MUST be ${lang}. Do not switch language. Especially do not switch to English unless ${lang} itself is English.`,
    `Deliver the quoted dialogue verbatim in ${lang} — never translate or paraphrase.`,
  ].join(" ");

  if (!/\[SPEECH LANGUAGE LOCK/i.test(prompt)) {
    const atRefs = prompt.match(/^(?:@[^\n]+\n)+/);
    if (atRefs) {
      prompt = `${atRefs[0]}\n${speechLangLock}\n\n${prompt.slice(atRefs[0].length).replace(/^\n+/, "")}`;
    } else {
      prompt = `${speechLangLock}\n\n${prompt}`;
    }
  }

  if (ctx.project.useReference && !/\[IDENTITY LOCK/i.test(prompt)) {
    const onScreenNames = [
      ctx.sceneCharacter?.name?.trim(),
      ...(ctx.supportingCast ?? []).map((m) => m.name?.trim()),
    ].filter(Boolean) as string[];
    const identityLock =
      ctx.project.templateType === "kids_animation"
        ? [
            "[IDENTITY LOCK]",
            "Uploaded sheets are front-and-back 3D character bibles. Match species, colors, costume and proportions exactly.",
            "Not live-action people. Not a famous franchise. One consistent 3D cast for the whole film.",
          ].join(" ")
        : ctx.project.templateType === "narrator"
        ? isCutaway(ctx)
          ? onScreenNames.length
            ? [
                "[IDENTITY LOCK]",
                "Uploaded photos are story-adult stills — exactly ONE adult per photo, not a couple.",
                "Same ordinary neighbor adults every time, never the narrator. Everyday clothes. Stage the action.",
                "Do not invent extras or swap people between clips.",
              ].join(" ")
            : [
                "[IDENTITY LOCK]",
                "No featured portrait. Keep extras distant or from behind.",
                "CUTAWAY: the narrator woman is NOT in this shot.",
              ].join(" ")
          : [
              "[IDENTITY LOCK]",
              "Uploaded photo is the storyteller woman (exactly one woman, not a couple).",
              "Same ordinary adult each narrator take. Lived-in drama look — not a studio host.",
            ].join(" ")
        : [
            "[IDENTITY LOCK]",
            "Uploaded photos are story-adult stills (exactly one person per photo).",
            "Keep wardrobe and silhouette consistent. Everyday neighbor faces. Stage the action.",
          ]
            .filter(Boolean)
            .join(" ");
    const atRefs = prompt.match(/^(?:@[^\n]+\n)+/);
    if (atRefs) {
      prompt = `${atRefs[0]}\n${identityLock}\n\n${prompt.slice(atRefs[0].length).replace(/^\n+/, "")}`;
    } else if (/\[SPEECH LANGUAGE LOCK/i.test(prompt)) {
      prompt = prompt.replace(/(\[SPEECH LANGUAGE LOCK[\s\S]*?\n\n)/, `$1${identityLock}\n\n`);
    } else {
      prompt = `${identityLock}\n\n${prompt}`;
    }
  }

  if (!prompt.includes(REALITY_LOCK_TAG)) {
    const reality = realityLockForClip(ctx);
    if (/\[IDENTITY LOCK\][^\n]*\n\n/.test(prompt)) {
      prompt = prompt.replace(/(\[IDENTITY LOCK\][^\n]*\n\n)/, `$1${reality}\n\n`);
    } else if (/\[SPEECH LANGUAGE LOCK[\s\S]*?\n\n/.test(prompt)) {
      prompt = prompt.replace(/(\[SPEECH LANGUAGE LOCK[\s\S]*?\n\n)/, `$1${reality}\n\n`);
    } else {
      prompt = `${reality}\n\n${prompt}`;
    }
  }

  // Bos bloklardan kalan fazla bos satirlari sadelestir
  prompt = prompt.replace(/\n{3,}/g, "\n\n").trim();
  prompt = prepareLiveActionFlowPrompt(prompt);
  return stampNoOnscreenTextLock(prompt);
}

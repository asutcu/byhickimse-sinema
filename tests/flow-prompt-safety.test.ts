import { describe, expect, it } from "vitest";
import {
  compactPromptForFlow,
  ensureNoOnscreenTextLock,
  FLOW_NO_ONSCREEN_TEXT_HEAD,
  FLOW_NO_ONSCREEN_TEXT_TAIL,
  FLOW_PROMPT_MAX,
  isStillImagePrompt,
  stampNoOnscreenTextLock,
} from "@/lib/flow-prompt-compact";
import {
  anonymizeCastForPolicyRetry,
  bypassPolicyBlockedPrompt,
  ensureAnimatedCastLock,
  FLOW_FICTIONAL_PERSON_LOCK,
  flowGenderLock,
  flowStoryCastForGender,
  isPolicyRetryPending,
  policyFailCountFromMessage,
  policyMarkerForFailCount,
  prepareLiveActionFlowPrompt,
  rewritePromptAfterPolicyBlock,
  sanitizeCelebrityLikenessForFlow,
  sanitizeKidsPromptForFlow,
  defuseNameAndFacePolicyTriggers,
} from "@/lib/flow-prompt-safety";

describe("Flow yayin-guvenli prompt süzgeci", () => {
  it("taninmis kisi reddinde soylenen cumledeki tarihi adi unvana cevirir", () => {
    const raw = `[SPOKEN LINE]\n"Kanuni'nin selamlık alayını izledim, Hürrem uzaktan geçti."\n[SHOT] Kanuni rides past.`;
    const out = rewritePromptAfterPolicyBlock(raw, 1);
    expect(out).not.toMatch(/Kanuni|Hürrem/);
    expect(out).toMatch(/padişah/);
    expect(out).toMatch(/saraydan bir kadın/);
    expect(out).toMatch(/the sultan/);
  });

  it("toddler / kiss / yüze dokun dilini mascot diline cevirir", () => {
    const raw = [
      "Not a toddler voice. Readable for toddlers.",
      "YouTube-kids music video, kid-safe, kid-eye height.",
      "She touches her nose, foam kiss at kiss, skin texture visible.",
      "Do not age-swap. Hip sway. Children's backing track.",
    ].join(" ");
    const clean = sanitizeKidsPromptForFlow(raw);
    expect(clean).not.toMatch(/toddler/i);
    expect(clean).not.toMatch(/\bkiss/i);
    expect(clean).not.toMatch(/touches her nose/i);
    expect(clean).not.toMatch(/age-swap/i);
    expect(clean).not.toMatch(/hip sway/i);
    expect(clean).not.toMatch(/kid-safe/i);
    expect(clean).toMatch(/mascot singing voice|points to her own nose|foam heart bubble|broadcast-safe/i);
  });

  it("tirnakli sozlerdeki opucuk / kiss dilini de temizler", () => {
    const raw = `Director note: foam kiss. Lyrics: "Fokur fokur, köpükle öpücük — hadi!"`;
    const clean = sanitizeKidsPromptForFlow(raw);
    expect(clean).toContain('"Fokur fokur, köpükle kalp — hadi!"');
    expect(clean).toContain("foam heart bubble");
    expect(clean).not.toContain("foam kiss");
    expect(clean).not.toMatch(/öpücük|kiss/i);
  });

  it("muzikal minor key ifadesini bozmaz", () => {
    const clean = sanitizeKidsPromptForFlow("Exactly 118 BPM, in A minor, bright mood.");
    expect(clean).toContain("A minor");
  });

  it("den1 tarzi kirli yonetmen metnini Flow'a gitmeden temizler", () => {
    const raw = [
      "3D CGI kids animation, Feature-film kids animation, kid-safe, age-safe.",
      "true lip-sync, accurate lip-sync, Mouth shapes match every spoken syllable.",
      "sweat/skin sheen, skin/ears/fur, fur/skin pattern, photographic skin texture.",
      "Photoreal humans are forbidden. Do not age-swap.",
      "kid‑choir, YouTube kids, patio kids' silhouettes, hip sway.",
      "She touches her nose. blowing a gentle foamy kiss near Kokona's cheek.",
    ].join(" ");
    const clean = sanitizeKidsPromptForFlow(raw);
    expect(clean).not.toMatch(/toddler|kiss|öpücük|lip-sync|age-swap|kid-safe|YouTube kids|hip sway/i);
    expect(clean).not.toMatch(/\bskins?\b/i);
    expect(clean).not.toMatch(/\bkids\b/i);
    expect(clean).not.toMatch(/photoreal humans/i);
    expect(clean).toMatch(/syllable-sync|foam heart|points to her own nose|broadcast-safe|surface/i);
    expect(sanitizeKidsPromptForFlow("forming kiss-heart; the kiss; kiss heart")).not.toMatch(/kiss/i);
    expect(sanitizeKidsPromptForFlow("booping her nose, fingertip on the nose")).not.toMatch(/boop|fingertip/i);
    const body = sanitizeKidsPromptForFlow(
      "Tiny steam sprite. Petite and buoyant; big head (1:2) with wispy hair; head 1:2 body. cuddly adult voice, family-friendly, never suddenly younger/older."
    );
    expect(body).not.toMatch(/petite|big head|1:2|cuddly|family-friendly|younger\/older|Tiny steam sprite/i);
    expect(body).toMatch(/Adult cartoon steam-sprite barista|adult-mascot|warm adult mascot voice/i);
  });

  it("CAST LOCK ekler ve @referansi korur", () => {
    const locked = ensureAnimatedCastLock("@Kokona Kopuk\n\n[SHOT] dance");
    expect(locked.startsWith("@Kokona Kopuk")).toBe(true);
    expect(locked).toContain("[CAST LOCK — ANIMATED MASCOT]");
    expect(locked).toMatch(/cartoon mascot/i);
    expect(locked).not.toMatch(/\bchild\b|\bminor\b|\btoddler\b/i);
  });

  it("chalkboard menu yazisini harfsiz dekoratif tahtaya cevirir", () => {
    const clean = sanitizeKidsPromptForFlow("Background: wood shelves, a chalkboard menu, sunlit window.");
    expect(clean).toContain("blank chalkboard with decorative swirls and no letters");
    expect(clean).not.toMatch(/chalkboard menu/i);
  });
});

describe("Flow prompt kisaltmasi yazi yasagini dusurmez", () => {
  it("uzun promptta bas ve son kilitleri korur, diyalogu atmaz", () => {
    const huge = [
      "[STYLE] " + "pixar look ".repeat(400),
      "[SHOT] " + "cafe dance ".repeat(400),
      "[SCENE CONTINUITY] same cafe, next seconds.",
      "[AUDIO] The character SINGS these original lyrics in Turkish.",
      'SINGS lyrics in Turkish: "Ayak tap tap, burun tık tık, el şap şap!"',
      "[ON-SCREEN TEXT] HARD BAN — NO TEXT IN FRAME",
      "[RESTRICTIONS] no horror",
      "[FINAL HARD LOCK — ON-SCREEN TEXT] old lock",
    ].join("\n\n");
    const { text, truncated } = compactPromptForFlow(huge, "Turkish", 2000);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain(FLOW_NO_ONSCREEN_TEXT_HEAD);
    expect(text.endsWith(FLOW_NO_ONSCREEN_TEXT_TAIL) || text.includes(FLOW_NO_ONSCREEN_TEXT_TAIL)).toBe(true);
    expect(text).toContain("Ayak tap tap");
    expect(text).toMatch(/\[SPEECH LANGUAGE LOCK/);
  });

  it("kilit yoksa kisa prompta da bas+son yasak ekler", () => {
    const locked = ensureNoOnscreenTextLock("[SHOT] dance\n\n[AUDIO] sings");
    expect(locked.startsWith(FLOW_NO_ONSCREEN_TEXT_HEAD)).toBe(true);
    expect(locked).toContain(FLOW_NO_ONSCREEN_TEXT_TAIL);
    expect(locked).toContain("[SABIT KURAL — ALTYAZI YOK]");
    expect(locked).toContain("[SABIT KURAL SONU — ALTYAZI YOK]");
  });

  it("ozel sablon damgasiz olsa bile ayni kilit yapisir", () => {
    const a = ensureNoOnscreenTextLock("clip 1 custom template only");
    const b = ensureNoOnscreenTextLock("clip 1000 totally different body");
    expect(a).toContain(FLOW_NO_ONSCREEN_TEXT_HEAD);
    expect(b).toContain(FLOW_NO_ONSCREEN_TEXT_HEAD);
    expect(a.slice(0, FLOW_NO_ONSCREEN_TEXT_HEAD.length)).toBe(b.slice(0, FLOW_NO_ONSCREEN_TEXT_HEAD.length));
  });

  it("ortadaki kuyruk damgasi AUDIO/diyalogu yemez", () => {
    const quote = "Cam buğusuna parmağımla hiçbir şey yazmadım.";
    const messy = [
      "@Deniz",
      FLOW_NO_ONSCREEN_TEXT_HEAD,
      "[SHOT] fogged taxi glass, rain outside",
      FLOW_NO_ONSCREEN_TEXT_TAIL,
      "[AUDIO]",
      "A female narrator voice-over says exactly, off screen:",
      `"${quote}"`,
      "[RESTRICTIONS] Nobody on screen moves their lips.",
    ].join("\n\n");
    const stamped = stampNoOnscreenTextLock(messy);
    expect(stamped).toContain(quote);
    expect(stamped).toContain("[AUDIO]");
    expect(stamped).toContain("Nobody on screen moves their lips");
    const { text } = compactPromptForFlow(stamped, "Turkish", 1800);
    expect(text).toContain(quote);
    expect(text.indexOf(quote)).toBeLessThan(700);
  });

  it("kesitte gomulu kuyruk olsa bile compact tirnakli sozu basa koyar", () => {
    const quote = "Deniz, anahtarlığın dişlerine bastım, telefon avucumda titredi.";
    const hugeShot = "[SHOT] " + "wet street taxi rain ".repeat(400);
    const full = [
      "@Kerem",
      hugeShot,
      FLOW_NO_ONSCREEN_TEXT_TAIL,
      "[AUDIO]",
      "A female narrator voice-over says exactly, off screen:",
      `"${quote}"`,
      "[RESTRICTIONS] no subtitles",
    ].join("\n\n");
    const { text, truncated } = compactPromptForFlow(full, "Turkish", 2000);
    expect(truncated).toBe(true);
    expect(text).toContain(quote);
    expect(text).toMatch(/\[SPOKEN LINE/);
    const shotAt = text.indexOf("[SHOT]");
    expect(text.indexOf(quote)).toBeLessThan(shotAt === -1 ? text.length : shotAt);
  });

  it("kisaltmada STORY CAST kalir ve 8000 sinirini asmaz", () => {
    const huge = [
      "@Emre",
      FLOW_FICTIONAL_PERSON_LOCK,
      "[SHOT] " + "wet street taxi rain ".repeat(500),
      "[STYLE] Photorealistic live-action footage, celebrity lookalike",
      "[AUDIO]",
      'A female narrator voice-over says exactly, off screen:',
      '"Kapıyı kapattım."',
    ].join("\n\n");
    const { text, truncated } = compactPromptForFlow(huge, "Turkish", FLOW_PROMPT_MAX);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThan(8000);
    expect(text).toContain("[STORY CAST]");
    expect(text).toMatch(/ordinary neighbor/i);
    expect(text).not.toMatch(/celebrity|photorealistic/i);
    expect(text).toContain("Kapıyı kapattım");
  });

  it("gorsel anlati karesinde STILL BEAT ve isimler 8000 icinde kalir, konusma kilidi eklenmez", () => {
    const huge = [
      FLOW_FICTIONAL_PERSON_LOCK,
      "[STILL BEAT] STORY PHASE: humiliation. ETKI still. On-screen named adults only (max 4): Kerem, Lina. CONTINUITY LOCK: same location.",
      "[NETSHORT STILL] 16:9 cinematic freeze.",
      "[STYLE] " + "luxury office rain glass ".repeat(400),
    ].join("\n\n");
    expect(isStillImagePrompt(huge)).toBe(true);
    const { text, truncated } = compactPromptForFlow(huge, "Turkish", 2200);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2200);
    expect(text.length).toBeLessThan(8000);
    expect(text).toContain("[STILL BEAT]");
    expect(text).toContain("Kerem");
    expect(text).toContain("Lina");
    expect(text).toContain("[WARDROBE COVER]");
    expect(text).toContain("[NETSHORT STILL]");
    expect(text).not.toMatch(/SPEECH LANGUAGE LOCK/);
  });

  it("mascot videosuna kadin etek / STORY CAST kilidi basmaz", () => {
    const huge = [
      "[CAST LOCK — ANIMATED MASCOT] cartoon steam-sprite barista",
      "[STYLE] " + "pixar look ".repeat(400),
      "[AUDIO] The character SINGS these original lyrics in Turkish.",
      'SINGS lyrics in Turkish: "Ayak tap tap, burun tık tık!"',
    ].join("\n\n");
    const { text, truncated } = compactPromptForFlow(huge, "Turkish", 2000);
    expect(truncated).toBe(true);
    expect(text).toContain("[CAST LOCK — ANIMATED MASCOT]");
    expect(text).toContain("Ayak tap tap");
    expect(text).not.toMatch(/WARDROBE COVER/);
    expect(text).not.toMatch(/\[STORY CAST\]/);
    expect(text.length).toBeLessThan(8000);
  });

  it("erkek STORY CAST sikismada kadin etegine donmez", () => {
    const huge = [
      "[STORY CAST] Ordinary male neighbor from this story only: natural male face, everyday menswear. [GENDER LOCK] Adult man from this story (male).",
      "[SHOT] " + "wet street taxi rain ".repeat(400),
      "[AUDIO]",
      "A female narrator voice-over says exactly, off screen:",
      '"Kapıyı kapattım."',
    ].join("\n\n");
    const { text } = compactPromptForFlow(huge, "Turkish", 2200);
    expect(text).toContain("[STORY CAST]");
    expect(text).toMatch(/Adult man from this story \(male\)/);
    expect(text).not.toMatch(/WARDROBE COVER/);
    expect(text).toContain("Kapıyı kapattım");
    expect(text.length).toBeLessThan(8000);
  });
});

describe("politika kademeleri", () => {
  it("hata mesajindan kademe ve marker okur", () => {
    expect(policyFailCountFromMessage(null)).toBe(0);
    expect(policyFailCountFromMessage("[POLITIKA-1-YUMUSAK] ret")).toBe(1);
    expect(policyFailCountFromMessage("[POLITIKA-2-ISIMSIZ] ret")).toBe(2);
    expect(policyFailCountFromMessage("[POLITIKA-3-YUZSUZ] ret")).toBe(3);
    // Eski kliplerin tarihsel marker adlari da numarasiyla cozulur.
    expect(policyFailCountFromMessage("[POLITIKA-1-AYNI] ret")).toBe(1);
    expect(policyFailCountFromMessage("[POLITIKA-4-ISIMSIZ] ret")).toBe(4);
    expect(policyFailCountFromMessage("[POLITIKA-YUMUSATILDI] eski")).toBe(1);
    // Merdiven 3 kademede biter: 4. deneme son careyi (yuzsuz sahne) kullanir.
    expect(policyMarkerForFailCount(1)).toBe("[POLITIKA-1-YUMUSAK]");
    expect(policyMarkerForFailCount(2)).toBe("[POLITIKA-2-ISIMSIZ]");
    expect(policyMarkerForFailCount(3)).toBe("[POLITIKA-3-YUZSUZ]");
    expect(policyMarkerForFailCount(4)).toBe("[POLITIKA-3-YUZSUZ]");
    expect(isPolicyRetryPending("[POLITIKA-1-YUMUSAK] x")).toBe(true);
    expect(isPolicyRetryPending("[POLITIKA-3-YUZSUZ] x")).toBe(true);
    expect(isPolicyRetryPending("[POLITIKA-4-ISIMSIZ] x")).toBe(true);
    expect(isPolicyRetryPending("diger hata")).toBe(false);
  });

  it("son kademe sahneyi YUZSUZ kurguya cevirir; soz ve dil kilidi kalir", () => {
    const raw = [
      "@Markus",
      "[STORY CAST] ordinary adults",
      "[IDENTITY LOCK — ON-SCREEN CAST ONLY] Lock these identities 1:1: Markus.",
      "[WHO IS ON SCREEN]",
      "Only the story adults in this beat may have a readable face. LEAD on screen: Markus. A 38-year-old adult MAN.",
      "[SPEECH LANGUAGE LOCK — NON-NEGOTIABLE] Spoken audio MUST be German only.",
      "[CAMERA] NetShort coverage: MCU/CU or tight two-shot (max 1-2 faces). Prefer action then reaction CU across clips.",
      "[STYLE] Cast: attractive real adults, clean skin, sharp catchlight in the eyes. 85mm portrait primes, chest-up singles.",
      "[SHOT] Markus opens the folder.",
      '"Markus zog die Mundwinkel hoch."',
    ].join("\n");
    const faceless = rewritePromptAfterPolicyBlock(raw, 3);

    // Yuz isteyen her sey kalkar.
    expect(faceless).toContain("[FACELESS STAGING");
    expect(faceless).not.toMatch(/readable face/i);
    expect(faceless).not.toMatch(/\[WHO IS ON SCREEN\]/);
    expect(faceless).not.toMatch(/\[IDENTITY LOCK/);
    expect(faceless).not.toMatch(/\[STORY CAST\]/);
    expect(faceless).not.toMatch(/@Markus/);
    expect(faceless).not.toMatch(/chest-up singles|portrait primes|catchlight/i);
    expect(faceless).not.toMatch(/max 1[–-]2 faces/i);

    // Hikaye ve ses bozulmaz; ozel isim sozde de yok.
    expect(faceless).toContain("er zog die Mundwinkel hoch");
    expect(faceless).not.toMatch(/\bMarkus\b/);
    expect(faceless).toMatch(/Spoken audio MUST be German only/);
    expect(faceless).toMatch(/silhouette|over-the-shoulder|hands and the object/i);
    // 4+ kademe de ayni son careyi verir.
    expect(rewritePromptAfterPolicyBlock(raw, 5)).toContain("[FACELESS STAGING");
  });

  it("yuzsuz kilit Flow kisaltmasindan SAG cikar (yoksa kademe islevsiz kalir)", () => {
    const bulky = [
      "[STORY CAST] ordinary adults",
      "[IDENTITY LOCK] Lock these identities 1:1: Markus.",
      "[WHO IS ON SCREEN] Only the story adults may have a readable face.",
      "[SHOT] Markus opens the folder in a glass office.",
      `[STYLE] ${"cinematic grade detail. ".repeat(120)}`,
      `[PERFORMANCE] ${"acted beat detail. ".repeat(120)}`,
      '"Markus zog die Mundwinkel hoch."',
    ].join("\n");
    const faceless = rewritePromptAfterPolicyBlock(bulky, 3);
    const { text } = compactPromptForFlow(faceless, "German", 2200);
    expect(text.length).toBeLessThanOrEqual(2200);
    expect(text).toContain("[FACELESS STAGING");
    expect(text).toMatch(/No readable human face/i);
    // Soz sikismada bile once gelir; yuz yasagi onu disari itmez, isim yok.
    expect(text).toMatch(/er zog die Mundwinkel hoch|o zog die Mundwinkel hoch/);
    expect(text).not.toMatch(/\bMarkus\b/);
  });

  it("ilk gonderim suzer, 1. kademe yumusatir, 2. kademe kilitleri sifirlar", () => {
    const raw =
      "[STORY CAST] stunning famous actress\n[GENDER LOCK] adult woman\n[SHOT] kitchen table\n\"Bosanmak istiyorum.\"";
    const first = rewritePromptAfterPolicyBlock(raw, 0);
    expect(first).toContain("[SHOT] kitchen table");
    expect(first).toContain("Bosanmak istiyorum");
    expect(first).not.toMatch(/famous|actress/i);
    const soft = rewritePromptAfterPolicyBlock(raw, 1);
    expect(soft).toContain("[SHOT] kitchen table");
    expect(soft).toContain("Bosanmak istiyorum");
    expect(soft).not.toMatch(/stunning|famous|actress/i);
    expect(soft).toContain("[ORDINARY STORY PEOPLE]");
    expect(soft).not.toMatch(/resemble|public figure|famous look/i);
    const anon = rewritePromptAfterPolicyBlock(raw, 2);
    expect(anon).toContain("[ORDINARY STORY PEOPLE]");
    expect(anon).not.toMatch(/\[STORY CAST\]/);
    expect(anon).not.toMatch(/\[GENDER LOCK\]/);
    expect(anon).not.toMatch(/resemble|public figure|famous look/i);
    expect(bypassPolicyBlockedPrompt(raw)).toContain("[ORDINARY STORY PEOPLE]");
  });

  it("2. kademe @ref, isim ve portre kilidini sokar, soylenen satiri korur", () => {
    const raw = [
      "@Markus",
      "@Ursula",
      "[IDENTITY LOCK — ON-SCREEN CAST ONLY] Lock these identities 1:1: Markus. blue-gray eyes.",
      "[WHO IS ON SCREEN]",
      "LEAD on screen: Markus. A 38-year-old adult MAN. @Markus appears.",
      "[SHOT] Markus on screen.",
      '"Markus zog die Mundwinkel hoch."',
    ].join("\n");
    const bypass = bypassPolicyBlockedPrompt(raw);
    expect(bypass).not.toMatch(/@Markus|@Ursula/);
    expect(bypass).not.toMatch(/\bMarkus\b/);
    expect(bypass).toMatch(/er zog die Mundwinkel hoch|o zog die Mundwinkel hoch/);
    const anon = rewritePromptAfterPolicyBlock(raw, 2);
    expect(anon).not.toMatch(/@Markus|@Ursula/);
    expect(anon).not.toMatch(/blue-gray|38-year-old/);
    expect(anon).toMatch(/the husband on screen/);
    expect(anon).not.toMatch(/\bMarkus\b/);
    expect(anonymizeCastForPolicyRetry(raw)).toContain("[ORDINARY STORY PEOPLE]");
  });

  it("ilk gonderimde @ref, ozel isim ve portre kilidini soker, soylenen satiri korur", () => {
    const raw = [
      "@Markus",
      "[IDENTITY LOCK — ON-SCREEN CAST ONLY] Lock these identities 1:1: Markus. Given name \"Markus\" is a common German first name.",
      "[WHO IS ON SCREEN]",
      "LEAD on screen: Markus. A 38-year-old adult MAN. @Markus appears.",
      "[SHOT] Markus opens the folder.",
      '"Markus zog die Mundwinkel hoch."',
    ].join("\n");
    const out = prepareLiveActionFlowPrompt(raw);
    expect(out).not.toMatch(/@Markus/);
    expect(out).not.toMatch(/\bMarkus\b/);
    expect(out).not.toMatch(/Lock these identities|Given name|38-year-old|celebrity likeness/i);
    expect(out).toMatch(/er zog die Mundwinkel hoch|o zog die Mundwinkel hoch/);
    expect(defuseNameAndFacePolicyTriggers(raw)).toMatch(/the husband/);
  });

  it("ilk gonderim Slav/unlu/public figure dilini sokar, sahneyi korur", () => {
    const raw =
      '[STORY CAST] fair Slavic or Scandinavian type welcome, colored eyes (blue, green or grey). Not a public figure.\n[SHOT] office glass\n"Bosanmak istiyorum."';
    const out = prepareLiveActionFlowPrompt(raw);
    expect(out).toContain("[SHOT] office glass");
    expect(out).toContain("Bosanmak istiyorum");
    expect(out).not.toMatch(/slavic|scandinavian|colored eyes|public figure/i);
    expect(FLOW_FICTIONAL_PERSON_LOCK).not.toMatch(/public figure|famous|celebrity|resemble/i);
    expect(sanitizeCelebrityLikenessForFlow("ladylike Slavic beauty, ice blue, fair Nordic")).not.toMatch(
      /slavic|nordic|ice blue/i
    );
  });
});

describe("Flow karakter cinsiyet kilidi", () => {
  it("kadin ve erkek promptunu karistirmez", () => {
    expect(flowGenderLock("female")).toMatch(/Exactly ONE adult woman \(female\)/i);
    expect(flowGenderLock("male")).toMatch(/Exactly ONE adult man \(male\)/i);
    expect(flowGenderLock("male")).not.toMatch(/woman/i);
    expect(flowGenderLock("female")).not.toMatch(/Do not depict/i);
    expect(flowStoryCastForGender("female")).toMatch(/\[WARDROBE COVER\]/);
    expect(flowStoryCastForGender("male")).toMatch(/male neighbor|menswear/i);
    expect(flowStoryCastForGender("male")).not.toMatch(/\[WARDROBE COVER\]/);
  });
});

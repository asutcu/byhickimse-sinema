import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * AES-256-GCM ile yerel sifreleme.
 * Anahtar, kullanicinin makinesinde config/.local-encryption-key dosyasinda tutulur
 * (gitignore'da). Dosya yoksa ilk kullanimda rastgele uretilir.
 */

const KEY_FILE = path.join(process.cwd(), "config", ".local-encryption-key");

function getOrCreateKey(): Buffer {
  const dir = path.dirname(KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, "utf8").trim();
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) return key;
    // Bozuk anahtar dosyasi: yeniden uretmek eski sifreli veriyi okunamaz kilar,
    // bu yuzden acik hata veriyoruz.
    throw new Error("Yerel sifreleme anahtari dosyasi bozuk: config/.local-encryption-key");
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString("base64"), { encoding: "utf8" });
  return key;
}

/** Duz metni "iv.tag.cipher" (base64) bicimine sifreler. */
export function encryptSecret(plain: string): string {
  const key = getOrCreateKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

/** encryptSecret ciktisini cozer; bicim bozuksa hata firlatir. */
export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Sifreli veri bicimi gecersiz");
  const [ivB64, tagB64, dataB64] = parts;
  const key = getOrCreateKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

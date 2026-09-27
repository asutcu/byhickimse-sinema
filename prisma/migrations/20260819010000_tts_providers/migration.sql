-- AlterTable: seslendirme (TTS) saglayici ayarlari
ALTER TABLE "AppSettings" ADD COLUMN "ttsProvider" TEXT NOT NULL DEFAULT 'google';
ALTER TABLE "AppSettings" ADD COLUMN "googleTtsKeyEncrypted" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "azureSpeechKeyEncrypted" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "azureSpeechRegion" TEXT NOT NULL DEFAULT 'westeurope';
ALTER TABLE "AppSettings" ADD COLUMN "elevenLabsKeyEncrypted" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "elevenLabsVoiceId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AppSettings" ADD COLUMN "piperPython" TEXT NOT NULL DEFAULT 'python';
ALTER TABLE "AppSettings" ADD COLUMN "piperModelDir" TEXT NOT NULL DEFAULT '';

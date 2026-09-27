-- Zaman Yolcusu formati: proje basina donem, sunucu ve yol arkadasi ayarlari (JSON).
ALTER TABLE "Project" ADD COLUMN "timeTravelSettings" TEXT NOT NULL DEFAULT '{}';

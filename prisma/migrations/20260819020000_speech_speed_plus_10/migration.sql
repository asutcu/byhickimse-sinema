-- Konusma hizi %10 artisi: varsayilan kelime/dk degerleri.
-- Kullanici kendi degerini girmisse (eski varsayilanlardan farkliysa) dokunulmaz.
UPDATE "AppSettings" SET "wpmSlow" = 121 WHERE "wpmSlow" = 110;
UPDATE "AppSettings" SET "wpmNormal" = 143 WHERE "wpmNormal" = 130;
UPDATE "AppSettings" SET "wpmFast" = 165 WHERE "wpmFast" = 150;

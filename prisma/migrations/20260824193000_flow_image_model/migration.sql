-- AlterTable
ALTER TABLE "Project" ADD COLUMN "flowImageModel" TEXT NOT NULL DEFAULT 'Nano Banana 2';

-- Eski uzun-form kayitlarindaki secimi tasi
UPDATE "Project"
SET "flowImageModel" = json_extract("longformSettings", '$.imageModel')
WHERE json_extract("longformSettings", '$.imageModel') IN ('Nano Banana 2', 'Nano Banana Pro');

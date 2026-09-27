-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CharacterProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL DEFAULT '',
    "age" INTEGER NOT NULL DEFAULT 20,
    "adult" BOOLEAN NOT NULL DEFAULT true,
    "nationalityLook" TEXT NOT NULL DEFAULT '',
    "hair" TEXT NOT NULL DEFAULT '',
    "faceFeatures" TEXT NOT NULL DEFAULT '',
    "makeup" TEXT NOT NULL DEFAULT '',
    "wardrobe" TEXT NOT NULL DEFAULT '',
    "bodyFraming" TEXT NOT NULL DEFAULT '',
    "sittingPose" TEXT NOT NULL DEFAULT '',
    "gestureLevel" TEXT NOT NULL DEFAULT '',
    "voiceCharacter" TEXT NOT NULL DEFAULT '',
    "emotionTone" TEXT NOT NULL DEFAULT '',
    "environment" TEXT NOT NULL DEFAULT '',
    "lighting" TEXT NOT NULL DEFAULT '',
    "cameraAngle" TEXT NOT NULL DEFAULT '',
    "lensLook" TEXT NOT NULL DEFAULT '',
    "background" TEXT NOT NULL DEFAULT '',
    "negativePrompt" TEXT NOT NULL DEFAULT '',
    "referenceImagePath" TEXT,
    "flowCharacterReference" TEXT NOT NULL DEFAULT '',
    "baseAppearancePrompt" TEXT NOT NULL DEFAULT '',
    "baseWardrobePrompt" TEXT NOT NULL DEFAULT '',
    "baseEnvironmentPrompt" TEXT NOT NULL DEFAULT '',
    "baseCameraPrompt" TEXT NOT NULL DEFAULT '',
    "baseVoicePrompt" TEXT NOT NULL DEFAULT '',
    "dnaCard" TEXT NOT NULL DEFAULT '{}',
    "imagePrompt" TEXT NOT NULL DEFAULT '',
    "imageApproved" BOOLEAN NOT NULL DEFAULT false,
    "storyRole" TEXT NOT NULL DEFAULT '',
    "storyNote" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CharacterProfile" ("adult", "age", "background", "baseAppearancePrompt", "baseCameraPrompt", "baseEnvironmentPrompt", "baseVoicePrompt", "baseWardrobePrompt", "bodyFraming", "cameraAngle", "createdAt", "dnaCard", "emotionTone", "environment", "faceFeatures", "flowCharacterReference", "gestureLevel", "hair", "id", "imageApproved", "imagePrompt", "lensLook", "lighting", "makeup", "name", "nationalityLook", "negativePrompt", "projectId", "referenceImagePath", "role", "sittingPose", "updatedAt", "voiceCharacter", "wardrobe") SELECT "adult", "age", "background", "baseAppearancePrompt", "baseCameraPrompt", "baseEnvironmentPrompt", "baseVoicePrompt", "baseWardrobePrompt", "bodyFraming", "cameraAngle", "createdAt", "dnaCard", "emotionTone", "environment", "faceFeatures", "flowCharacterReference", "gestureLevel", "hair", "id", "imageApproved", "imagePrompt", "lensLook", "lighting", "makeup", "name", "nationalityLook", "negativePrompt", "projectId", "referenceImagePath", "role", "sittingPose", "updatedAt", "voiceCharacter", "wardrobe" FROM "CharacterProfile";
DROP TABLE "CharacterProfile";
ALTER TABLE "new_CharacterProfile" RENAME TO "CharacterProfile";
CREATE INDEX "CharacterProfile_projectId_role_idx" ON "CharacterProfile"("projectId", "role");
CREATE TABLE "new_Clip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "languageVariant" TEXT NOT NULL DEFAULT 'primary',
    "index" INTEGER NOT NULL,
    "dialogue" TEXT NOT NULL DEFAULT '',
    "shotType" TEXT NOT NULL DEFAULT 'narrator',
    "characterId" TEXT,
    "sceneDescription" TEXT NOT NULL DEFAULT '',
    "imagePrompt" TEXT NOT NULL DEFAULT '',
    "sceneImagePath" TEXT,
    "emotionLabel" TEXT NOT NULL DEFAULT '',
    "curiosityScore" INTEGER NOT NULL DEFAULT 0,
    "hasHook" BOOLEAN NOT NULL DEFAULT false,
    "voiceTone" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL DEFAULT '',
    "estimatedWords" INTEGER NOT NULL DEFAULT 0,
    "estimatedDurationSeconds" REAL NOT NULL DEFAULT 0,
    "actualDurationSeconds" REAL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "videoPath" TEXT,
    "lastFramePath" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Clip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Clip_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "CharacterProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Clip" ("actualDurationSeconds", "attemptCount", "createdAt", "curiosityScore", "dialogue", "emotionLabel", "errorMessage", "estimatedDurationSeconds", "estimatedWords", "hasHook", "id", "imagePrompt", "index", "languageVariant", "lastFramePath", "projectId", "prompt", "sceneDescription", "sceneImagePath", "status", "updatedAt", "videoPath", "voiceTone") SELECT "actualDurationSeconds", "attemptCount", "createdAt", "curiosityScore", "dialogue", "emotionLabel", "errorMessage", "estimatedDurationSeconds", "estimatedWords", "hasHook", "id", "imagePrompt", "index", "languageVariant", "lastFramePath", "projectId", "prompt", "sceneDescription", "sceneImagePath", "status", "updatedAt", "videoPath", "voiceTone" FROM "Clip";
DROP TABLE "Clip";
ALTER TABLE "new_Clip" RENAME TO "Clip";
CREATE INDEX "Clip_projectId_status_idx" ON "Clip"("projectId", "status");
CREATE INDEX "Clip_characterId_idx" ON "Clip"("characterId");
CREATE UNIQUE INDEX "Clip_projectId_languageVariant_index_key" ON "Clip"("projectId", "languageVariant", "index");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

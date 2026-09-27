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
    "gender" TEXT NOT NULL DEFAULT 'female',
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
INSERT INTO "new_CharacterProfile" ("adult", "age", "background", "baseAppearancePrompt", "baseCameraPrompt", "baseEnvironmentPrompt", "baseVoicePrompt", "baseWardrobePrompt", "bodyFraming", "cameraAngle", "createdAt", "dnaCard", "emotionTone", "environment", "faceFeatures", "flowCharacterReference", "gestureLevel", "hair", "id", "imageApproved", "imagePrompt", "lensLook", "lighting", "makeup", "name", "nationalityLook", "negativePrompt", "projectId", "referenceImagePath", "role", "sittingPose", "storyNote", "storyRole", "updatedAt", "voiceCharacter", "wardrobe") SELECT "adult", "age", "background", "baseAppearancePrompt", "baseCameraPrompt", "baseEnvironmentPrompt", "baseVoicePrompt", "baseWardrobePrompt", "bodyFraming", "cameraAngle", "createdAt", "dnaCard", "emotionTone", "environment", "faceFeatures", "flowCharacterReference", "gestureLevel", "hair", "id", "imageApproved", "imagePrompt", "lensLook", "lighting", "makeup", "name", "nationalityLook", "negativePrompt", "projectId", "referenceImagePath", "role", "sittingPose", "storyNote", "storyRole", "updatedAt", "voiceCharacter", "wardrobe" FROM "CharacterProfile";
DROP TABLE "CharacterProfile";
ALTER TABLE "new_CharacterProfile" RENAME TO "CharacterProfile";
CREATE INDEX "CharacterProfile_projectId_role_idx" ON "CharacterProfile"("projectId", "role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

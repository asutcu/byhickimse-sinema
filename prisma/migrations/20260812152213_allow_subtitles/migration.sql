-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "topic" TEXT NOT NULL DEFAULT '',
    "genre" TEXT NOT NULL DEFAULT 'gizem',
    "targetDurationSeconds" INTEGER NOT NULL DEFAULT 180,
    "storyLanguage" TEXT NOT NULL DEFAULT 'Türkçe',
    "speechLanguage" TEXT NOT NULL DEFAULT 'Türkçe',
    "audience" TEXT NOT NULL DEFAULT '',
    "narrationStyle" TEXT NOT NULL DEFAULT '',
    "openingHook" TEXT NOT NULL DEFAULT '',
    "avoidList" TEXT NOT NULL DEFAULT '',
    "speechPace" TEXT NOT NULL DEFAULT 'normal',
    "targetWordCount" INTEGER NOT NULL DEFAULT 0,
    "templateType" TEXT NOT NULL DEFAULT 'narrator',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "flowModel" TEXT NOT NULL DEFAULT 'Veo 3.1 Fast',
    "clipSeconds" INTEGER NOT NULL DEFAULT 8,
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "outputsPerGeneration" INTEGER NOT NULL DEFAULT 1,
    "audioEnabled" BOOLEAN NOT NULL DEFAULT true,
    "useReference" BOOLEAN NOT NULL DEFAULT true,
    "useFlowCharacter" BOOLEAN NOT NULL DEFAULT false,
    "useStartFrame" BOOLEAN NOT NULL DEFAULT false,
    "usePrevLastFrame" BOOLEAN NOT NULL DEFAULT true,
    "reuseFlowProject" BOOLEAN NOT NULL DEFAULT true,
    "flowProjectName" TEXT NOT NULL DEFAULT '',
    "generateButtonMode" TEXT NOT NULL DEFAULT 'auto',
    "automationMode" TEXT NOT NULL DEFAULT 'full',
    "promptTemplate" TEXT NOT NULL DEFAULT '',
    "allowSubtitles" BOOLEAN NOT NULL DEFAULT false,
    "ageBand" TEXT NOT NULL DEFAULT '',
    "moralLesson" TEXT NOT NULL DEFAULT '',
    "visualStyle" TEXT NOT NULL DEFAULT '',
    "channelName" TEXT NOT NULL DEFAULT '',
    "episodeNumber" INTEGER NOT NULL DEFAULT 1,
    "seriesHook" TEXT NOT NULL DEFAULT '',
    "emotionCurve" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Project" ("ageBand", "aspectRatio", "audience", "audioEnabled", "automationMode", "avoidList", "channelName", "clipSeconds", "createdAt", "emotionCurve", "episodeNumber", "flowModel", "flowProjectName", "generateButtonMode", "genre", "id", "moralLesson", "name", "narrationStyle", "openingHook", "outputsPerGeneration", "promptTemplate", "reuseFlowProject", "seriesHook", "slug", "speechLanguage", "speechPace", "status", "storyLanguage", "targetDurationSeconds", "targetWordCount", "templateType", "title", "topic", "updatedAt", "useFlowCharacter", "usePrevLastFrame", "useReference", "useStartFrame", "visualStyle") SELECT "ageBand", "aspectRatio", "audience", "audioEnabled", "automationMode", "avoidList", "channelName", "clipSeconds", "createdAt", "emotionCurve", "episodeNumber", "flowModel", "flowProjectName", "generateButtonMode", "genre", "id", "moralLesson", "name", "narrationStyle", "openingHook", "outputsPerGeneration", "promptTemplate", "reuseFlowProject", "seriesHook", "slug", "speechLanguage", "speechPace", "status", "storyLanguage", "targetDurationSeconds", "targetWordCount", "templateType", "title", "topic", "updatedAt", "useFlowCharacter", "usePrevLastFrame", "useReference", "useStartFrame", "visualStyle" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE INDEX "Project_status_idx" ON "Project"("status");
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

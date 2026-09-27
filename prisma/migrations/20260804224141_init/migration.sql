-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "openaiModel" TEXT NOT NULL DEFAULT 'gpt-5',
    "openaiKeyStorageMode" TEXT NOT NULL DEFAULT 'memory',
    "openaiApiKeyEncrypted" TEXT,
    "flowUrl" TEXT NOT NULL DEFAULT 'https://labs.google/fx/tools/flow',
    "chromeProfileDir" TEXT NOT NULL DEFAULT '',
    "downloadDir" TEXT NOT NULL DEFAULT '',
    "ffmpegPath" TEXT NOT NULL DEFAULT 'ffmpeg',
    "ffprobePath" TEXT NOT NULL DEFAULT 'ffprobe',
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "waitBetweenGenerationsMs" INTEGER NOT NULL DEFAULT 8000,
    "generationTimeoutMs" INTEGER NOT NULL DEFAULT 420000,
    "pollIntervalMs" INTEGER NOT NULL DEFAULT 3000,
    "defaultFlowModel" TEXT NOT NULL DEFAULT 'Veo 3.1 Fast',
    "defaultClipSeconds" INTEGER NOT NULL DEFAULT 8,
    "defaultAspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "headless" BOOLEAN NOT NULL DEFAULT false,
    "slowMoMs" INTEGER NOT NULL DEFAULT 120,
    "wpmSlow" INTEGER NOT NULL DEFAULT 110,
    "wpmNormal" INTEGER NOT NULL DEFAULT 130,
    "wpmFast" INTEGER NOT NULL DEFAULT 150,
    "modelSupportMatrix" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
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

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "languageVariant" TEXT NOT NULL DEFAULT 'primary',
    "title" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "hook" TEXT NOT NULL DEFAULT '',
    "fullStory" TEXT NOT NULL DEFAULT '',
    "estimatedWords" INTEGER NOT NULL DEFAULT 0,
    "estimatedDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT '',
    "contentWarnings" TEXT NOT NULL DEFAULT '[]',
    "characterVoiceNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Story_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CharacterProfile" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "languageVariant" TEXT NOT NULL DEFAULT 'primary',
    "index" INTEGER NOT NULL,
    "dialogue" TEXT NOT NULL DEFAULT '',
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
    CONSTRAINT "Clip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'flow_generation',
    "state" TEXT NOT NULL DEFAULT 'pending',
    "mode" TEXT NOT NULL DEFAULT 'full',
    "languageVariant" TEXT NOT NULL DEFAULT 'primary',
    "currentClipId" TEXT,
    "pausedReason" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutomationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" TEXT,
    "clipId" TEXT,
    "jobId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "step" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "screenshotPath" TEXT,
    "pageUrl" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutomationEvent_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AutomationEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AutomationJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FlowSelector" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'css',
    "value" TEXT NOT NULL DEFAULT '',
    "roleName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "lastTestOk" BOOLEAN,
    "lastTestAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GeneratedAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "clipId" TEXT,
    "languageVariant" TEXT NOT NULL DEFAULT 'primary',
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GeneratedAsset_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelPreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "templateType" TEXT NOT NULL DEFAULT 'narrator',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "Story_projectId_idx" ON "Story"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Story_projectId_languageVariant_key" ON "Story"("projectId", "languageVariant");

-- CreateIndex
CREATE INDEX "CharacterProfile_projectId_role_idx" ON "CharacterProfile"("projectId", "role");

-- CreateIndex
CREATE INDEX "Clip_projectId_status_idx" ON "Clip"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_projectId_languageVariant_index_key" ON "Clip"("projectId", "languageVariant", "index");

-- CreateIndex
CREATE INDEX "AutomationJob_projectId_state_idx" ON "AutomationJob"("projectId", "state");

-- CreateIndex
CREATE INDEX "AutomationJob_state_idx" ON "AutomationJob"("state");

-- CreateIndex
CREATE INDEX "AutomationEvent_projectId_createdAt_idx" ON "AutomationEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationEvent_level_idx" ON "AutomationEvent"("level");

-- CreateIndex
CREATE UNIQUE INDEX "FlowSelector_key_key" ON "FlowSelector"("key");

-- CreateIndex
CREATE INDEX "GeneratedAsset_projectId_kind_idx" ON "GeneratedAsset"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPreset_name_key" ON "ChannelPreset"("name");

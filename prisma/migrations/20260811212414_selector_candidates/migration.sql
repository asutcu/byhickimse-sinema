-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FlowSelector" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'css',
    "value" TEXT NOT NULL DEFAULT '',
    "roleName" TEXT NOT NULL DEFAULT '',
    "candidates" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "lastTestOk" BOOLEAN,
    "lastTestAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FlowSelector" ("createdAt", "description", "id", "key", "lastTestAt", "lastTestOk", "required", "roleName", "strategy", "updatedAt", "value") SELECT "createdAt", "description", "id", "key", "lastTestAt", "lastTestOk", "required", "roleName", "strategy", "updatedAt", "value" FROM "FlowSelector";
DROP TABLE "FlowSelector";
ALTER TABLE "new_FlowSelector" RENAME TO "FlowSelector";
CREATE UNIQUE INDEX "FlowSelector_key_key" ON "FlowSelector"("key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

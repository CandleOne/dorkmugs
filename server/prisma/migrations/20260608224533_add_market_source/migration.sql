-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MarketListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" REAL NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'used',
    "category" TEXT NOT NULL DEFAULT 'other',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceInventoryItemId" TEXT,
    "sourceUserCrateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketListing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MarketListing" ("category", "condition", "createdAt", "description", "id", "imageUrl", "price", "sellerId", "status", "title", "updatedAt") SELECT "category", "condition", "createdAt", "description", "id", "imageUrl", "price", "sellerId", "status", "title", "updatedAt" FROM "MarketListing";
DROP TABLE "MarketListing";
ALTER TABLE "new_MarketListing" RENAME TO "MarketListing";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

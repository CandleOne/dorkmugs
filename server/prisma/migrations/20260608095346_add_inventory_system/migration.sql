-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "value" REAL,
    "redeemed" BOOLEAN NOT NULL DEFAULT false,
    "redeemedAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'CRATE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShardMerge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shardsUsed" INTEGER NOT NULL DEFAULT 10,
    "wildcardCount" INTEGER NOT NULL DEFAULT 0,
    "voucherItemId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShardMerge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CrateOpening" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userCrateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "wonPrice" REAL NOT NULL,
    "claimToken" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" DATETIME,
    "itemType" TEXT NOT NULL DEFAULT 'SHARD',
    "itemQuantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrateOpening_userCrateId_fkey" FOREIGN KEY ("userCrateId") REFERENCES "UserCrate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrateOpening" ("claimToken", "claimed", "claimedAt", "createdAt", "id", "prizeId", "productId", "userCrateId", "userId", "wonPrice") SELECT "claimToken", "claimed", "claimedAt", "createdAt", "id", "prizeId", "productId", "userCrateId", "userId", "wonPrice" FROM "CrateOpening";
DROP TABLE "CrateOpening";
ALTER TABLE "new_CrateOpening" RENAME TO "CrateOpening";
CREATE UNIQUE INDEX "CrateOpening_userCrateId_key" ON "CrateOpening"("userCrateId");
CREATE UNIQUE INDEX "CrateOpening_claimToken_key" ON "CrateOpening"("claimToken");
CREATE TABLE "new_CratePrize" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crateId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "discountedPrice" REAL NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "itemType" TEXT NOT NULL DEFAULT 'SHARD',
    "itemValue" REAL NOT NULL DEFAULT 0,
    "coinAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CratePrize_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CratePrize" ("crateId", "createdAt", "discountedPrice", "id", "productId", "rarity", "weight") SELECT "crateId", "createdAt", "discountedPrice", "id", "productId", "rarity", "weight" FROM "CratePrize";
DROP TABLE "CratePrize";
ALTER TABLE "new_CratePrize" RENAME TO "CratePrize";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "InventoryItem_userId_idx" ON "InventoryItem"("userId");

-- CreateIndex
CREATE INDEX "InventoryItem_userId_type_idx" ON "InventoryItem"("userId", "type");

-- CreateIndex
CREATE INDEX "InventoryItem_userId_productId_idx" ON "InventoryItem"("userId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShardMerge_voucherItemId_key" ON "ShardMerge"("voucherItemId");

-- CreateIndex
CREATE INDEX "ShardMerge_userId_idx" ON "ShardMerge"("userId");

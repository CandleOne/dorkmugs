-- CreateTable: Crate
CREATE TABLE "Crate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL DEFAULT '',
    "price" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Crate_slug_key" ON "Crate"("slug");

-- CreateTable: CratePrize
CREATE TABLE "CratePrize" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crateId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "discountedPrice" REAL NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CratePrize_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: UserCrate
CREATE TABLE "UserCrate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "crateId" TEXT NOT NULL,
    "stripeSessionId" TEXT,
    "opened" BOOLEAN NOT NULL DEFAULT 0,
    "openedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCrate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCrate_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: CrateOpening
CREATE TABLE "CrateOpening" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userCrateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "wonPrice" REAL NOT NULL,
    "claimToken" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT 0,
    "claimedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrateOpening_userCrateId_fkey" FOREIGN KEY ("userCrateId") REFERENCES "UserCrate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CrateOpening_userCrateId_key" ON "CrateOpening"("userCrateId");
CREATE UNIQUE INDEX "CrateOpening_claimToken_key" ON "CrateOpening"("claimToken");

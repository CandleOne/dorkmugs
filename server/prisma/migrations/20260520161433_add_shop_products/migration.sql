-- CreateTable
CREATE TABLE "ShopProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pname" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "rating" REAL NOT NULL DEFAULT 0,
    "collection" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "imageLeft" TEXT NOT NULL DEFAULT '',
    "printifyIdLeft" TEXT NOT NULL DEFAULT '',
    "variantIdLeft" TEXT NOT NULL DEFAULT '',
    "imageCenter" TEXT NOT NULL DEFAULT '',
    "printifyIdCenter" TEXT NOT NULL DEFAULT '',
    "variantIdCenter" TEXT NOT NULL DEFAULT '',
    "imageRight" TEXT NOT NULL DEFAULT '',
    "printifyIdRight" TEXT NOT NULL DEFAULT '',
    "variantIdRight" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable: add featured and featuredOrder columns to ShopProduct
ALTER TABLE "ShopProduct" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShopProduct" ADD COLUMN "featuredOrder" INTEGER NOT NULL DEFAULT 0;

-- Seed the three existing homepage products as featured (gc01, sg01, bi01)
UPDATE "ShopProduct" SET "featured" = true, "featuredOrder" = 1 WHERE "id" = 'gc01';
UPDATE "ShopProduct" SET "featured" = true, "featuredOrder" = 2 WHERE "id" = 'sg01';
UPDATE "ShopProduct" SET "featured" = true, "featuredOrder" = 3 WHERE "id" = 'bi01';

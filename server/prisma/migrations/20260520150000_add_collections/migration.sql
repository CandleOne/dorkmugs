-- CreateTable
CREATE TABLE IF NOT EXISTS "Collection" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- Seed built-in collections
INSERT OR IGNORE INTO "Collection" ("slug", "name") VALUES
    ('bp',   'BP Collection'),
    ('fame', 'Fame & Infamy'),
    ('stem', 'STEM Collection');

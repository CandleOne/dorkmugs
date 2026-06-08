// prisma/seed-crates.js
// Creates one crate of each tier with correct prize pools pointing at real ShopProduct ids.
// Run with: node prisma/seed-crates.js
// Requires at least 3 published ShopProducts to exist.

const { PrismaClient } = require('@prisma/client');
const { DROP_TABLES } = require('../src/config/crateDrops');

const prisma = new PrismaClient();

const TIERS = [
  { name: 'Common Crate',    slug: 'common-crate',    price: 0.99,  tier: 'common'    },
  { name: 'Rare Crate',      slug: 'rare-crate',      price: 2.49,  tier: 'rare'      },
  { name: 'Legendary Crate', slug: 'legendary-crate', price: 4.99,  tier: 'legendary' },
];

async function main() {
  // Get first 3 published products to attach SHARD/MUG_VOUCHER prizes to
  const products = await prisma.shopProduct.findMany({
    where: { published: true },
    select: { id: true },
    take: 3,
    orderBy: { createdAt: 'asc' },
  });

  if (products.length < 1) {
    console.error('No published ShopProducts found. Publish at least one product before seeding crates.');
    process.exit(1);
  }

  for (const tier of TIERS) {
    // Upsert the crate (create or skip if slug already exists)
    let crate = await prisma.crate.findUnique({ where: { slug: tier.slug } });
    if (!crate) {
      crate = await prisma.crate.create({
        data: {
          name:        tier.name,
          slug:        tier.slug,
          description: `A ${tier.tier} tier crate. Open for shards, coins, vouchers, and more.`,
          price:       tier.price,
          active:      true,
        },
      });
      console.log(`Created crate: ${crate.name} (${crate.id})`);
    } else {
      console.log(`Crate already exists: ${crate.name} — skipping create`);
    }

    // Seed prizes if none exist
    const existingPrizes = await prisma.cratePrize.count({ where: { crateId: crate.id } });
    if (existingPrizes > 0) {
      console.log(`  Prizes already exist for ${crate.name} — skipping`);
      continue;
    }

    let productIndex = 0;
    for (const drop of DROP_TABLES[tier.tier]) {
      const needsProduct = drop.itemType === 'SHARD' || drop.itemType === 'MUG_VOUCHER';
      const productId    = needsProduct ? products[productIndex % products.length].id : products[0].id;
      if (needsProduct) productIndex++;

      await prisma.cratePrize.create({
        data: {
          crateId:        crate.id,
          productId,
          discountedPrice: 0,
          weight:          drop.weight,
          rarity:          tier.tier,
          itemType:        drop.itemType,
          itemValue:       drop.itemValue || 0,
          coinAmount:      drop.coinAmount || 0,
        },
      });
      console.log(`  + Prize: ${drop.itemType} (weight ${drop.weight})`);
    }
  }

  console.log('\nSeeding complete.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());

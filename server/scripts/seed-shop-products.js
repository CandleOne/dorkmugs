// Upserts the existing product catalog into the ShopProduct table.
// Run locally:     node scripts/seed-shop-products.js
// Run on prod:     flyctl ssh console --app dorkmugs -C "cd /app/server && node scripts/seed-shop-products.js"
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '../.env' });

const prisma = new PrismaClient();

const products = [
  {
    id: 'gc01',
    pname: 'Genetically Cursed! Mug',
    price: 18.99,
    rating: 4.8,
    collection: 'bp',
    description: 'Own your genetic misfortune in style. Bold, bubbly, and brutally honest.',
    sortOrder: 1,
    published: true,
    imageLeft:        './Assets/productpreviews/gencursedleft.png',
    printifyIdLeft:   '6a0d441cf34bf3e7a90b8942',
    variantIdLeft:    '65216',
    imageCenter:      '',
    printifyIdCenter: '',
    variantIdCenter:  '',
    imageRight:       '',
    printifyIdRight:  '',
    variantIdRight:   '',
  },
  {
    id: 'hy01',
    pname: 'Hypergamy Mug',
    price: 18.99,
    rating: 4.5,
    collection: 'bp',
    description: 'Bold and unapologetic, just like your morning opinions.',
    sortOrder: 2,
    published: true,
    imageLeft:        './Assets/finaldesigns/BPcollection/hypergamyfinal.png',
    printifyIdLeft:   '',
    variantIdLeft:    '',
    imageCenter:      '',
    printifyIdCenter: '',
    variantIdCenter:  '',
    imageRight:       '',
    printifyIdRight:  '',
    variantIdRight:   '',
  },
  {
    id: 'bp01',
    pname: 'BP Brutal Mug',
    price: 18.99,
    rating: 4.6,
    collection: 'bp',
    description: 'No filters, no apologies. Take your coffee as seriously as your takes.',
    sortOrder: 3,
    published: true,
    imageLeft:        './Assets/finaldesigns/BPcollection/bpbrutal.png',
    printifyIdLeft:   '',
    variantIdLeft:    '',
    imageCenter:      '',
    printifyIdCenter: '',
    variantIdCenter:  '',
    imageRight:       '',
    printifyIdRight:  '',
    variantIdRight:   '',
  },
  {
    id: 'bi01',
    pname: 'Big EP Mug',
    price: 21.99,
    rating: 4.7,
    collection: 'fame',
    description: 'Gothic monogram energy for the infamous. A statement piece.',
    sortOrder: 4,
    published: true,
    imageLeft:        './Assets/finaldesigns/Fame&InfamyCollection/bigep.png',
    printifyIdLeft:   '',
    variantIdLeft:    '',
    imageCenter:      '',
    printifyIdCenter: '',
    variantIdCenter:  '',
    imageRight:       '',
    printifyIdRight:  '',
    variantIdRight:   '',
  },
  {
    id: 'sg01',
    pname: 'Made Via Spontaneous Generation Mug',
    price: 19.99,
    rating: 4.9,
    collection: 'stem',
    description: 'For the biology nerd who questions everything. Redi would be horrified.',
    sortOrder: 5,
    published: true,
    imageLeft:        './Assets/finaldesigns/StemCollection/spontaneousgeneration.png',
    printifyIdLeft:   '',
    variantIdLeft:    '',
    imageCenter:      '',
    printifyIdCenter: '',
    variantIdCenter:  '',
    imageRight:       '',
    printifyIdRight:  '',
    variantIdRight:   '',
  },
];

async function main() {
  for (const p of products) {
    await prisma.shopProduct.upsert({
      where: { id: p.id },
      update: p,
      create: p,
    });
    console.log(`  ✓ ${p.id}  ${p.pname}`);
  }
  console.log(`\nDone — ${products.length} products seeded.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

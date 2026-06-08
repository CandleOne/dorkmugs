// src/config/crateDrops.js
// Canonical drop tables for each crate tier.
// The `weight` field on CratePrize rows in the DB overrides these at runtime.
// These are used as defaults when seeding and as documentation.

const DROP_TABLES = {
  common: [
    { itemType: 'SHARD',            weight: 70, itemValue: 0,  coinAmount: 0   },
    { itemType: 'DORK_COIN',        weight: 20, itemValue: 0,  coinAmount: 100 },
    { itemType: 'DISCOUNT_VOUCHER', weight: 8,  itemValue: 10, coinAmount: 0   }, // 10% off
    { itemType: 'WILDCARD_SHARD',   weight: 2,  itemValue: 0,  coinAmount: 0   },
  ],
  rare: [
    { itemType: 'SHARD',            weight: 50, itemValue: 0,  coinAmount: 0,  quantity: 3 }, // 3 shards
    { itemType: 'WILDCARD_SHARD',   weight: 25, itemValue: 0,  coinAmount: 0   },
    { itemType: 'DISCOUNT_VOUCHER', weight: 20, itemValue: 20, coinAmount: 0   }, // 20% off
    { itemType: 'MUG_VOUCHER',      weight: 5,  itemValue: 0,  coinAmount: 0   },
  ],
  legendary: [
    { itemType: 'WILDCARD_SHARD',   weight: 40, itemValue: 0,  coinAmount: 0   },
    { itemType: 'DISCOUNT_VOUCHER', weight: 30, itemValue: 25, coinAmount: 0   }, // 25% off
    { itemType: 'MUG_VOUCHER',      weight: 25, itemValue: 0,  coinAmount: 0   },
    { itemType: 'DORK_COIN',        weight: 5,  itemValue: 0,  coinAmount: 500 },
  ],
};

const SHARDS_TO_MERGE    = 10; // shards required to merge one mug voucher
const COIN_TO_DOLLAR     = 100; // 100 coins = $1 off
const MAX_COIN_DISCOUNT_PCT = 20; // coins can discount at most 20% of order total

module.exports = { DROP_TABLES, SHARDS_TO_MERGE, COIN_TO_DOLLAR, MAX_COIN_DISCOUNT_PCT };

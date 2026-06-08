// src/controllers/crates.js — crate (loot-box) system
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const stripeSvc = require('../services/stripe');
const config    = require('../config');
const { SHARDS_TO_MERGE } = require('../config/crateDrops');

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Weighted random selection from an array of prizes.
 * Each prize must have a numeric `weight` field.
 */
function pickPrize(prizes) {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0);
  let rand = Math.random() * total;
  for (const prize of prizes) {
    rand -= prize.weight;
    if (rand <= 0) return prize;
  }
  return prizes[prizes.length - 1];
}

// ── Public routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/crates
 * List all active crates with their prize pools.
 */
async function listCrates(req, res) {
  try {
    const crates = await prisma.crate.findMany({
      where: { active: true },
      include: {
        prizes: {
          include: {
            // Attach product name/image from ShopProduct for the prize preview
          },
          orderBy: { weight: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Enrich prizes with product info
    const productIds = [...new Set(crates.flatMap(c => c.prizes.map(p => p.productId)))];
    const products = productIds.length
      ? await prisma.shopProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, pname: true, imageLeft: true, price: true },
        })
      : [];
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    const enriched = crates.map(c => ({
      ...c,
      prizes: c.prizes.map(p => ({
        ...p,
        product: productMap[p.productId] || null,
      })),
    }));

    return res.json({ crates: enriched });
  } catch (err) {
    console.error('[crates] listCrates error', err.message);
    return res.status(500).json({ error: 'Could not fetch crates.' });
  }
}

/**
 * GET /api/crates/my
 * Returns the authenticated user's crate inventory (opened + unopened).
 */
async function myInventory(req, res) {
  try {
    const userCrates = await prisma.userCrate.findMany({
      where: { userId: req.user.id },
      include: {
        crate: true,
        opening: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich won products
    const productIds = [...new Set(
      userCrates
        .map(uc => uc.opening?.productId)
        .filter(Boolean)
    )];
    const products = productIds.length
      ? await prisma.shopProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, pname: true, imageLeft: true, price: true },
        })
      : [];
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    const enriched = userCrates.map(uc => ({
      ...uc,
      opening: uc.opening
        ? { ...uc.opening, product: productMap[uc.opening.productId] || null }
        : null,
    }));

    return res.json({ userCrates: enriched });
  } catch (err) {
    console.error('[crates] myInventory error', err.message);
    return res.status(500).json({ error: 'Could not fetch inventory.' });
  }
}

/**
 * POST /api/crates/open/:userCrateId
 * Open a crate the user owns. Returns the prize and created inventory items.
 */
async function openCrate(req, res) {
  const { userCrateId } = req.params;
  try {
    const userCrate = await prisma.userCrate.findFirst({
      where: { id: userCrateId, userId: req.user.id },
      include: {
        crate: { include: { prizes: true } },
        opening: true,
      },
    });

    if (!userCrate) return res.status(404).json({ error: 'Crate not found.' });
    if (userCrate.opened) return res.status(409).json({ error: 'Crate already opened.', opening: userCrate.opening });

    const prizes = userCrate.crate.prizes;
    if (!prizes.length) return res.status(422).json({ error: 'This crate has no prizes configured.' });

    const prize = pickPrize(prizes);
    const itemQuantity = (prize.itemType === 'SHARD' && prize.quantity > 1) ? prize.quantity : 1;

    // Build inventory item creates for the transaction
    const inventoryCreates = [];

    // Primary item
    const primaryData = {
      userId: req.user.id,
      type:   prize.itemType,
      source: 'CRATE',
    };
    if (prize.itemType === 'SHARD') {
      primaryData.productId = prize.productId || null;
      primaryData.quantity  = itemQuantity;
    } else if (prize.itemType === 'WILDCARD_SHARD') {
      primaryData.quantity = 1;
    } else if (prize.itemType === 'DORK_COIN') {
      primaryData.value    = prize.coinAmount;
      primaryData.quantity = 1;
    } else if (prize.itemType === 'DISCOUNT_VOUCHER') {
      primaryData.value    = prize.itemValue;
      primaryData.quantity = 1;
    } else if (prize.itemType === 'MUG_VOUCHER') {
      primaryData.productId = prize.productId || null;
      primaryData.quantity  = 1;
    }
    inventoryCreates.push(prisma.inventoryItem.create({ data: primaryData }));

    // Bonus coins (if prize has coinAmount and is not already a DORK_COIN prize)
    if (prize.coinAmount > 0 && prize.itemType !== 'DORK_COIN') {
      inventoryCreates.push(prisma.inventoryItem.create({
        data: { userId: req.user.id, type: 'DORK_COIN', value: prize.coinAmount, quantity: 1, source: 'CRATE' },
      }));
    }

    const [, opening, ...createdItems] = await prisma.$transaction([
      prisma.userCrate.update({
        where: { id: userCrateId },
        data: { opened: true, openedAt: new Date() },
      }),
      prisma.crateOpening.create({
        data: {
          userCrateId,
          userId:       req.user.id,
          prizeId:      prize.id,
          productId:    prize.productId || '',
          wonPrice:     prize.discountedPrice,
          claimToken:   crypto.randomUUID(),
          itemType:     prize.itemType,
          itemQuantity,
        },
      }),
      ...inventoryCreates,
    ]);

    // Enrich with product info when relevant
    let product = null;
    if (prize.productId) {
      product = await prisma.shopProduct.findUnique({
        where: { id: prize.productId },
        select: { id: true, pname: true, imageLeft: true, price: true },
      });
    }

    return res.json({
      opening: { ...opening, prize, product, inventoryItems: createdItems },
    });
  } catch (err) {
    console.error('[crates] openCrate error', err.message);
    return res.status(500).json({ error: 'Could not open crate.' });
  }
}

/**
 * POST /api/crates/claim/:claimToken
 * Convert a won prize into a Stripe checkout session at the discounted price.
 * Auth required — must be the winner.
 */
async function claimPrize(req, res) {
  const { claimToken } = req.params;
  // Basic token format check
  if (!/^[0-9a-f-]{36}$/i.test(claimToken)) {
    return res.status(400).json({ error: 'Invalid claim token.' });
  }

  try {
    const opening = await prisma.crateOpening.findUnique({
      where: { claimToken },
    });

    if (!opening) return res.status(404).json({ error: 'Claim not found.' });
    if (opening.userId !== req.user.id) return res.status(403).json({ error: 'Not your prize.' });
    if (opening.claimed) return res.status(409).json({ error: 'Prize already claimed.' });

    const product = await prisma.shopProduct.findUnique({
      where: { id: opening.productId },
      select: { id: true, pname: true, imageLeft: true, printifyIdLeft: true, variantIdLeft: true },
    });
    if (!product) return res.status(404).json({ error: 'Prize product not found.' });

    // Mark claimed immediately to prevent replay
    await prisma.crateOpening.update({
      where: { claimToken },
      data: { claimed: true, claimedAt: new Date() },
    });

    const priceInCents = Math.round(opening.wonPrice * 100);
    const successUrl = config.stripe.successUrl + '?session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl  = config.stripe.cancelUrl;

    const items = [{
      name:              product.pname,
      price:             priceInCents,
      qty:               1,
      image:             product.imageLeft || undefined,
      printifyProductId: product.printifyIdLeft || undefined,
      variantId:         product.variantIdLeft  || undefined,
      placement:         'left',
    }];

    const metadata = {
      items:     JSON.stringify([{
        printifyProductId: product.printifyIdLeft || null,
        variantId:         product.variantIdLeft  || null,
        qty:               1,
        placement:         'left',
      }]),
      userId:    req.user.id,
      userEmail: req.user.email,
      crateClaimToken: claimToken,
    };

    const session = await stripeSvc.createCheckoutSession(
      items, metadata, successUrl, cancelUrl, req.user.email, null
    );

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[crates] claimPrize error', err.message);
    return res.status(500).json({ error: 'Could not create checkout for prize.' });
  }
}

// ── Admin routes ──────────────────────────────────────────────────────────────

async function adminListCrates(req, res) {
  try {
    const crates = await prisma.crate.findMany({
      include: { prizes: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ crates });
  } catch (err) {
    console.error('[crates] adminListCrates error', err.message);
    return res.status(500).json({ error: 'Could not fetch crates.' });
  }
}

async function adminCreateCrate(req, res) {
  const { name, slug, description = '', image = '', price, active = true } = req.body;
  if (!name || !slug || price == null) {
    return res.status(422).json({ error: 'name, slug, and price are required.' });
  }
  const safeSlug = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80);
  try {
    const crate = await prisma.crate.create({
      data: {
        name: String(name).slice(0, 100),
        slug: safeSlug,
        description: String(description).slice(0, 500),
        image: String(image).slice(0, 500),
        price: Math.max(0, parseFloat(price)),
        active: Boolean(active),
      },
    });
    return res.status(201).json({ crate });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Slug already exists.' });
    console.error('[crates] adminCreateCrate error', err.message);
    return res.status(500).json({ error: 'Could not create crate.' });
  }
}

async function adminUpdateCrate(req, res) {
  const { id } = req.params;
  const { name, description, image, price, active } = req.body;
  const data = {};
  if (name       != null) data.name        = String(name).slice(0, 100);
  if (description != null) data.description = String(description).slice(0, 500);
  if (image      != null) data.image       = String(image).slice(0, 500);
  if (price      != null) data.price       = Math.max(0, parseFloat(price));
  if (active     != null) data.active      = Boolean(active);
  try {
    const crate = await prisma.crate.update({ where: { id }, data });
    return res.json({ crate });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Crate not found.' });
    console.error('[crates] adminUpdateCrate error', err.message);
    return res.status(500).json({ error: 'Could not update crate.' });
  }
}

async function adminDeleteCrate(req, res) {
  const { id } = req.params;
  try {
    await prisma.crate.delete({ where: { id } });
    return res.sendStatus(204);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Crate not found.' });
    console.error('[crates] adminDeleteCrate error', err.message);
    return res.status(500).json({ error: 'Could not delete crate.' });
  }
}

async function adminAddPrize(req, res) {
  const { id: crateId } = req.params;
  const {
    itemType = 'SHARD',
    productId,
    discountedPrice = 0,
    itemValue = 0,
    coinAmount = 0,
    weight = 100,
    rarity = 'common',
  } = req.body;

  const validTypes    = ['SHARD', 'WILDCARD_SHARD', 'DISCOUNT_VOUCHER', 'MUG_VOUCHER', 'DORK_COIN'];
  const validRarities = ['common', 'uncommon', 'rare', 'legendary'];
  const safeType   = validTypes.includes(itemType)    ? itemType   : 'SHARD';
  const safeRarity = validRarities.includes(rarity)   ? rarity     : 'common';

  // productId required for SHARD and MUG_VOUCHER
  const needsProduct = safeType === 'SHARD' || safeType === 'MUG_VOUCHER';
  if (needsProduct && !productId) {
    return res.status(422).json({ error: 'productId is required for SHARD and MUG_VOUCHER drop types.' });
  }

  try {
    const prize = await prisma.cratePrize.create({
      data: {
        crateId,
        productId:       needsProduct ? String(productId).slice(0, 50) : (productId ? String(productId).slice(0, 50) : ''),
        discountedPrice: Math.max(0, parseFloat(discountedPrice) || 0),
        itemType:        safeType,
        itemValue:       Math.max(0, parseFloat(itemValue)  || 0),
        coinAmount:      Math.max(0, parseInt(coinAmount, 10) || 0),
        weight:          Math.max(1, parseInt(weight, 10)   || 100),
        rarity:          safeRarity,
      },
    });
    return res.status(201).json({ prize });
  } catch (err) {
    if (err.code === 'P2003') return res.status(404).json({ error: 'Crate or product not found.' });
    console.error('[crates] adminAddPrize error', err.message);
    return res.status(500).json({ error: 'Could not add prize.' });
  }
}

async function adminDeletePrize(req, res) {
  const { prizeId } = req.params;
  try {
    await prisma.cratePrize.delete({ where: { id: prizeId } });
    return res.sendStatus(204);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Prize not found.' });
    console.error('[crates] adminDeletePrize error', err.message);
    return res.status(500).json({ error: 'Could not delete prize.' });
  }
}

async function adminListOpenings(req, res) {
  try {
    const openings = await prisma.crateOpening.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return res.json({ openings });
  } catch (err) {
    console.error('[crates] adminListOpenings error', err.message);
    return res.status(500).json({ error: 'Could not fetch openings.' });
  }
}

// ── Inventory routes ──────────────────────────────────────────────────────────

/**
 * GET /api/crates/inventory
 * Returns the authenticated user's full inventory grouped by type.
 */
async function getInventory(req, res) {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { userId: req.user.id, redeemed: false },
      orderBy: { createdAt: 'asc' },
    });

    // Collect all productIds we need
    const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))];
    const products = productIds.length
      ? await prisma.shopProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, pname: true, imageLeft: true, price: true },
        })
      : [];
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // Group shards by productId
    const shardMap = {};
    for (const item of items.filter(i => i.type === 'SHARD')) {
      const pid = item.productId || '__unknown__';
      if (!shardMap[pid]) shardMap[pid] = 0;
      shardMap[pid] += item.quantity;
    }
    const shards = Object.entries(shardMap).map(([pid, count]) => {
      const prod = productMap[pid];
      return {
        productId:    pid,
        productName:  prod ? prod.pname  : 'Unknown Mug',
        productImage: prod ? prod.imageLeft : '',
        count,
        needed: SHARDS_TO_MERGE,
        ready:  count >= SHARDS_TO_MERGE,
      };
    });

    // Wildcard total
    const wildcardShards = items
      .filter(i => i.type === 'WILDCARD_SHARD')
      .reduce((sum, i) => sum + i.quantity, 0);

    // Discount vouchers
    const discountVouchers = items
      .filter(i => i.type === 'DISCOUNT_VOUCHER')
      .map(i => ({ id: i.id, value: i.value, redeemed: i.redeemed }));

    // Mug vouchers
    const mugVouchers = items
      .filter(i => i.type === 'MUG_VOUCHER')
      .map(i => {
        const prod = productMap[i.productId];
        return {
          id:           i.id,
          productId:    i.productId,
          productName:  prod ? prod.pname    : 'Unknown Mug',
          productImage: prod ? prod.imageLeft : '',
          redeemed:     i.redeemed,
        };
      });

    // Coin balance
    const coinBalance = items
      .filter(i => i.type === 'DORK_COIN')
      .reduce((sum, i) => sum + (i.value || 0) * i.quantity, 0);

    return res.json({ shards, wildcardShards, discountVouchers, mugVouchers, coinBalance, raw: items });
  } catch (err) {
    console.error('[crates] getInventory error', err.message);
    return res.status(500).json({ error: 'Could not fetch inventory.' });
  }
}

/**
 * POST /api/crates/merge
 * Body: { productId }
 * Burns 10 shards (regular + wildcard) into a MUG_VOUCHER.
 */
async function mergeShards(req, res) {
  const { productId } = req.body;
  if (!productId) return res.status(422).json({ error: 'productId is required.' });

  const product = await prisma.shopProduct.findUnique({ where: { id: String(productId) } });
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const regularShards = await tx.inventoryItem.findMany({
        where: { userId: req.user.id, type: 'SHARD', productId: String(productId), redeemed: false },
        orderBy: { createdAt: 'asc' },
      });
      const wildcardShards = await tx.inventoryItem.findMany({
        where: { userId: req.user.id, type: 'WILDCARD_SHARD', redeemed: false },
        orderBy: { createdAt: 'asc' },
      });

      const regularTotal  = regularShards.reduce((s, i) => s + i.quantity, 0);
      const wildcardTotal = wildcardShards.reduce((s, i) => s + i.quantity, 0);

      if (regularTotal + wildcardTotal < SHARDS_TO_MERGE) {
        throw Object.assign(new Error('Not enough shards to merge.'), { status: 422 });
      }

      let needed = SHARDS_TO_MERGE;
      let shardsUsed = 0;
      let wildcardsUsed = 0;

      // Consume regular shards first
      for (const item of regularShards) {
        if (needed <= 0) break;
        const consume = Math.min(item.quantity, needed);
        const remaining = item.quantity - consume;
        if (remaining === 0) {
          await tx.inventoryItem.update({ where: { id: item.id }, data: { redeemed: true, redeemedAt: new Date() } });
        } else {
          await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: remaining } });
        }
        needed    -= consume;
        shardsUsed += consume;
      }

      // Fill gap with wildcards
      for (const item of wildcardShards) {
        if (needed <= 0) break;
        const consume = Math.min(item.quantity, needed);
        const remaining = item.quantity - consume;
        if (remaining === 0) {
          await tx.inventoryItem.update({ where: { id: item.id }, data: { redeemed: true, redeemedAt: new Date() } });
        } else {
          await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: remaining } });
        }
        needed       -= consume;
        wildcardsUsed += consume;
      }

      // Create the voucher
      const voucher = await tx.inventoryItem.create({
        data: { userId: req.user.id, type: 'MUG_VOUCHER', productId: String(productId), source: 'MERGE' },
      });

      // Record the merge
      await tx.shardMerge.create({
        data: {
          userId:        req.user.id,
          productId:     String(productId),
          shardsUsed,
          wildcardCount: wildcardsUsed,
          voucherItemId: voucher.id,
        },
      });

      return { voucher, shardsUsed, wildcardsUsed };
    });

    return res.status(201).json(result);
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message });
    console.error('[crates] mergeShards error', err.message);
    return res.status(500).json({ error: 'Could not merge shards.' });
  }
}

/**
 * POST /api/crates/redeem/:voucherId
 * Convert a MUG_VOUCHER into a 100%-off Stripe checkout session.
 */
async function redeemVoucher(req, res) {
  const { voucherId } = req.params;
  try {
    const voucher = await prisma.inventoryItem.findFirst({
      where: { id: voucherId, userId: req.user.id, type: 'MUG_VOUCHER', redeemed: false },
    });
    if (!voucher) return res.status(404).json({ error: 'Voucher not found or already redeemed.' });

    const product = await prisma.shopProduct.findUnique({
      where: { id: voucher.productId },
      select: { id: true, pname: true, price: true, imageLeft: true, printifyIdLeft: true, variantIdLeft: true },
    });
    if (!product) return res.status(404).json({ error: 'Voucher product not found.' });

    const successUrl = config.stripe.successUrl + '?session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl  = config.stripe.cancelUrl;
    const priceInCents = Math.round(product.price * 100);

    const items = [{
      name:              product.pname + ' (Voucher Redemption)',
      price:             priceInCents,
      qty:               1,
      image:             product.imageLeft || undefined,
      printifyProductId: product.printifyIdLeft || undefined,
      variantId:         product.variantIdLeft  || undefined,
      placement:         'left',
    }];

    const metadata = {
      items: JSON.stringify([{
        printifyProductId: product.printifyIdLeft || null,
        variantId:         product.variantIdLeft  || null,
        qty:               1,
        placement:         'left',
      }]),
      userId:    req.user.id,
      userEmail: req.user.email,
      voucherId,
    };

    // Create a 100%-off one-time Stripe coupon
    const stripe = stripeSvc.stripeClient;
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration:    'once',
      name:        'Mug Voucher Redemption',
    });

    // Do NOT mark the voucher redeemed here — only mark it after payment
    // completes (handled in orderService.ensureOrderFromSession via metadata.voucherId).
    const session = await stripeSvc.createCheckoutSession(
      items, metadata, successUrl, cancelUrl, req.user.email, coupon.id
    );

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[crates] redeemVoucher error', err.message);
    return res.status(500).json({ error: 'Could not redeem voucher.' });
  }
}

module.exports = {
  listCrates,
  myInventory,
  openCrate,
  claimPrize,
  getInventory,
  mergeShards,
  redeemVoucher,
  adminListCrates,
  adminCreateCrate,
  adminUpdateCrate,
  adminDeleteCrate,
  adminAddPrize,
  adminDeletePrize,
  adminListOpenings,
};

// src/controllers/crates.js — crate (loot-box) system
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const stripeSvc = require('../services/stripe');
const config    = require('../config');

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
 * Open a crate the user owns. Returns the prize.
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

    // Create opening record, mark crate as opened — atomically
    const [, opening] = await prisma.$transaction([
      prisma.userCrate.update({
        where: { id: userCrateId },
        data: { opened: true, openedAt: new Date() },
      }),
      prisma.crateOpening.create({
        data: {
          userCrateId,
          userId:    req.user.id,
          prizeId:   prize.id,
          productId: prize.productId,
          wonPrice:  prize.discountedPrice,
          claimToken: crypto.randomUUID(),
        },
      }),
    ]);

    // Enrich with product info
    const product = await prisma.shopProduct.findUnique({
      where: { id: prize.productId },
      select: { id: true, pname: true, imageLeft: true, price: true },
    });

    return res.json({
      opening: { ...opening, prize, product },
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
  const { productId, discountedPrice, weight = 100, rarity = 'common' } = req.body;
  if (!productId || discountedPrice == null) {
    return res.status(422).json({ error: 'productId and discountedPrice are required.' });
  }
  const validRarities = ['common', 'uncommon', 'rare', 'legendary'];
  const safeRarity = validRarities.includes(rarity) ? rarity : 'common';
  try {
    const prize = await prisma.cratePrize.create({
      data: {
        crateId,
        productId: String(productId).slice(0, 50),
        discountedPrice: Math.max(0, parseFloat(discountedPrice)),
        weight: Math.max(1, parseInt(weight, 10) || 100),
        rarity: safeRarity,
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

module.exports = {
  listCrates,
  myInventory,
  openCrate,
  claimPrize,
  adminListCrates,
  adminCreateCrate,
  adminUpdateCrate,
  adminDeleteCrate,
  adminAddPrize,
  adminDeletePrize,
  adminListOpenings,
};

// src/controllers/checkout.js — creates a Stripe Checkout Session and returns the hosted URL
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const stripeSvc = require('../services/stripe');
const { ensureOrderFromSession } = require('../services/orderService');
const config = require('../config');
const { COIN_TO_DOLLAR, MAX_COIN_DISCOUNT_PCT } = require('../config/crateDrops');

const prisma = new PrismaClient();

// Domains we trust as image sources for the download proxy
const ALLOWED_IMAGE_HOSTS = [
  'images.printify.com',
  'cdn.printify.com',
  'storage.googleapis.com',
];

/**
 * POST /api/checkout
 * Body: {
 *   items: [{
 *     name: string,
 *     price: number,   // in cents (e.g. 2499 for $24.99)
 *     qty: number,
 *     image?: string,
 *     printifyProductId?: string,
 *     variantId?: string,
 *   }]
 * }
 * Returns: { url }  — Stripe hosted checkout URL
 */
async function createCheckout(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(422).json({ error: 'Cart is empty.' });
  }

  // Sanitise
  const sanitised = items.map((item) => ({
    id: item.id ? String(item.id).slice(0, 50) : undefined,
    name: String(item.name).slice(0, 250),
    price: Math.max(1, Math.round(Number(item.price))), // cents — will be overwritten by DB price below
    qty: Math.max(1, parseInt(item.qty, 10) || 1),
    image: item.image ? String(item.image) : undefined,
    printifyProductId: item.printifyProductId ? String(item.printifyProductId) : undefined,
    variantId: item.variantId ? String(item.variantId) : undefined,
    placement: ['left', 'center', 'right'].includes(item.placement) ? item.placement : 'left',
    crateId: item.crateId ? String(item.crateId).slice(0, 50) : undefined,
  }));

  // ── Server-side price validation ────────────────────────────────────────────
  // Look up prices from the DB for any item that carries a product ID.
  // This prevents a client from manipulating the price before checkout.
  const productIds = [...new Set(sanitised.map((i) => i.id).filter(Boolean))];
  if (productIds.length > 0) {
    const dbProducts = await prisma.shopProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, price: true },
    });
    const dbPriceMap = Object.fromEntries(dbProducts.map((p) => [p.id, Math.round(p.price * 100)]));
    for (const item of sanitised) {
      if (item.id && dbPriceMap[item.id] !== undefined) {
        item.price = dbPriceMap[item.id]; // cents, authoritative from DB
      }
    }
  }

  // ── Crate key price validation ───────────────────────────────────────────────
  // Items with crateId are crate keys; look up price from the Crate table.
  const crateIds = [...new Set(sanitised.map((i) => i.crateId).filter(Boolean))];
  if (crateIds.length > 0) {
    const dbCrates = await prisma.crate.findMany({
      where: { id: { in: crateIds }, active: true },
      select: { id: true, price: true, name: true },
    });
    const cratePriceMap = Object.fromEntries(dbCrates.map((c) => [c.id, { price: Math.round(c.price * 100), name: c.name }]));
    for (const item of sanitised) {
      if (item.crateId && cratePriceMap[item.crateId] !== undefined) {
        item.price = cratePriceMap[item.crateId].price; // override with DB price
        item.name  = `${cratePriceMap[item.crateId].name} Key`; // canonical name
      }
    }
  }

  // Metadata stored on session — used by the Stripe webhook and success page.
  // NOTE: Stripe enforces a 500-char limit per metadata value. Images are omitted
  // to stay well within the limit; the download feature degrades gracefully.
  const metaItems = sanitised.map((i) => ({
    printifyProductId: i.printifyProductId || null,
    variantId: i.variantId || null,
    qty: i.qty,
    placement: i.placement,
    crateId: i.crateId || null,
  }));
  const metaItemsJson = JSON.stringify(metaItems);
  if (metaItemsJson.length > 490) {
    console.warn(`[checkout] metadata.items is ${metaItemsJson.length} chars — may exceed Stripe's 500-char limit.`);
  }
  const metadata = {
    items: metaItemsJson,
    userId: req.user?.id || '',
    userEmail: req.user?.email || '',
  };

  // Append session_id placeholder so success page can display order info
  const successUrl = config.stripe.successUrl + '?session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = config.stripe.cancelUrl;
  const customerEmail = req.user?.email || undefined;

  // ── Zero-charge promo detection ─────────────────────────────────────────────
  // If the client supplied a promo code, look it up. If its underlying coupon
  // carries zero_charge:'true' metadata the session will pre-apply it AND use
  // $0 shipping so the entire order totals $0 (for test/admin use).
  let zeroChargePromoId = null;
  const rawPromoCode = typeof req.body.promoCode === 'string' ? req.body.promoCode.trim().toUpperCase() : null;
  if (rawPromoCode) {
    try {
      const stripe = stripeSvc.stripeClient;
      const results = await stripe.promotionCodes.list({
        code: rawPromoCode,
        limit: 1,
        active: true,
        expand: ['data.coupon'],
      });
      if (results.data.length && results.data[0].coupon?.metadata?.zero_charge === 'true') {
        zeroChargePromoId = results.data[0].id;
      }
    } catch (lookupErr) {
      // Non-fatal: fall through to normal checkout with allow_promotion_codes
      console.warn('[checkout] promo lookup failed:', lookupErr.message);
    }
  }

  // ── Dork Coin discount ──────────────────────────────────────────────────────
  // If coinDiscount is provided, validate the user has enough coins and create
  // a one-time Stripe coupon for the dollar-equivalent discount.
  let coinCouponId = null;
  const rawCoinDiscount = req.body.coinDiscount;
  if (rawCoinDiscount && req.user) {
    const coinDiscount = Math.max(0, parseInt(rawCoinDiscount, 10) || 0);
    if (coinDiscount > 0) {
      // Compute subtotal in cents
      const subtotalCents = sanitised.reduce((sum, i) => sum + i.price * i.qty, 0);
      const maxDiscountCents = Math.floor(subtotalCents * MAX_COIN_DISCOUNT_PCT / 100);
      const dollarDiscount = Math.min(
        Math.floor(coinDiscount / COIN_TO_DOLLAR),
        Math.floor(maxDiscountCents / 100)
      );

      if (dollarDiscount > 0) {
        // Validate user coin balance
        const coinItems = await prisma.inventoryItem.findMany({
          where: { userId: req.user.id, type: 'DORK_COIN', redeemed: false },
          orderBy: { createdAt: 'asc' },
        });
        const balance = coinItems.reduce((s, i) => s + (i.value || 0) * i.quantity, 0);
        const coinsNeeded = dollarDiscount * COIN_TO_DOLLAR;
        if (balance < coinsNeeded) {
          return res.status(422).json({ error: 'Not enough Dork Coins for that discount.' });
        }

        // Mark coin items as redeemed up to coinsNeeded
        let remaining = coinsNeeded;
        for (const item of coinItems) {
          if (remaining <= 0) break;
          const itemCoins = (item.value || 0) * item.quantity;
          if (itemCoins <= remaining) {
            await prisma.inventoryItem.update({
              where: { id: item.id },
              data:  { redeemed: true, redeemedAt: new Date() },
            });
            remaining -= itemCoins;
          } else {
            // Partial: split item — mark enough as redeemed
            const consumeQty = Math.ceil(remaining / (item.value || 1));
            const keepQty    = item.quantity - consumeQty;
            await prisma.inventoryItem.update({ where: { id: item.id }, data: { quantity: keepQty } });
            await prisma.inventoryItem.create({
              data: {
                userId:    req.user.id,
                type:      'DORK_COIN',
                value:     item.value,
                quantity:  consumeQty,
                redeemed:  true,
                redeemedAt: new Date(),
                source:    'CRATE',
              },
            });
            remaining = 0;
          }
        }

        // Create a one-time Stripe coupon
        try {
          const stripe = stripeSvc.stripeClient;
          const coupon = await stripe.coupons.create({
            amount_off: dollarDiscount * 100,
            currency:   'usd',
            duration:   'once',
          });
          coinCouponId = coupon.id;
        } catch (couponErr) {
          console.error('[checkout] coin coupon creation failed:', couponErr.message);
          // Non-fatal: proceed without coin discount
        }
      }
    }
  }

  try {
    const session = await stripeSvc.createCheckoutSession(
      sanitised, metadata, successUrl, cancelUrl, customerEmail,
      coinCouponId || zeroChargePromoId
    );
    return res.json({ url: session.url });
  } catch (err) {
    console.error('[checkout] createCheckout error', err.message);
    return res.status(502).json({ error: 'Could not create checkout. Please try again.' });
  }
}

/**
 * GET /api/checkout/session/:sessionId
 * Returns item details (name, image, placement) for a paid Stripe session.
 * No auth required — the unguessable session ID acts as the token.
 */
async function getSession(req, res) {
  const { sessionId } = req.params;
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  try {
    const session = await stripeSvc.retrieveSession(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not yet completed.' });
    }

    // Ensure the order exists in the DB — this is the fallback for when the
    // Stripe webhook hasn't fired yet (e.g. webhook not configured in dashboard).
    // ensureOrderFromSession is fully idempotent so calling it here is safe.
    const order = await ensureOrderFromSession(session).catch((err) => {
      console.error('[checkout] getSession order ensure failed:', err.message);
      return null;
    });

    const metaItems = JSON.parse(session.metadata?.items || '[]');
    return res.json({
      items: metaItems,
      email: session.customer_details?.email || '',
      orderId: order?.id || null,
    });
  } catch (err) {
    console.error('[checkout] getSession error', err.message);
    return res.status(502).json({ error: 'Could not retrieve session.' });
  }
}

/**
 * GET /api/checkout/download/:sessionId/:itemIndex
 * Proxies the product image for a paid session as an attachment download.
 */
async function downloadImage(req, res) {
  const { sessionId, itemIndex } = req.params;
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  const idx = parseInt(itemIndex, 10);
  if (isNaN(idx) || idx < 0 || idx > 20) {
    return res.status(400).json({ error: 'Invalid item index.' });
  }
  try {
    const session = await stripeSvc.retrieveSession(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(403).json({ error: 'Payment not completed.' });
    }
    const metaItems = JSON.parse(session.metadata?.items || '[]');
    const item = metaItems[idx];
    if (!item?.image) return res.status(404).json({ error: 'No image for this item.' });

    // Validate the image URL is from a trusted host
    let parsed;
    try { parsed = new URL(item.image); } catch { return res.status(400).json({ error: 'Invalid image URL.' }); }
    if (!ALLOWED_IMAGE_HOSTS.includes(parsed.hostname)) {
      return res.status(400).json({ error: 'Image host not allowed.' });
    }

    const ext = (parsed.pathname.match(/\.(jpe?g|png|webp|gif)$/i) || ['', '.jpg'])[0];
    const safeName = (item.name || 'design').replace(/[^a-z0-9\-_ ]/gi, '_').slice(0, 60);
    const filename = `${safeName}_${item.placement || 'left'}${ext}`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const fetcher = parsed.protocol === 'https:' ? https : http;
    fetcher.get(item.image, (upstream) => {
      const ct = upstream.headers['content-type'] || 'application/octet-stream';
      res.setHeader('Content-Type', ct);
      upstream.pipe(res);
    }).on('error', () => res.status(502).json({ error: 'Failed to fetch image.' }));
  } catch (err) {
    console.error('[checkout] downloadImage error', err.message);
    return res.status(502).json({ error: 'Could not process download.' });
  }
}

module.exports = { createCheckout, getSession, downloadImage };

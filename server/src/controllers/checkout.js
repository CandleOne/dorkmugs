// src/controllers/checkout.js — creates a Stripe Checkout Session and returns the hosted URL
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { validationResult } = require('express-validator');
const stripeSvc = require('../services/stripe');
const config = require('../config');

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
    name: String(item.name).slice(0, 250),
    price: Math.max(1, Math.round(Number(item.price))), // cents
    qty: Math.max(1, parseInt(item.qty, 10) || 1),
    image: item.image ? String(item.image) : undefined,
    printifyProductId: item.printifyProductId ? String(item.printifyProductId) : undefined,
    variantId: item.variantId ? String(item.variantId) : undefined,
    placement: ['left', 'center', 'right'].includes(item.placement) ? item.placement : 'left',
  }));

  // Metadata stored on session — used by the Stripe webhook and success page.
  // NOTE: Stripe enforces a 500-char limit per metadata value. Images are omitted
  // to stay well within the limit; the download feature degrades gracefully.
  const metaItems = sanitised.map((i) => ({
    printifyProductId: i.printifyProductId || null,
    variantId: i.variantId || null,
    qty: i.qty,
    name: i.name,
    placement: i.placement,
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

  try {
    const session = await stripeSvc.createCheckoutSession(
      sanitised, metadata, successUrl, cancelUrl, customerEmail
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
    const metaItems = JSON.parse(session.metadata?.items || '[]');
    return res.json({ items: metaItems, email: session.customer_details?.email || '' });
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

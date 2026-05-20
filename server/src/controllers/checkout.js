// src/controllers/checkout.js — creates a Stripe Checkout Session and returns the hosted URL
const { validationResult } = require('express-validator');
const stripeSvc = require('../services/stripe');
const config = require('../config');

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
  }));

  // Metadata stored on session — used by the Stripe webhook to create the Printify order
  const metadata = {
    items: JSON.stringify(
      sanitised.map((i) => ({
        printifyProductId: i.printifyProductId,
        variantId: i.variantId,
        qty: i.qty,
      }))
    ),
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

module.exports = { createCheckout };

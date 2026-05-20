// src/services/stripe.js — Stripe Checkout Session creation + webhook verification
const Stripe = require('stripe');
const config = require('../config');

const stripe = Stripe(config.stripe.secretKey);

function toStripeImage(image) {
  if (!image) return null;
  try {
    const url = new URL(String(image));
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch (_err) {
    // Ignore invalid/relative image URLs; Stripe requires absolute URLs.
  }
  return null;
}

/**
 * Create a Stripe Checkout Session.
 *
 * @param {Array<{name:string, price:number, qty:number, image?:string}>} items
 *   price is in cents (integer).
 * @param {Object} metadata  Stored on the session; use for Printify order data.
 * @param {string} successUrl
 * @param {string} cancelUrl
 * @param {string} [customerEmail]
 * @returns {Promise<{id:string, url:string}>}
 */
async function createCheckoutSession(items, metadata, successUrl, cancelUrl, customerEmail) {
  const lineItems = items.map((item) => {
    const imageUrl = toStripeImage(item.image);
    return {
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          ...(imageUrl ? { images: [imageUrl] } : {}),
        },
        unit_amount: Math.round(item.price), // already in cents
      },
      quantity: item.qty,
    };
  });

  const sessionParams = {
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: lineItems,
    shipping_address_collection: {
      allowed_countries: ['US', 'CA', 'GB', 'AU'],
    },
    metadata,
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  if (customerEmail) sessionParams.customer_email = customerEmail;

  const session = await stripe.checkout.sessions.create(sessionParams);
  return { id: session.id, url: session.url };
}

/**
 * Retrieve a completed session (with line_items expanded) — used in webhook.
 */
async function retrieveSession(sessionId) {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items'],
  });
}

/**
 * Verify Stripe webhook signature.
 * @param {Buffer} rawBody
 * @param {string} sig  Stripe-Signature header value
 * @returns {Object} Stripe event
 * @throws if signature invalid
 */
function constructEvent(rawBody, sig) {
  return stripe.webhooks.constructEvent(rawBody, sig, config.stripe.webhookSecret);
}

module.exports = { createCheckoutSession, retrieveSession, constructEvent };

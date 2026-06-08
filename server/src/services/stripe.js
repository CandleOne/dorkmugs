// src/services/stripe.js — Stripe Checkout Session creation + webhook verification
const Stripe = require('stripe');
const config = require('../config');

const stripe = Stripe(config.stripe.secretKey);

// Exported so other modules (e.g. checkout controller) can call the Stripe API
// directly without re-instantiating the client.
module.exports.stripeClient = stripe;

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
 * @param {string|null} [promoOrCouponId]  Stripe promotion_code ID (promo_xxx) or coupon ID (other)
 * @returns {Promise<{id:string, url:string}>}
 */
async function createCheckoutSession(items, metadata, successUrl, cancelUrl, customerEmail, promoOrCouponId) {
  const lineItems = items.map((item) => {
    const imageUrl = toStripeImage(item.image);
    const unitAmount = Math.max(0, Math.round(item.price)); // allow $0 for voucher redemptions
    return {
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          ...(imageUrl ? { images: [imageUrl] } : {}),
        },
        unit_amount: unitAmount,
      },
      quantity: item.qty,
    };
  });

  // Calculate subtotal (cents)
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, Math.round(item.price)) * item.qty, 0);
  const FREE_SHIPPING_THRESHOLD = 4000; // $40.00 in cents

  // Detect if this is a digital-only order (all crate keys, no printify products)
  const hasPhysical = items.some((i) => i.printifyProductId);
  const allDigital  = !hasPhysical;

  const shippingOptions = allDigital
    ? [] // no shipping for digital orders
    : [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: (promoOrCouponId || subtotal >= FREE_SHIPPING_THRESHOLD) ? 0 : 499,
              currency: 'usd',
            },
            display_name: (promoOrCouponId || subtotal >= FREE_SHIPPING_THRESHOLD) ? 'Free Shipping' : 'Standard Shipping',
          },
        },
      ];

  const sessionParams = {
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: lineItems,
    metadata,
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  // Only add shipping_options when there are physical items
  if (shippingOptions.length > 0) {
    sessionParams.shipping_options = shippingOptions;
    sessionParams.shipping_address_collection = { allowed_countries: ['US', 'CA', 'GB', 'AU'] };
  }

  // Support $0 totals (e.g. voucher redemptions)
  if (subtotal === 0) {
    sessionParams.payment_method_collection = 'if_required';
  }

  if (promoOrCouponId) {
    // Promotion code IDs start with "promo_"; coupon IDs start with anything else
    if (String(promoOrCouponId).startsWith('promo_')) {
      sessionParams.discounts = [{ promotion_code: promoOrCouponId }];
    } else {
      sessionParams.discounts = [{ coupon: promoOrCouponId }];
    }
  } else {
    sessionParams.allow_promotion_codes = true;
  }

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

module.exports = { stripeClient: stripe, createCheckoutSession, retrieveSession, constructEvent };

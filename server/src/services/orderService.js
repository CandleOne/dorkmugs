// services/orderService.js
// Shared order-creation logic used by both the Stripe webhook and the
// GET /api/checkout/session endpoint (success page).  Either path can be the
// first to see a completed session, so both call this and idempotency is
// enforced by the unique stripeSessionId constraint.

const { PrismaClient } = require('@prisma/client');
const stripeSvc = require('./stripe');
const printify  = require('./printify');
const emailSvc  = require('./email');

const prisma = new PrismaClient();

/**
 * Idempotently create an Order (+ Printify submission) from a completed Stripe
 * Checkout Session object.
 *
 * @param {Object} session  Stripe CheckoutSession (must have payment_status === 'paid')
 * @returns {Object|null}   The created or existing Prisma order, or null on error
 */
async function ensureOrderFromSession(session) {
  // ── Idempotency check ──────────────────────────────────────────────────────
  const existing = await prisma.order.findFirst({
    where: { stripeSessionId: session.id },
    include: { items: true },
  });
  if (existing) return existing;

  const metadata = session.metadata || {};
  // Stripe puts the address in shipping_details when a dedicated shipping step is
  // shown at checkout, but falls back to customer_details when collect_shipping_address
  // is not set — handle both.
  const shipping  = session.shipping_details?.address || session.customer_details?.address || {};
  const shippingName = session.shipping_details?.name || session.customer_details?.name || '';
  const email     = session.customer_details?.email || metadata.userEmail || '';

  let cartItems = [];
  try {
    cartItems = JSON.parse(metadata.items || '[]');
  } catch {
    console.error('[orderService] Could not parse session metadata.items');
  }

  const total = session.amount_total || 0; // cents

  const orderData = {
    stripeSessionId: session.id,
    email,
    total: total / 100,
    status: 'PROCESSING',
    shippingName,
    shippingLine1:   shipping.line1        || '',
    shippingLine2:   shipping.line2        || null,
    shippingCity:    shipping.city         || '',
    shippingState:   shipping.state        || '',
    shippingZip:     shipping.postal_code  || '',
    shippingCountry: shipping.country      || 'US',
  };
  if (metadata.userId) orderData.userId = metadata.userId;

  // Fetch canonical line items from Stripe (includes names / amounts)
  const fullSession = await stripeSvc.retrieveSession(session.id);
  const stripeLineItems = fullSession.line_items?.data || [];

  const order = await prisma.order.create({
    data: {
      ...orderData,
      items: {
        create: stripeLineItems.map((li, idx) => {
          const meta = cartItems[idx] || {};
          return {
            productId: meta.printifyProductId || '',
            variantId: meta.variantId         || '',
            name:      li.description || li.price?.product || 'Item',
            price:     (li.price?.unit_amount || 0) / 100,
            qty:       li.quantity || 1,
            image:     null,
            placement: meta.placement || 'left',
          };
        }),
      },
    },
    include: { items: true },
  });

  // Send confirmation email (non-fatal)
  emailSvc.sendOrderConfirmation(email, order).catch(() => {});

  // Fulfill any crate keys in this order
  fulfillCrateKeys(session, cartItems, metadata.userId || null).catch((err) => {
    console.error('[orderService] fulfillCrateKeys failed:', err.message);
  });

  // Submit to Printify if we have variant data
  const printifyLines = cartItems.filter((i) => i.printifyProductId && i.variantId);
  if (printifyLines.length > 0) {
    try {
      const nameParts = shippingName.trim().split(' ');
      const firstName = nameParts[0] || 'Customer';
      const lastName  = nameParts.slice(1).join(' ') || '.';

      const printifyOrder = await printify.createOrder({
        external_id: order.id,
        line_items: printifyLines.map((i) => ({
          product_id: i.printifyProductId,
          variant_id: parseInt(i.variantId, 10),
          quantity:   i.qty,
        })),
        shipping_method: 1,
        send_shipping_notification: true,
        address_to: {
          first_name: firstName,
          last_name:  lastName,
          email,
          phone:    session.customer_details?.phone || '',
          country:  shipping.country      || 'US',
          region:   shipping.state        || '',
          address1: shipping.line1        || '',
          address2: shipping.line2        || '',
          city:     shipping.city         || '',
          zip:      shipping.postal_code  || '',
        },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { printifyOrderId: String(printifyOrder.id) },
      });

      await printify.sendOrderToProduction(printifyOrder.id);
    } catch (err) {
      console.error('[orderService] Printify order creation failed:', err.message);
    }
  }

  return order;
}

/**
 * If a completed Stripe session contains crate key items, create UserCrate
 * records so the user can open them. Idempotent — guarded by stripeSessionId.
 */
async function fulfillCrateKeys(session, cartItems, userId) {
  if (!userId) return; // guest checkouts can't have user crates
  const crateItems = cartItems.filter((i) => i.crateId);
  if (!crateItems.length) return;

  for (const item of crateItems) {
    const qty = item.qty || 1;
    // Verify crate exists to avoid orphaned records
    const crate = await prisma.crate.findUnique({ where: { id: item.crateId }, select: { id: true } });
    if (!crate) { console.warn(`[orderService] crateId ${item.crateId} not found — skipping`); continue; }

    for (let i = 0; i < qty; i++) {
      // Skip if we already created this key (re-entrancy guard)
      const existing = await prisma.userCrate.findFirst({
        where: { userId, crateId: item.crateId, stripeSessionId: session.id },
      });
      if (existing) break;

      await prisma.userCrate.create({
        data: { userId, crateId: item.crateId, stripeSessionId: session.id },
      });
    }
  }
}

module.exports = { ensureOrderFromSession };

// src/controllers/webhooks.js
// Handles incoming webhooks from Stripe (payment events) and Printify (fulfillment)
const { PrismaClient } = require('@prisma/client');
const stripeSvc = require('../services/stripe');
const printify = require('../services/printify');
const emailSvc = require('../services/email');

const prisma = new PrismaClient();

// ─── Stripe webhook ───────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/stripe
 * Stripe sends raw body + Stripe-Signature header.
 * Express must NOT JSON-parse this route — raw buffer required (handled in app.js).
 */
async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing Stripe-Signature header.' });

  let event;
  try {
    event = stripeSvc.constructEvent(req.rawBody, sig);
  } catch (err) {
    console.error('[webhook] Stripe signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleSessionCompleted(event.data.object);
    }
  } catch (err) {
    console.error(`[webhook] stripe ${event.type} error`, err.message);
    // Return 500 so Stripe retries
    return res.status(500).json({ error: 'Webhook handler failed.' });
  }

  return res.sendStatus(200);
}

async function handleSessionCompleted(session) {
  // Idempotency — skip if we already processed this session
  const existing = await prisma.order.findFirst({
    where: { stripeSessionId: session.id },
  });
  if (existing) return;

  const metadata = session.metadata || {};
  const shipping = session.shipping_details?.address || {};
  const shippingName = session.shipping_details?.name || session.customer_details?.name || '';
  const email = session.customer_details?.email || metadata.userEmail || '';

  // Parse the cart items stored in metadata
  let cartItems = [];
  try {
    cartItems = JSON.parse(metadata.items || '[]');
  } catch {
    console.error('[webhook] Could not parse session metadata.items');
  }

  const total = session.amount_total || 0; // in cents

  // Create Order in DB
  const orderData = {
    stripeSessionId: session.id,
    email,
    total: total / 100, // store as dollars
    status: 'PROCESSING',
    shippingName,
    shippingLine1: shipping.line1 || '',
    shippingLine2: shipping.line2 || null,
    shippingCity: shipping.city || '',
    shippingState: shipping.state || '',
    shippingZip: shipping.postal_code || '',
    shippingCountry: shipping.country || 'US',
  };

  // Link to user account if userId in metadata
  if (metadata.userId) orderData.userId = metadata.userId;

  // Retrieve line items from Stripe for canonical names/prices
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
            variantId: meta.variantId || '',
            name: li.description || li.price?.product || 'Item',
            price: (li.price?.unit_amount || 0) / 100,
            qty: li.quantity || 1,
            image: null,
          };
        }),
      },
    },
    include: { items: true },
  });

  // Send confirmation email
  emailSvc.sendOrderConfirmation(email, order).catch(() => {});

  // Create Printify order if we have variant data
  const printifyLines = cartItems.filter((i) => i.printifyProductId && i.variantId);
  if (printifyLines.length > 0) {
    try {
      const nameParts = shippingName.trim().split(' ');
      const firstName = nameParts[0] || 'Customer';
      const lastName = nameParts.slice(1).join(' ') || '.';

      const printifyOrder = await printify.createOrder({
        external_id: order.id,
        line_items: printifyLines.map((i) => ({
          product_id: i.printifyProductId,
          variant_id: parseInt(i.variantId, 10),
          quantity: i.qty,
        })),
        shipping_method: 1,
        send_shipping_notification: true,
        address_to: {
          first_name: firstName,
          last_name: lastName,
          email,
          phone: session.customer_details?.phone || '',
          country: shipping.country || 'US',
          region: shipping.state || '',
          address1: shipping.line1 || '',
          address2: shipping.line2 || '',
          city: shipping.city || '',
          zip: shipping.postal_code || '',
        },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { printifyOrderId: String(printifyOrder.id) },
      });

      // Automatically send to production
      await printify.sendOrderToProduction(printifyOrder.id);
    } catch (err) {
      console.error('[webhook] Printify order creation failed:', err.message);
      // Order is still in DB — admin can manually send to production
    }
  }
}

// ─── Printify webhook ─────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/printify
 */
async function printifyWebhook(req, res) {
  const topic = req.body?.type;

  try {
    if (topic === 'order:shipment:created') {
      await handlePrintifyShipment(req.body);
    }
  } catch (err) {
    console.error(`[webhook] printify ${topic} error`, err.message);
  }

  return res.sendStatus(200);
}

async function handlePrintifyShipment(payload) {
  const printifyOrderId = payload.resource?.id;
  if (!printifyOrderId) return;

  const order = await prisma.order.findFirst({
    where: { printifyOrderId: String(printifyOrderId) },
  });
  if (!order) return;

  const shipment = payload.resource?.data;
  const updates = { status: 'SHIPPED' };
  if (shipment?.tracking_number) updates.trackingNumber = shipment.tracking_number;
  if (shipment?.url) updates.trackingUrl = shipment.url;

  const updated = await prisma.order.update({ where: { id: order.id }, data: updates });

  if (order.email) {
    emailSvc.sendShippingUpdate(order.email, { ...order, ...updates }).catch(() => {});
  }
}

module.exports = { stripeWebhook, printifyWebhook };


// src/controllers/webhooks.js
// Handles incoming webhooks from Stripe (payment events) and Printify (fulfillment)
const { PrismaClient } = require('@prisma/client');
const stripeSvc = require('../services/stripe');
const emailSvc  = require('../services/email');
const { ensureOrderFromSession } = require('../services/orderService');

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
      await ensureOrderFromSession(event.data.object);
    }
  } catch (err) {
    console.error(`[webhook] stripe ${event.type} error`, err.message);
    // Return 500 so Stripe retries
    return res.status(500).json({ error: 'Webhook handler failed.' });
  }

  return res.sendStatus(200);
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


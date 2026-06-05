// src/controllers/orders.js — order management
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/orders/:id  (requires auth; user can only see own orders)
async function getOrder(req, res) {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { items: true },
  });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  return res.json({ order });
}

/**
 * POST /api/orders/lookup
 * No auth required. Body: { email, orderId }
 * Returns order details only when both email AND orderId match, preventing
 * enumeration — a wrong email on a real orderId returns 404.
 */
async function lookupOrder(req, res) {
  const { email, orderId } = req.body || {};

  if (!email || typeof email !== 'string' || !orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Email and order reference are required.' });
  }

  const safeEmail   = email.trim().toLowerCase().slice(0, 200);
  const safeOrderId = orderId.trim().slice(0, 50);

  // Validate basic email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const order = await prisma.order.findFirst({
    where: { id: safeOrderId, email: { equals: safeEmail, mode: 'insensitive' } },
    include: { items: true },
  });

  if (!order) {
    return res.status(404).json({ error: 'No order found with that email and reference.' });
  }

  // Return a safe subset — no userId, no internal IDs
  return res.json({
    order: {
      id: order.id,
      status: order.status,
      total: order.total,
      createdAt: order.createdAt,
      shippingName: order.shippingName,
      shippingCity: order.shippingCity,
      shippingState: order.shippingState,
      shippingZip: order.shippingZip,
      shippingCountry: order.shippingCountry,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      items: order.items.map((i) => ({
        name: i.name,
        price: i.price,
        qty: i.qty,
        placement: i.placement,
        image: i.image,
      })),
    },
  });
}

module.exports = { getOrder, lookupOrder };

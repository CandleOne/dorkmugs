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

module.exports = { getOrder };

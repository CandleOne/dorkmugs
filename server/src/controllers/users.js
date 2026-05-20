// src/controllers/users.js
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function safeUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt };
}

// GET /api/users/me
async function getProfile(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ user: safeUser(user) });
}

// PUT /api/users/me
async function updateProfile(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const updates = {};
  if (name) updates.name = name.trim();

  if (newPassword) {
    if (!currentPassword) {
      return res.status(422).json({ error: 'Current password required to set a new password.' });
    }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });
    updates.password = await bcrypt.hash(newPassword, 12);
  }

  const updated = await prisma.user.update({ where: { id: req.user.id }, data: updates });
  return res.json({ user: safeUser(updated) });
}

// GET /api/users/me/orders
async function getMyOrders(req, res) {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ orders });
}

// GET /api/users/me/orders/:id
async function getMyOrder(req, res) {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { items: true },
  });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  return res.json({ order });
}

// GET /api/users/me/addresses
async function getAddresses(req, res) {
  const addresses = await prisma.address.findMany({ where: { userId: req.user.id } });
  return res.json({ addresses });
}

// POST /api/users/me/addresses
async function addAddress(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, line1, line2, city, state, zip, country = 'US', isDefault = false } = req.body;

  if (isDefault) {
    await prisma.address.updateMany({
      where: { userId: req.user.id },
      data: { isDefault: false },
    });
  }

  const address = await prisma.address.create({
    data: { userId: req.user.id, name, line1, line2, city, state, zip, country, isDefault },
  });
  return res.status(201).json({ address });
}

// DELETE /api/users/me/addresses/:id
async function deleteAddress(req, res) {
  const existing = await prisma.address.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!existing) return res.status(404).json({ error: 'Address not found.' });
  await prisma.address.delete({ where: { id: req.params.id } });
  return res.json({ message: 'Address deleted.' });
}

module.exports = { getProfile, updateProfile, getMyOrders, getMyOrder, getAddresses, addAddress, deleteAddress };

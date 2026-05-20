// src/controllers/auth.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const config = require('../config');
const email = require('../services/email');

const prisma = new PrismaClient();

// ─── Cookie helpers ───────────────────────────────────────────────────────────

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: config.env === 'production',
  path: '/',
};

function setTokenCookies(res, accessToken, refreshToken) {
  res.cookie('access_token', accessToken, {
    ...COOKIE_OPTS,
    maxAge: 15 * 60 * 1000, // 15 min
  });
  res.cookie('refresh_token', refreshToken, {
    ...COOKIE_OPTS,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth', // restrict refresh token cookie scope
  });
}

function clearTokenCookies(res) {
  res.clearCookie('access_token', { ...COOKIE_OPTS });
  res.clearCookie('refresh_token', { ...COOKIE_OPTS, path: '/api/auth' });
}

function issueTokens(user) {
  const payload = { sub: user.id, email: user.email, role: user.role };
  const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpires,
  });
  const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpires,
  });
  return { accessToken, refreshToken };
}

function safeUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

// ─── Register ────────────────────────────────────────────────────────────────

async function register(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { name, email: emailInput, password } = req.body;

  const existing = await prisma.user.findUnique({ where: { email: emailInput } });
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name: name.trim(), email: emailInput.toLowerCase().trim(), password: hash },
  });

  const { accessToken, refreshToken } = issueTokens(user);

  // Store hashed refresh token
  const hashedRefresh = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { token: hashedRefresh, userId: user.id, expiresAt } });

  setTokenCookies(res, accessToken, refreshToken);

  // Fire-and-forget welcome email
  email.sendWelcome(user.email, user.name).catch(() => {});

  return res.status(201).json({ user: safeUser(user) });
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email: emailInput, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email: emailInput.toLowerCase().trim() },
  });
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const { accessToken, refreshToken } = issueTokens(user);

  const hashedRefresh = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { token: hashedRefresh, userId: user.id, expiresAt } });

  setTokenCookies(res, accessToken, refreshToken);

  return res.json({ user: safeUser(user) });
}

// ─── Logout ───────────────────────────────────────────────────────────────────

async function logout(req, res) {
  const incomingRefresh = req.cookies && req.cookies.refresh_token;

  // Best-effort: delete stored refresh tokens for this user
  if (req.user) {
    // Delete all refresh tokens for the user (full logout)
    await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
  }

  clearTokenCookies(res);
  return res.json({ message: 'Logged out.' });
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function refresh(req, res) {
  const incomingRefresh = req.cookies && req.cookies.refresh_token;
  if (!incomingRefresh) return res.status(401).json({ error: 'No refresh token.' });

  let payload;
  try {
    payload = jwt.verify(incomingRefresh, config.jwt.refreshSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token.' });
  }

  // Find a stored token that matches (bcrypt compare)
  const stored = await prisma.refreshToken.findMany({
    where: { userId: payload.sub, expiresAt: { gt: new Date() } },
  });

  let matched = null;
  for (const t of stored) {
    if (await bcrypt.compare(incomingRefresh, t.token)) { matched = t; break; }
  }
  if (!matched) return res.status(401).json({ error: 'Refresh token not recognised.' });

  // Rotate: delete old, issue new
  await prisma.refreshToken.delete({ where: { id: matched.id } });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return res.status(401).json({ error: 'User not found.' });

  const { accessToken, refreshToken: newRefresh } = issueTokens(user);
  const hashedRefresh = await bcrypt.hash(newRefresh, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { token: hashedRefresh, userId: user.id, expiresAt } });

  setTokenCookies(res, accessToken, newRefresh);
  return res.json({ user: safeUser(user) });
}

// ─── Me ───────────────────────────────────────────────────────────────────────

async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ user: safeUser(user) });
}

// ─── Forgot password ──────────────────────────────────────────────────────────

async function forgotPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  // Always return success to prevent user enumeration
  const { email: emailInput } = req.body;
  const user = await prisma.user.findUnique({
    where: { email: emailInput.toLowerCase().trim() },
  });

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashed = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordReset.deleteMany({ where: { userId: user.id } });
    await prisma.passwordReset.create({
      data: { token: hashed, userId: user.id, expiresAt },
    });

    const resetUrl = `${process.env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:5500'}/reset-password.html?token=${rawToken}`;
    email.sendPasswordReset(user.email, resetUrl).catch(() => {});
  }

  return res.json({ message: 'If that email exists, a reset link has been sent.' });
}

// ─── Reset password ───────────────────────────────────────────────────────────

async function resetPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { token, password } = req.body;

  const resets = await prisma.passwordReset.findMany({
    where: { used: false, expiresAt: { gt: new Date() } },
  });

  let matched = null;
  for (const r of resets) {
    if (await bcrypt.compare(token, r.token)) { matched = r; break; }
  }
  if (!matched) return res.status(400).json({ error: 'Invalid or expired reset token.' });

  const hash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: matched.userId }, data: { password: hash } });
  await prisma.passwordReset.update({ where: { id: matched.id }, data: { used: true } });
  // Invalidate all sessions
  await prisma.refreshToken.deleteMany({ where: { userId: matched.userId } });

  return res.json({ message: 'Password updated. Please log in.' });
}

module.exports = { register, login, logout, refresh, me, forgotPassword, resetPassword };

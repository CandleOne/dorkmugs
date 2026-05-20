// src/config/index.js — central config loaded from environment
require('dotenv').config();

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === '') return 1;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return 1;
  if (normalized === 'false') return false;
  const asNumber = Number(normalized);
  if (!Number.isNaN(asNumber)) return asNumber;
  return value;
}

const port = parseInt(process.env.PORT, 10) || 5000;
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const localOrigins = [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
];

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },

  printify: {
    apiKey: process.env.PRINTIFY_API_KEY || '',
    shopId: process.env.PRINTIFY_SHOP_ID || '',
    baseUrl: process.env.PRINTIFY_BASE_URL || 'https://api.printify.com/v1',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    successUrl: process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/order-success.html',
    cancelUrl: process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/index.html',
  },

  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'Dork Mugs <noreply@dorkmugs.com>',
  },

  allowedOrigins: Array.from(new Set([...configuredOrigins, ...localOrigins])),
};

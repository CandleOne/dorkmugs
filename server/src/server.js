// src/server.js — HTTP server entry point
require('dotenv').config();
const app = require('./app');
const config = require('./config');

// ─── Pre-flight environment check ────────────────────────────────────────────
const REQUIRED_IN_PROD = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SUCCESS_URL',
  'STRIPE_CANCEL_URL',
  'SITE_URL',
  'SMTP_HOST',
  'PRINTIFY_API_KEY',
  'PRINTIFY_SHOP_ID',
];
if (config.env === 'production') {
  const missing = REQUIRED_IN_PROD.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error('[server] FATAL: Missing required production env variables:');
    missing.forEach((k) => console.error(`  - ${k}`));
    process.exit(1);
  }
} else {
  const missing = REQUIRED_IN_PROD.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn('[server] WARNING: Missing env variables (OK in dev, required in prod):');
    missing.forEach((k) => console.warn(`  - ${k}`));
  }
}

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`[server] Dork Mugs API running on http://localhost:${PORT}`);
  console.log(`[server] Environment: ${config.env}`);
  console.log(`[server] Site URL: ${config.siteUrl}`);
});

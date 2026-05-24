// src/app.js — Express application factory
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();

// Codespaces and many hosts run behind a reverse proxy.
app.set('trust proxy', config.trustProxy);

// ─── www → non-www canonical redirect ────────────────────────────────────────
app.use((req, res, next) => {
  if (req.hostname && req.hostname.startsWith('www.')) {
    const canonical = `${req.protocol}://${req.hostname.slice(4)}${req.originalUrl}`;
    return res.redirect(301, canonical);
  }
  next();
});

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    // Existing pages include inline scripts/styles and CDN assets.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow no-origin requests (same-origin, Postman in dev)
      if (!origin) return cb(null, true);
      if (config.env !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return cb(null, true);
      }
      if (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Stripe-Signature'],
  })
);

// ─── Raw body for Stripe webhook signature verification ───────────────────────
app.use('/api/webhooks/stripe', (req, _res, next) => {
  let data = [];
  req.on('data', (chunk) => data.push(chunk));
  req.on('end', () => {
    req.rawBody = Buffer.concat(data);
    // Parse JSON after capturing raw bytes
    try { req.body = JSON.parse(req.rawBody.toString()); } catch { req.body = {}; }
    next();
  });
});

// ─── Body parsing (all other routes) ─────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ─── Cookies ─────────────────────────────────────────────────────────────────
app.use(cookieParser());

// ─── Logging ─────────────────────────────────────────────────────────────────
if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
app.use('/api', apiLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/shop-products', require('./routes/shopProducts'));
app.use('/api/collections',   require('./routes/collections'));
app.use('/api/checkout',      require('./routes/checkout'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/webhooks',      require('./routes/webhooks'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ─── SEO: server-rendered product pages ───────────────────────────────────────
app.use('/mugs', require('./routes/seo'));

// ─── Sitemap ──────────────────────────────────────────────────────────────────
app.get('/sitemap.xml', async (_req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const _prisma = new PrismaClient();
    const products = await _prisma.shopProduct.findMany({
      where:   { published: true },
      select:  { id: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    await _prisma.$disconnect();

    const siteUrl = (process.env.SITE_URL || 'https://dorkmugs.shop').replace(/\/+$/, '');
    const staticPages = ['/', '/product.html', '/gallery.html', '/search.html'];
    const productPages = products.map(p => `/mugs/${p.id}`);
    const allUrls = [...staticPages, ...productPages];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...allUrls.map(u => `  <url><loc>${siteUrl}${u}</loc><changefreq>weekly</changefreq></url>`),
      '</urlset>',
    ].join('\n');

    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('[sitemap] error', err.message);
    res.status(500).send('');
  }
});

// ─── Static frontend (repo root) ─────────────────────────────────────────────
const frontendRoot = path.resolve(__dirname, '../../');
app.use(express.static(frontendRoot));

app.get('/', (_req, res) => {
  res.sendFile(path.join(frontendRoot, 'index.html'));
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.status(404).sendFile(path.join(frontendRoot, '404.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;

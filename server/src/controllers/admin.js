// src/controllers/admin.js — admin-only operations
const path = require('path');
const fs   = require('fs').promises;
const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');
const printify = require('../services/printify');
const emailSvc = require('../services/email');
const config   = require('../config');

const stripe = Stripe(config.stripe.secretKey);

const prisma = new PrismaClient();

// src/controllers/admin.js  — add this export

exports.getTrafficAnalytics = async (req, res) => {
  try {
    const now = new Date();

    // Default: last 30 days. Frontend can pass ?days=7 etc.
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date(now - days * 24 * 60 * 60 * 1000);

    // Last 7 days for the daily chart (always fixed)
    const chartDays = 7;
    const chartSince = new Date(now - chartDays * 24 * 60 * 60 * 1000);

    const [allViews, chartViews] = await Promise.all([
      prisma.pageView.findMany({
        where: { createdAt: { gte: since } },
        select: { sessionId: true, ip: true, path: true, createdAt: true },
      }),
      prisma.pageView.findMany({
        where: { createdAt: { gte: chartSince } },
        select: { sessionId: true, path: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // ── Totals ──────────────────────────────────────────────────────────────
    const totalVisitors  = allViews.length;
    const uniqueSessions = new Set(allViews.map(v => v.sessionId));
    const uniqueVisitors = uniqueSessions.size;
    const pageViews      = totalVisitors; // every tracked hit = a page view

    // ── Bounce rate: sessions that only hit one page ─────────────────────────
    const sessionHits = {};
    for (const v of allViews) {
      sessionHits[v.sessionId] = (sessionHits[v.sessionId] || 0) + 1;
    }
    const bounced    = Object.values(sessionHits).filter(n => n === 1).length;
    const bounceRate = uniqueVisitors > 0
      ? Math.round((bounced / uniqueVisitors) * 100)
      : 0;

    // ── Top pages ─────────────────────────────────────────────────────────────
    const pathCounts = {};
    for (const v of allViews) {
      pathCounts[v.path] = (pathCounts[v.path] || 0) + 1;
    }
    const topPages = Object.entries(pathCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, views]) => ({ path, views }));

    // ── Daily chart data (last 7 days) ────────────────────────────────────────
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyMap  = {};

    for (let i = chartDays - 1; i >= 0; i--) {
      const d   = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10); // "2026-06-01"
      dailyMap[key] = { label: DAY_NAMES[d.getDay()], views: 0, sessions: new Set() };
    }

    for (const v of chartViews) {
      const key = v.createdAt.toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].views++;
        dailyMap[key].sessions.add(v.sessionId);
      }
    }

    const daily = Object.values(dailyMap).map(d => ({
      label:   d.label,
      views:   d.views,
      uniques: d.sessions.size,
    }));

    // ── New vs returning (session seen before the window = returning) ─────────
    // A session is "returning" if it has views on more than one calendar day
    const sessionDays = {};
    for (const v of allViews) {
      const day = v.createdAt.toISOString().slice(0, 10);
      if (!sessionDays[v.sessionId]) sessionDays[v.sessionId] = new Set();
      sessionDays[v.sessionId].add(day);
    }
    const returning    = Object.values(sessionDays).filter(s => s.size > 1).length;
    const newVisitors  = uniqueVisitors - returning;
    const newVisitorPct = uniqueVisitors > 0
      ? Math.round((newVisitors / uniqueVisitors) * 100)
      : 0;

    res.json({
      totalVisitors,
      uniqueVisitors,
      pageViews,
      bounceRate,
      topPages,
      daily,
      newVisitorPct,
      windowDays: days,
    });
  } catch (err) {
    console.error('[analytics] error', err.message);
    res.status(500).json({ error: 'Failed to load analytics.' });
  }
};



// ─── Dashboard ────────────────────────────────────────────────────────────────

// GET /api/admin/stats
async function getStats(req, res) {
  const [totalUsers, totalOrders, recentOrders, revenue] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count(),
    prisma.order.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: { status: { notIn: ['CANCELLED', 'REFUNDED'] } },
    }),
  ]);

  const pendingOrders = await prisma.order.count({ where: { status: 'PENDING' } });

  return res.json({
    totalUsers,
    totalOrders,
    pendingOrders,
    totalRevenue: revenue._sum.total || 0,
    recentOrders,
  });
}

// ─── Users ────────────────────────────────────────────────────────────────────

// GET /api/admin/users
async function listUsers(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.user.count(),
  ]);

  return res.json({ users, total, page, pages: Math.ceil(total / limit) });
}

// PATCH /api/admin/users/:id/role
async function updateUserRole(req, res) {
  const { role } = req.body;
  if (!['CUSTOMER', 'ADMIN'].includes(role)) {
    return res.status(422).json({ error: 'Invalid role.' });
  }
  // Prevent self-demotion
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role },
    select: { id: true, email: true, name: true, role: true },
  });
  return res.json({ user });
}

// DELETE /api/admin/users/:id
async function deleteUser(req, res) {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  await prisma.user.delete({ where: { id: req.params.id } });
  return res.json({ message: 'User deleted.' });
}

// ─── Orders ───────────────────────────────────────────────────────────────────

// GET /api/admin/orders
async function listOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const skip = (page - 1) * limit;
  const status = req.query.status || undefined;

  const where = status ? { status } : {};

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { items: true, user: { select: { email: true, name: true } } },
    }),
    prisma.order.count({ where }),
  ]);

  return res.json({ orders, total, page, pages: Math.ceil(total / limit) });
}

// GET /api/admin/orders/:id
async function getOrder(req, res) {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true, user: { select: { email: true, name: true } } },
  });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  return res.json({ order });
}

// PATCH /api/admin/orders/:id/status
async function updateOrderStatus(req, res) {
  const { status, trackingNumber, trackingUrl } = req.body;
  const validStatuses = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
  if (!validStatuses.includes(status)) {
    return res.status(422).json({ error: 'Invalid status.' });
  }

  const updates = { status };
  if (trackingNumber) updates.trackingNumber = trackingNumber;
  if (trackingUrl) updates.trackingUrl = trackingUrl;

  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: updates,
    include: { items: true },
  });

  // Send shipping email when marked as shipped
  if (status === 'SHIPPED' && order.email) {
    emailSvc.sendShippingUpdate(order.email, order).catch(() => {});
  }

  return res.json({ order });
}

// ─── Products (Printify sync) ─────────────────────────────────────────────────

// GET /api/admin/printify/products
async function listPrintifyProducts(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const data = await printify.listProducts(page);
    return res.json(data);
  } catch (err) {
    console.error('[admin] listPrintifyProducts error', err.message);
    return res.status(502).json({ error: 'Could not fetch Printify products.' });
  }
}

// POST /api/admin/printify/orders/:printifyOrderId/send
async function sendPrintifyOrderToProduction(req, res) {
  try {
    const result = await printify.sendOrderToProduction(req.params.printifyOrderId);
    return res.json(result);
  } catch (err) {
    console.error('[admin] sendOrderToProduction error', err.message);
    return res.status(502).json({ error: 'Could not send order to production.' });
  }
}

// ─── Shop Products (catalog management) ──────────────────────────────────────

function validateShopProduct(body, requireId = false) {
  const errors = [];
  if (requireId) {
    if (!body.id || !/^[a-z0-9_-]+$/i.test(body.id)) errors.push('id must be a non-empty alphanumeric slug.');
  }
  if (!body.pname || !String(body.pname).trim()) errors.push('pname is required.');
  if (body.price === undefined || isNaN(parseFloat(body.price)) || parseFloat(body.price) < 0) errors.push('price must be a non-negative number.');
  if (!body.collection || !/^[a-z0-9_-]+$/i.test(body.collection)) errors.push('collection must be a non-empty alphanumeric slug.');
  return errors;
}

// GET /api/shop-products  (public)
async function listShopProducts(req, res) {
  const [products, collections] = await Promise.all([
    prisma.shopProduct.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.collection.findMany(),
  ]);
  const collMap = {};
  collections.forEach(c => { collMap[c.slug] = c.name; });
  return res.json({ products: products.map(p => ({ ...p, collectionName: collMap[p.collection] || null })) });
}

// GET /api/admin/shop-products
async function adminListShopProducts(req, res) {
  const products = await prisma.shopProduct.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return res.json({ products });
}

// POST /api/admin/shop-products
async function createShopProduct(req, res) {
  const errors = validateShopProduct(req.body, true);
  if (errors.length) return res.status(422).json({ error: errors.join(' ') });

  const existing = await prisma.shopProduct.findUnique({ where: { id: req.body.id } });
  if (existing) return res.status(409).json({ error: `A product with id "${req.body.id}" already exists.` });

  const product = await prisma.shopProduct.create({
    data: {
      id:               String(req.body.id).trim(),
      pname:            String(req.body.pname).trim(),
      price:            parseFloat(req.body.price),
      rating:           parseFloat(req.body.rating) || 0,
      collection:       req.body.collection,
      description:      String(req.body.description || '').trim(),
      published:        req.body.published !== false,
      sortOrder:        parseInt(req.body.sortOrder, 10) || 0,
      imageLeft:        String(req.body.imageLeft || '').trim(),
      printifyIdLeft:   String(req.body.printifyIdLeft || '').trim(),
      variantIdLeft:    String(req.body.variantIdLeft || '').trim(),
      imageCenter:      String(req.body.imageCenter || '').trim(),
      printifyIdCenter: String(req.body.printifyIdCenter || '').trim(),
      variantIdCenter:  String(req.body.variantIdCenter || '').trim(),
      imageRight:       String(req.body.imageRight || '').trim(),
      printifyIdRight:  String(req.body.printifyIdRight || '').trim(),
      variantIdRight:   String(req.body.variantIdRight || '').trim(),
    },
  });
  return res.status(201).json({ product });
}

// PATCH /api/admin/shop-products/:id
async function updateShopProduct(req, res) {
  const errors = validateShopProduct(req.body, false);
  if (errors.length) return res.status(422).json({ error: errors.join(' ') });

  const product = await prisma.shopProduct.update({
    where: { id: req.params.id },
    data: {
      pname:            String(req.body.pname).trim(),
      price:            parseFloat(req.body.price),
      rating:           parseFloat(req.body.rating) || 0,
      collection:       req.body.collection,
      description:      String(req.body.description || '').trim(),
      published:        req.body.published !== false,
      sortOrder:        parseInt(req.body.sortOrder, 10) || 0,
      featured:         Boolean(req.body.featured),
      featuredOrder:    parseInt(req.body.featuredOrder, 10) || 0,
      imageLeft:        String(req.body.imageLeft || '').trim(),
      printifyIdLeft:   String(req.body.printifyIdLeft || '').trim(),
      variantIdLeft:    String(req.body.variantIdLeft || '').trim(),
      imageCenter:      String(req.body.imageCenter || '').trim(),
      printifyIdCenter: String(req.body.printifyIdCenter || '').trim(),
      variantIdCenter:  String(req.body.variantIdCenter || '').trim(),
      imageRight:       String(req.body.imageRight || '').trim(),
      printifyIdRight:  String(req.body.printifyIdRight || '').trim(),
      variantIdRight:   String(req.body.variantIdRight || '').trim(),
    },
  });
  return res.json({ product });
}

// PATCH /api/admin/shop-products/:id/featured  (quick featured toggle)
async function toggleFeaturedProduct(req, res) {
  const data = {};
  if (req.body.featured !== undefined)      data.featured      = Boolean(req.body.featured);
  if (req.body.featuredOrder !== undefined) data.featuredOrder = parseInt(req.body.featuredOrder, 10) || 0;
  if (!Object.keys(data).length) return res.status(422).json({ error: 'No fields to update.' });
  const product = await prisma.shopProduct.update({ where: { id: req.params.id }, data });
  return res.json({ product });
}

// DELETE /api/admin/shop-products/:id
async function deleteShopProduct(req, res) {
  await prisma.shopProduct.delete({ where: { id: req.params.id } });
  return res.json({ ok: true });
}

// GET /api/shop-products/featured  (public — homepage featured list)
async function getFeaturedProducts(req, res) {
  const [products, collections] = await Promise.all([
    prisma.shopProduct.findMany({
      where: { published: true, featured: true },
      orderBy: [{ featuredOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.collection.findMany(),
  ]);
  const collMap = {};
  collections.forEach(c => { collMap[c.slug] = c.name; });
  return res.json({ products: products.map(p => ({ ...p, collectionName: collMap[p.collection] || null })) });
}

// ─── Collections ──────────────────────────────────────────────────────────────

// GET /api/collections  (public — used by storefront pages)
async function getPublicCollections(req, res) {
  const cols = await prisma.collection.findMany({ orderBy: { slug: 'asc' } });
  return res.json(cols);
}

// GET /api/admin/collections
async function adminListCollections(req, res) {
  const [cols, counts] = await Promise.all([
    prisma.collection.findMany({ orderBy: { slug: 'asc' } }),
    prisma.shopProduct.groupBy({ by: ['collection'], _count: { id: true } }),
  ]);
  const countMap = {};
  counts.forEach(c => { countMap[c.collection] = c._count.id; });
  const knownSlugs = new Set(cols.map(c => c.slug));
  const result = cols.map(c => ({ ...c, productCount: countMap[c.slug] || 0 }));
  // Include slugs used by products but not yet in the Collection table
  counts.forEach(c => {
    if (!knownSlugs.has(c.collection)) {
      const slug = c.collection;
      result.push({
        slug,
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        productCount: c._count.id,
      });
    }
  });
  result.sort((a, b) => a.slug.localeCompare(b.slug));
  return res.json(result);
}

// POST /api/admin/collections
async function createAdminCollection(req, res) {
  const { slug, name } = req.body || {};
  if (!slug || !name) return res.status(400).json({ error: 'slug and name are required' });
  const s = String(slug).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
  const existing = await prisma.collection.findUnique({ where: { slug: s } });
  if (existing) return res.status(409).json({ error: `Collection "${s}" already exists.` });
  const col = await prisma.collection.create({ data: { slug: s, name: String(name).trim() } });
  return res.json(col);
}

// PATCH /api/admin/collections/:slug
async function updateAdminCollection(req, res) {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const slug = req.params.slug;
  const col = await prisma.collection.upsert({
    where: { slug },
    update: { name: String(name).trim() },
    create: { slug, name: String(name).trim() },
  });
  return res.json(col);
}

// DELETE /api/admin/collections/:slug
async function deleteAdminCollection(req, res) {
  await prisma.collection.delete({ where: { slug: req.params.slug } });
  return res.json({ ok: true });
}

// ─── Printify Catalog / Mug Creator ──────────────────────────────────────────

// GET /api/admin/printify/blueprints
async function printifyCatalogBlueprints(req, res) {
  try {
    const blueprints = await printify.getBlueprints();
    return res.json(blueprints);
  } catch (err) {
    return res.status(502).json({ error: 'Could not fetch Printify blueprints.' });
  }
}

// GET /api/admin/printify/blueprints/:bid/providers
async function printifyCatalogProviders(req, res) {
  try {
    const providers = await printify.getBlueprintProviders(req.params.bid);
    return res.json(providers);
  } catch (err) {
    return res.status(502).json({ error: 'Could not fetch providers.' });
  }
}

// GET /api/admin/printify/blueprints/:bid/providers/:pid/variants
async function printifyCatalogVariants(req, res) {
  try {
    const data = await printify.getBlueprintVariants(req.params.bid, req.params.pid);
    // Normalise: return { variants, print_details } regardless of API shape
    const variants = data.variants || (Array.isArray(data) ? data : []);
    const printDetails = data.print_details || [];
    return res.json({ variants, print_details: printDetails });
  } catch (err) {
    return res.status(502).json({ error: 'Could not fetch variants.' });
  }
}

/**
 * POST /api/admin/printify/create-mug
 * Body: { title, blueprintId, providerId, variants: [{id, role}], designUrl, position, price }
 *   - variants: array of { id: variantId, role: 'left'|'center'|'right' }
 *   - position: Printify print area position string, default 'front'
 *   - price: cents (integer)
 * Creates ONE Printify product with the given variants and returns the product ID + variant map.
 */
async function printifyCreateMug(req, res) {
  const { title, blueprintId, providerId, variants, designUrl, position, price } = req.body || {};
  if (!blueprintId || !providerId || !variants || !variants.length || !designUrl) {
    return res.status(400).json({ error: 'blueprintId, providerId, variants, and designUrl are required.' });
  }

  // 1. Upload design image to Printify
  let uploadedImage;
  try {
    const fileName = (designUrl.split('/').pop() || 'design.png').replace(/\?.*$/, '');
    uploadedImage = await printify.uploadImage(designUrl, fileName);
  } catch (err) {
    return res.status(502).json({ error: 'Could not upload design image to Printify: ' + err.message });
  }

  const variantIds = variants.map(v => Number(v.id));
  const printPosition = position || 'front';
  const priceInCents = price ? Number(price) : 2000;

  // 2. Create Printify product
  let product;
  try {
    product = await printify.createProduct({
      title: String(title || 'Mug').trim(),
      blueprint_id: Number(blueprintId),
      print_provider_id: Number(providerId),
      variants: variantIds.map(id => ({ id, price: priceInCents, is_enabled: true })),
      print_areas: [{
        variant_ids: variantIds,
        placeholders: [{
          position: printPosition,
          images: [{
            id: uploadedImage.id,
            x: 0.5, y: 0.5, scale: 1, angle: 0,
          }],
        }],
      }],
    });
  } catch (err) {
    const detail = err.response && err.response.data
      ? JSON.stringify(err.response.data)
      : err.message;
    return res.status(502).json({ error: 'Could not create Printify product: ' + detail });
  }

  // 3. Build role → variantId map so the frontend can fill the form
  const roleMap = {};
  variants.forEach(v => { roleMap[v.role] = String(v.id); });

  return res.json({
    printifyId: product.id,
    variantIdLeft:   roleMap.left   || '',
    variantIdCenter: roleMap.center || '',
    variantIdRight:  roleMap.right  || '',
  });
}



// GET /api/admin/image-assets  — lists image files in Assets/productpreviews
async function listImageAssets(req, res) {
  const dir = path.resolve(__dirname, '../../../Assets/productpreviews');
  try {
    const files = await fs.readdir(dir);
    const images = files
      .filter(f => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f))
      .sort()
      .map(f => './Assets/productpreviews/' + f);
    return res.json({ images });
  } catch {
    return res.json({ images: [] });
  }
}

// GET /api/admin/email/inbox-url
function getEmailInboxUrl(req, res) {
  // Allow explicit override via env var
  if (process.env.WEBMAIL_URL) {
    return res.json({ url: process.env.WEBMAIL_URL, label: 'Webmail' });
  }
  const host = (config.email.host || '').toLowerCase();
  let url, label;
  if (host.includes('zoho'))                                      { url = 'https://mail.zoho.com';         label = 'Zoho Mail'; }
  else if (host.includes('google') || host.includes('gmail'))     { url = 'https://mail.google.com';       label = 'Gmail'; }
  else if (host.includes('outlook') || host.includes('office365') || host.includes('hotmail')) {
                                                                    url = 'https://outlook.live.com';      label = 'Outlook'; }
  else if (host.includes('privateemail') || host.includes('namecheap')) { url = 'https://privateemail.com'; label = 'Private Email'; }
  else if (host.includes('mailgun'))                              { url = 'https://app.mailgun.com';       label = 'Mailgun'; }
  else if (host.includes('sendgrid'))                             { url = 'https://app.sendgrid.com';      label = 'SendGrid'; }
  else if (host.includes('fastmail'))                             { url = 'https://www.fastmail.com';      label = 'Fastmail'; }
  else if (host.includes('protonmail') || host.includes('proton.me')) { url = 'https://mail.proton.me'; label = 'Proton Mail'; }
  else {
    // Fallback: webmail subdomain convention
    const domain = config.email.user ? config.email.user.split('@')[1] : null;
    url  = domain ? `https://webmail.${domain}` : null;
    label = 'Webmail';
  }
  res.json({ url, label });
}

module.exports = {
  getStats,
  listUsers,
  updateUserRole,
  deleteUser,
  listOrders,
  getOrder,
  updateOrderStatus,
  listPrintifyProducts,
  sendPrintifyOrderToProduction,
  listShopProducts,
  adminListShopProducts,
  createShopProduct,
  updateShopProduct,
  deleteShopProduct,
  toggleFeaturedProduct,
  getFeaturedProducts,
  getPublicCollections,
  adminListCollections,
  createAdminCollection,
  updateAdminCollection,
  deleteAdminCollection,
  printifyCatalogBlueprints,
  printifyCatalogProviders,
  printifyCatalogVariants,
  printifyCreateMug,
  listImageAssets,
  listCoupons,
  createCoupon,
  deactivateCoupon,
  deleteCoupon,
  backfillOrderShipping,
  sendAdminEmail,
  getEmailInboxUrl,
};

// ─── Coupons ──────────────────────────────────────────────────────────────────

// GET /api/admin/coupons
// Returns all promotion codes (and their underlying coupons) from Stripe.
async function listCoupons(req, res) {
  try {
    const promoCodes = await stripe.promotionCodes.list({ limit: 100, expand: ['data.coupon'] });
    const items = promoCodes.data.map((pc) => ({
      id: pc.id,
      code: pc.code,
      active: pc.active,
      timesRedeemed: pc.times_redeemed,
      maxRedemptions: pc.max_redemptions,
      expiresAt: pc.expires_at,
      coupon: {
        id: pc.coupon.id,
        percentOff: pc.coupon.percent_off,
        amountOff: pc.coupon.amount_off,   // cents
        currency: pc.coupon.currency,
        duration: pc.coupon.duration,
        durationInMonths: pc.coupon.duration_in_months,
        timesRedeemed: pc.coupon.times_redeemed,
        maxRedemptions: pc.coupon.max_redemptions,
      },
    }));
    return res.json({ coupons: items });
  } catch (err) {
    console.error('[admin/coupons] list error', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/admin/coupons
// Body: { code, discountType: 'percent'|'amount', discountValue, duration: 'once'|'forever'|'repeating', durationMonths?, maxRedemptions?, expiresAt? }
// OR:   { code, zeroCharge: true }  — creates a 100%-off once coupon with zero_charge metadata
async function createCoupon(req, res) {
  const { code, discountType, discountValue, duration, durationMonths, maxRedemptions, expiresAt, zeroCharge } = req.body || {};

  if (!code || typeof code !== 'string' || !/^[A-Z0-9_-]{1,50}$/i.test(code.trim())) {
    return res.status(422).json({ error: 'Invalid code. Use letters, numbers, hyphens or underscores (max 50 chars).' });
  }

  try {
    let couponParams;

    if (zeroCharge) {
      // Zero-charge test coupon: 100% off, once, with metadata so checkout can detect it
      couponParams = {
        percent_off: 100,
        duration: 'once',
        metadata: { zero_charge: 'true' },
      };
    } else {
      if (!['percent', 'amount'].includes(discountType)) {
        return res.status(422).json({ error: 'discountType must be "percent" or "amount".' });
      }
      const value = parseFloat(discountValue);
      if (!value || value <= 0) {
        return res.status(422).json({ error: 'discountValue must be a positive number.' });
      }
      if (discountType === 'percent' && value > 100) {
        return res.status(422).json({ error: 'Percent discount cannot exceed 100.' });
      }
      if (!['once', 'forever', 'repeating'].includes(duration)) {
        return res.status(422).json({ error: 'duration must be once, forever, or repeating.' });
      }

      couponParams = { duration };
      if (discountType === 'percent') {
        couponParams.percent_off = value;
      } else {
        couponParams.amount_off = Math.round(value * 100);
        couponParams.currency = 'usd';
      }
      if (duration === 'repeating') {
        const months = parseInt(durationMonths, 10);
        if (!months || months < 1) return res.status(422).json({ error: 'durationMonths required for repeating coupons.' });
        couponParams.duration_in_months = months;
      }
      if (maxRedemptions) {
        const max = parseInt(maxRedemptions, 10);
        if (max > 0) couponParams.max_redemptions = max;
      }
    }

    const coupon = await stripe.coupons.create(couponParams);

    // Create the promotion code with the human-readable code string
    const promoParams = {
      coupon: coupon.id,
      code: code.trim().toUpperCase(),
    };
    if (!zeroCharge) {
      if (expiresAt) {
        const ts = Math.floor(new Date(expiresAt).getTime() / 1000);
        if (ts > Math.floor(Date.now() / 1000)) promoParams.expires_at = ts;
      }
      if (maxRedemptions) {
        const max = parseInt(maxRedemptions, 10);
        if (max > 0) promoParams.max_redemptions = max;
      }
    }

    const promoCode = await stripe.promotionCodes.create(promoParams);
    return res.status(201).json({ id: promoCode.id, code: promoCode.code });
  } catch (err) {
    console.error('[admin/coupons] create error', err.message);
    // Stripe returns a clear message for duplicate codes
    return res.status(400).json({ error: err.message });
  }
}

// DELETE /api/admin/coupons/:id
// Deactivates (not deletes) a promotion code so existing redeemed ones stay in records.
async function deactivateCoupon(req, res) {
  try {
    await stripe.promotionCodes.update(req.params.id, { active: false });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin/coupons] deactivate error', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// DELETE /api/admin/coupons/coupon/:couponId
// Permanently deletes the underlying Stripe coupon, invalidating all associated promotion codes.
async function deleteCoupon(req, res) {
  try {
    await stripe.coupons.del(req.params.couponId);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin/coupons] delete error', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// ─── Order shipping backfill ───────────────────────────────────────────────────

// POST /api/admin/orders/:id/backfill-shipping
// Re-fetches shipping/customer address from the Stripe session and patches the order.
async function backfillOrderShipping(req, res) {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (!order.stripeSessionId) return res.status(422).json({ error: 'No Stripe session linked to this order.' });

  try {
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    const addr = session.shipping_details?.address || session.customer_details?.address || {};
    const name = session.shipping_details?.name   || session.customer_details?.name   || order.shippingName;

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        shippingName:    name,
        shippingLine1:   addr.line1        || order.shippingLine1,
        shippingLine2:   addr.line2        || order.shippingLine2,
        shippingCity:    addr.city         || order.shippingCity,
        shippingState:   addr.state        || order.shippingState,
        shippingZip:     addr.postal_code  || order.shippingZip,
        shippingCountry: addr.country      || order.shippingCountry,
      },
      include: { items: true },
    });
    return res.json({ order: updated });
  } catch (err) {
    console.error('[admin] backfillOrderShipping error', err.message);
    return res.status(502).json({ error: err.message });
  }
}

// ─── Admin email sender ────────────────────────────────────────────────────────

// POST /api/admin/email/send
// Body: { to, subject, html?, templateType?, orderId? }
// Sends a one-off email to any address from the admin panel.
async function sendAdminEmail(req, res) {
  const { to, subject, html, templateType, orderId } = req.body || {};

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim())) {
    return res.status(422).json({ error: 'A valid recipient email address is required.' });
  }
  if (!subject || !String(subject).trim()) {
    return res.status(422).json({ error: 'Subject is required.' });
  }

  try {
    // Template-based sends
    if (templateType === 'order_confirmation' && orderId) {
      // Accept full CUID or the 8-char display reference shown in the admin UI
      const order = await prisma.order.findFirst({
        where: orderId.length <= 8
          ? { id: { endsWith: orderId.toLowerCase() } }
          : { id: orderId },
        include: { items: true },
      });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      await emailSvc.sendOrderConfirmation(to, order);
      return res.json({ ok: true, message: `Order confirmation sent to ${to}` });
    }

    if (templateType === 'shipping_update' && orderId) {
      const order = await prisma.order.findFirst({
        where: orderId.length <= 8
          ? { id: { endsWith: orderId.toLowerCase() } }
          : { id: orderId },
        include: { items: true },
      });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      await emailSvc.sendShippingUpdate(to, order);
      return res.json({ ok: true, message: `Shipping update sent to ${to}` });
    }

    // Custom / free-form send
    if (!html || !String(html).trim()) {
      return res.status(422).json({ error: 'Email body (html) is required for custom emails.' });
    }
    const body = String(html).slice(0, 50000); // hard cap
    await emailSvc.sendCustom({ to: String(to).trim(), subject: String(subject).trim(), html: body });
    return res.json({ ok: true, message: `Email sent to ${to}` });
  } catch (err) {
    console.error('[admin] sendAdminEmail error', err.message);
    return res.status(502).json({ error: err.message });
  }
}

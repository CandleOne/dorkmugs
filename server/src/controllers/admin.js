// src/controllers/admin.js — admin-only operations
const path = require('path');
const fs   = require('fs').promises;
const { PrismaClient } = require('@prisma/client');
const printify = require('../services/printify');
const emailSvc = require('../services/email');

const prisma = new PrismaClient();

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

// DELETE /api/admin/shop-products/:id
async function deleteShopProduct(req, res) {
  await prisma.shopProduct.delete({ where: { id: req.params.id } });
  return res.json({ ok: true });
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
};

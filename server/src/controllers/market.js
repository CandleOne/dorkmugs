// src/controllers/market.js — peer-to-peer marketplace
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const VALID_CONDITIONS = ['new', 'like-new', 'used', 'for-parts'];
const VALID_CATEGORIES = ['mugs', 'accessories', 'art', 'other'];
const MAX_TITLE_LEN    = 120;
const MAX_DESC_LEN     = 2000;
const MAX_IMG_LEN      = 500;
const MAX_MSG_LEN      = 1000;

// Item type → category mapping for auto-classification
const TYPE_CATEGORY = {
  MUG_VOUCHER:      'mugs',
  SHARD:            'mugs',
  WILDCARD_SHARD:   'accessories',
  DISCOUNT_VOUCHER: 'other',
  CRATE_KEY:        'other',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeUrl(raw) {
  if (!raw) return '';
  const s = raw.trim().slice(0, MAX_IMG_LEN);
  if (!/^https:\/\//i.test(s)) return '';
  return s;
}

// ─── GET /api/market/listable — user's inventory items available to list ──────

async function getListableInventory(req, res) {
  try {
    // 1. Fetch IDs already locked in an active listing
    const activeSrcItems = await prisma.marketListing.findMany({
      where: {
        sellerId: req.user.id,
        status: 'ACTIVE',
        sourceType: { not: 'MANUAL' },
      },
      select: { sourceInventoryItemId: true, sourceUserCrateId: true },
    });
    const listedInvIds   = new Set(activeSrcItems.map(l => l.sourceInventoryItemId).filter(Boolean));
    const listedCrateIds = new Set(activeSrcItems.map(l => l.sourceUserCrateId).filter(Boolean));

    // 2. Unopened crate keys
    const userCrates = await prisma.userCrate.findMany({
      where: { userId: req.user.id, opened: false },
      include: { crate: true },
      orderBy: { createdAt: 'desc' },
    });

    const crateItems = userCrates
      .filter(uc => !listedCrateIds.has(uc.id))
      .map(uc => ({
        id:          `crate:${uc.id}`,
        sourceType:  'CRATE_KEY',
        sourceId:    uc.id,
        itemType:    'CRATE_KEY',
        label:       `${uc.crate.name} (Unopened Crate Key)`,
        description: `Unopened ${uc.crate.name} key — whoever buys this can open it for a chance to win a mug.`,
        image:       uc.crate.image || '',
        suggestedPrice: parseFloat((uc.crate.price * 0.8).toFixed(2)),
        condition:   'new',
        category:    'other',
      }));

    // 3. InventoryItems (not redeemed, exclude DORK_COIN)
    const invItems = await prisma.inventoryItem.findMany({
      where: {
        userId:   req.user.id,
        redeemed: false,
        type:     { not: 'DORK_COIN' },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Enrich with product info
    const productIds = [...new Set(invItems.map(i => i.productId).filter(Boolean))];
    const products = productIds.length
      ? await prisma.shopProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, pname: true, imageLeft: true, price: true },
        })
      : [];
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    const inventoryItems = invItems
      .filter(i => !listedInvIds.has(i.id))
      .map(i => {
        const prod = i.productId ? productMap[i.productId] : null;
        let label, description, image, suggestedPrice, condition, category;

        switch (i.type) {
          case 'MUG_VOUCHER':
            label          = prod ? `${prod.pname} (Mug Voucher)` : 'Mug Voucher';
            description    = prod ? `Redeemable voucher for one "${prod.pname}" mug.` : 'Redeemable mug voucher.';
            image          = prod ? prod.imageLeft : '';
            suggestedPrice = prod ? parseFloat((prod.price * 0.75).toFixed(2)) : 10;
            condition      = 'new';
            category       = 'mugs';
            break;
          case 'SHARD':
            label          = prod ? `${prod.pname} Shard (x${i.quantity})` : `Shard (x${i.quantity})`;
            description    = `${i.quantity} shard${i.quantity !== 1 ? 's' : ''} for${prod ? ` "${prod.pname}"` : ' a mug design'}. 10 shards = 1 mug voucher.`;
            image          = prod ? prod.imageLeft : '';
            suggestedPrice = parseFloat((i.quantity * 0.50).toFixed(2));
            condition      = 'new';
            category       = 'mugs';
            break;
          case 'WILDCARD_SHARD':
            label          = `Wildcard Shard (x${i.quantity})`;
            description    = `${i.quantity} wildcard shard${i.quantity !== 1 ? 's' : ''} — works toward any mug design.`;
            image          = '';
            suggestedPrice = parseFloat((i.quantity * 0.75).toFixed(2));
            condition      = 'new';
            category       = 'accessories';
            break;
          case 'DISCOUNT_VOUCHER':
            label          = `${i.value}% Discount Voucher`;
            description    = `${i.value}% off any order at Dork Mugs.`;
            image          = '';
            suggestedPrice = parseFloat(((i.value || 5) * 0.10).toFixed(2));
            condition      = 'new';
            category       = 'other';
            break;
          default:
            label          = i.type;
            description    = '';
            image          = '';
            suggestedPrice = 1;
            condition      = 'used';
            category       = 'other';
        }

        return {
          id:             `inv:${i.id}`,
          sourceType:     'INVENTORY_ITEM',
          sourceId:       i.id,
          itemType:       i.type,
          label,
          description,
          image,
          suggestedPrice,
          condition,
          category,
          quantity:       i.quantity,
        };
      });

    res.json({ items: [...crateItems, ...inventoryItems] });
  } catch (err) {
    console.error('[market] getListableInventory error', err.message);
    res.status(500).json({ error: 'Could not fetch inventory.' });
  }
}

// ─── GET /api/market — list ACTIVE listings (public) ─────────────────────────

async function getListings(req, res) {
  try {
    const { category, sort, page } = req.query;
    const pageSize = 24;
    const skip = (Math.max(1, parseInt(page) || 1) - 1) * pageSize;

    const where = { status: 'ACTIVE' };
    if (category && VALID_CATEGORIES.includes(category)) {
      where.category = category;
    }

    let orderBy = { createdAt: 'desc' };
    if (sort === 'price-asc')  orderBy = { price: 'asc' };
    if (sort === 'price-desc') orderBy = { price: 'desc' };

    const [listings, total] = await Promise.all([
      prisma.marketListing.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true, title: true, description: true, price: true,
          condition: true, category: true, imageUrl: true, status: true,
          createdAt: true,
          seller: { select: { id: true, name: true } },
        },
      }),
      prisma.marketListing.count({ where }),
    ]);

    res.json({ listings, total, page: parseInt(page) || 1, pageSize });
  } catch (err) {
    console.error('[market] getListings error', err.message);
    res.status(500).json({ error: 'Could not fetch listings.' });
  }
}

// ─── GET /api/market/:id — single listing (public) ───────────────────────────

async function getListing(req, res) {
  try {
    const listing = await prisma.marketListing.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, title: true, description: true, price: true,
        condition: true, category: true, imageUrl: true, status: true,
        sourceType: true,
        createdAt: true,
        seller: { select: { id: true, name: true } },
      },
    });
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    res.json(listing);
  } catch (err) {
    console.error('[market] getListing error', err.message);
    res.status(500).json({ error: 'Could not fetch listing.' });
  }
}

// ─── POST /api/market — create listing (auth required) ───────────────────────

async function createListing(req, res) {
  const {
    title, description, price, condition, category, imageUrl,
    sourceType, sourceInventoryItemId, sourceUserCrateId,
  } = req.body || {};

  // ── Validate source item ownership ──
  const resolvedSourceType = ['INVENTORY_ITEM', 'CRATE_KEY'].includes(sourceType) ? sourceType : 'MANUAL';

  if (resolvedSourceType === 'INVENTORY_ITEM') {
    if (!sourceInventoryItemId) return res.status(400).json({ error: 'sourceInventoryItemId is required.' });
    const item = await prisma.inventoryItem.findUnique({ where: { id: sourceInventoryItemId } });
    if (!item || item.userId !== req.user.id) return res.status(403).json({ error: 'Inventory item not found or not yours.' });
    if (item.redeemed) return res.status(409).json({ error: 'This item has already been redeemed.' });
    // Check not already listed
    const existing = await prisma.marketListing.findFirst({
      where: { sourceInventoryItemId, status: 'ACTIVE' },
    });
    if (existing) return res.status(409).json({ error: 'This item is already listed.' });
  }

  if (resolvedSourceType === 'CRATE_KEY') {
    if (!sourceUserCrateId) return res.status(400).json({ error: 'sourceUserCrateId is required.' });
    const uc = await prisma.userCrate.findUnique({ where: { id: sourceUserCrateId } });
    if (!uc || uc.userId !== req.user.id) return res.status(403).json({ error: 'Crate key not found or not yours.' });
    if (uc.opened) return res.status(409).json({ error: 'This crate has already been opened.' });
    const existing = await prisma.marketListing.findFirst({
      where: { sourceUserCrateId, status: 'ACTIVE' },
    });
    if (existing) return res.status(409).json({ error: 'This crate key is already listed.' });
  }

  // ── Validate core fields ──
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required.' });
  }
  const safeTitle = title.trim().slice(0, MAX_TITLE_LEN);

  const safePrice = parseFloat(price);
  if (isNaN(safePrice) || safePrice <= 0 || safePrice > 99999) {
    return res.status(400).json({ error: 'Price must be a positive number (max $99,999).' });
  }

  const safeCondition = VALID_CONDITIONS.includes(condition) ? condition : 'used';
  const safeCategory  = VALID_CATEGORIES.includes(category)  ? category  : 'other';
  const safeDesc      = (description || '').toString().trim().slice(0, MAX_DESC_LEN);
  const safeImage     = sanitizeUrl(imageUrl);

  try {
    const listing = await prisma.marketListing.create({
      data: {
        sellerId:             req.user.id,
        title:                safeTitle,
        description:          safeDesc,
        price:                safePrice,
        condition:            safeCondition,
        category:             safeCategory,
        imageUrl:             safeImage,
        sourceType:           resolvedSourceType,
        sourceInventoryItemId: resolvedSourceType === 'INVENTORY_ITEM' ? sourceInventoryItemId : null,
        sourceUserCrateId:    resolvedSourceType === 'CRATE_KEY'       ? sourceUserCrateId     : null,
      },
      select: {
        id: true, title: true, description: true, price: true,
        condition: true, category: true, imageUrl: true, status: true,
        sourceType: true, createdAt: true,
      },
    });
    res.status(201).json(listing);
  } catch (err) {
    console.error('[market] createListing error', err.message);
    res.status(500).json({ error: 'Could not create listing. Please try again.' });
  }
}

// ─── PATCH /api/market/:id — edit listing (owner only) ───────────────────────

async function updateListing(req, res) {
  try {
    const listing = await prisma.marketListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const { title, description, price, condition, category, imageUrl, status } = req.body || {};
    const data = {};

  if (title       !== undefined) data.title       = title.toString().trim().slice(0, MAX_TITLE_LEN);
  if (description !== undefined) data.description = description.toString().trim().slice(0, MAX_DESC_LEN);
  if (price !== undefined) {
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0 || p > 99999) return res.status(400).json({ error: 'Invalid price.' });
    data.price = p;
  }
  if (condition !== undefined && VALID_CONDITIONS.includes(condition)) data.condition = condition;
  if (category  !== undefined && VALID_CATEGORIES.includes(category))  data.category  = category;
  if (imageUrl  !== undefined) data.imageUrl = sanitizeUrl(imageUrl);

  const allowedStatuses = req.user.role === 'ADMIN' ? ['ACTIVE','SOLD','REMOVED'] : ['ACTIVE','SOLD'];
  if (status !== undefined && allowedStatuses.includes(status)) data.status = status;

  try {
    const updated = await prisma.marketListing.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, title: true, description: true, price: true,
        condition: true, category: true, imageUrl: true, status: true,
        createdAt: true, updatedAt: true,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('[market] updateListing error', err.message);
    res.status(500).json({ error: 'Could not update listing.' });
  }
}

// ─── DELETE /api/market/:id — remove listing (owner or admin) ─────────────────

async function deleteListing(req, res) {
  try {
    const listing = await prisma.marketListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    await prisma.marketListing.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[market] deleteListing error', err.message);
    res.status(500).json({ error: 'Could not delete listing.' });
  }
}

// ─── GET /api/market/my — seller's own listings ───────────────────────────────

async function getMyListings(req, res) {
  try {
    const listings = await prisma.marketListing.findMany({
      where: { sellerId: req.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, price: true, condition: true, category: true,
        imageUrl: true, status: true, sourceType: true, createdAt: true,
        _count: { select: { offers: true } },
      },
    });
    res.json(listings);
  } catch (err) {
    console.error('[market] getMyListings error', err.message);
    res.status(500).json({ error: 'Could not fetch your listings.' });
  }
}

// ─── POST /api/market/:id/offer — make an offer / contact seller ──────────────

async function makeOffer(req, res) {
  try {
    const { message } = req.body || {};
    const listing = await prisma.marketListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.status !== 'ACTIVE') return res.status(409).json({ error: 'This listing is no longer active.' });
    if (listing.sellerId === req.user.id) return res.status(400).json({ error: 'You cannot make an offer on your own listing.' });

    const safeMsg = (message || '').toString().trim().slice(0, MAX_MSG_LEN);

    const offer = await prisma.marketOffer.upsert({
      where:  { listingId_buyerId: { listingId: listing.id, buyerId: req.user.id } },
      update: { message: safeMsg, status: 'PENDING' },
      create: { listingId: listing.id, buyerId: req.user.id, message: safeMsg },
      select: { id: true, message: true, status: true, createdAt: true },
    });

    res.status(201).json(offer);
  } catch (err) {
    console.error('[market] makeOffer error', err.message);
    res.status(500).json({ error: 'Could not send message.' });
  }
}

// ─── GET /api/market/:id/offers — view offers on a listing (seller only) ──────

async function getOffers(req, res) {
  try {
    const listing = await prisma.marketListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    const offers = await prisma.marketOffer.findMany({
      where: { listingId: listing.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, message: true, status: true, createdAt: true,
        buyer: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(offers);
  } catch (err) {
    console.error('[market] getOffers error', err.message);
    res.status(500).json({ error: 'Could not fetch offers.' });
  }
}

// ─── PATCH /api/market/:id/offers/:offerId — accept or decline offer ──────────

async function respondToOffer(req, res) {
  try {
    const { status } = req.body || {};
    if (!['ACCEPTED', 'DECLINED'].includes(status)) {
      return res.status(400).json({ error: 'status must be ACCEPTED or DECLINED.' });
    }

    const listing = await prisma.marketListing.findUnique({ where: { id: req.params.id } });
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const offer = await prisma.marketOffer.findUnique({ where: { id: req.params.offerId } });
    if (!offer || offer.listingId !== listing.id) return res.status(404).json({ error: 'Offer not found.' });

    const updated = await prisma.marketOffer.update({
      where: { id: offer.id },
      data:  { status },
      select: { id: true, status: true },
    });

    // If accepted: mark listing sold and consume the source inventory item / crate key
    if (status === 'ACCEPTED') {
      await prisma.marketListing.update({ where: { id: listing.id }, data: { status: 'SOLD' } });

      if (listing.sourceType === 'INVENTORY_ITEM' && listing.sourceInventoryItemId) {
        await prisma.inventoryItem.update({
          where: { id: listing.sourceInventoryItemId },
          data:  { redeemed: true, redeemedAt: new Date() },
        }).catch(() => {}); // non-fatal if already gone
      }
      // Note: crate keys are physical; we don't auto-consume them server-side —
      // the seller is responsible for transferring the key out-of-band for now.
    }

    res.json(updated);
  } catch (err) {
    console.error('[market] respondToOffer error', err.message);
    res.status(500).json({ error: 'Could not respond to offer.' });
  }
}

module.exports = {
  getListableInventory,
  getListings, getListing, createListing, updateListing, deleteListing,
  getMyListings, makeOffer, getOffers, respondToOffer,
};


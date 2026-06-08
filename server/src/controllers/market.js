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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeUrl(raw) {
  if (!raw) return '';
  const s = raw.trim().slice(0, MAX_IMG_LEN);
  // Only allow https:// image URLs or empty string
  if (!/^https:\/\//i.test(s)) return '';
  return s;
}

// ─── GET /api/market — list ACTIVE listings (public) ─────────────────────────

async function getListings(req, res) {
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
}

// ─── GET /api/market/:id — single listing (public) ───────────────────────────

async function getListing(req, res) {
  const listing = await prisma.marketListing.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, title: true, description: true, price: true,
      condition: true, category: true, imageUrl: true, status: true,
      createdAt: true,
      seller: { select: { id: true, name: true } },
    },
  });
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  res.json(listing);
}

// ─── POST /api/market — create listing (auth required) ───────────────────────

async function createListing(req, res) {
  const { title, description, price, condition, category, imageUrl } = req.body || {};

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

  const listing = await prisma.marketListing.create({
    data: {
      sellerId:    req.user.id,
      title:       safeTitle,
      description: safeDesc,
      price:       safePrice,
      condition:   safeCondition,
      category:    safeCategory,
      imageUrl:    safeImage,
    },
    select: {
      id: true, title: true, description: true, price: true,
      condition: true, category: true, imageUrl: true, status: true,
      createdAt: true,
    },
  });

  res.status(201).json(listing);
}

// ─── PATCH /api/market/:id — edit listing (owner only) ───────────────────────

async function updateListing(req, res) {
  const listing = await prisma.marketListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  const { title, description, price, condition, category, imageUrl, status } = req.body || {};
  const data = {};

  if (title   !== undefined) data.title       = title.toString().trim().slice(0, MAX_TITLE_LEN);
  if (description !== undefined) data.description = description.toString().trim().slice(0, MAX_DESC_LEN);
  if (price   !== undefined) {
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0 || p > 99999) return res.status(400).json({ error: 'Invalid price.' });
    data.price = p;
  }
  if (condition !== undefined && VALID_CONDITIONS.includes(condition)) data.condition = condition;
  if (category  !== undefined && VALID_CATEGORIES.includes(category))  data.category  = category;
  if (imageUrl  !== undefined) data.imageUrl = sanitizeUrl(imageUrl);

  // Allow sellers to mark as SOLD; admins can also set REMOVED
  const allowedStatuses = req.user.role === 'ADMIN' ? ['ACTIVE','SOLD','REMOVED'] : ['ACTIVE','SOLD'];
  if (status !== undefined && allowedStatuses.includes(status)) data.status = status;

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
}

// ─── DELETE /api/market/:id — remove listing (owner or admin) ─────────────────

async function deleteListing(req, res) {
  const listing = await prisma.marketListing.findUnique({ where: { id: req.params.id } });
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  if (listing.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  await prisma.marketListing.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}

// ─── GET /api/market/my/listings — seller's own listings ─────────────────────

async function getMyListings(req, res) {
  const listings = await prisma.marketListing.findMany({
    where: { sellerId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, title: true, price: true, condition: true, category: true,
      imageUrl: true, status: true, createdAt: true,
      _count: { select: { offers: true } },
    },
  });
  res.json(listings);
}

// ─── POST /api/market/:id/offer — make an offer / contact seller ──────────────

async function makeOffer(req, res) {
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
}

// ─── GET /api/market/:id/offers — view offers on a listing (seller only) ──────

async function getOffers(req, res) {
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
}

// ─── PATCH /api/market/:id/offers/:offerId — accept or decline offer ──────────

async function respondToOffer(req, res) {
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

  // If accepted, mark the listing as SOLD
  if (status === 'ACCEPTED') {
    await prisma.marketListing.update({ where: { id: listing.id }, data: { status: 'SOLD' } });
  }

  res.json(updated);
}

module.exports = {
  getListings, getListing, createListing, updateListing, deleteListing,
  getMyListings, makeOffer, getOffers, respondToOffer,
};

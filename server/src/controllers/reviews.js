// src/controllers/reviews.js — product ratings & reviews
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * GET /api/reviews/:productId
 * Public. Returns aggregate stats + list of reviews.
 * If the request is authenticated, also returns the caller's own rating.
 */
async function getReviews(req, res) {
  const { productId } = req.params;
  if (!productId || typeof productId !== 'string' || productId.length > 50) {
    return res.status(400).json({ error: 'Invalid product ID.' });
  }

  try {
    const [reviews, agg] = await Promise.all([
      prisma.review.findMany({
        where: { productId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { user: { select: { name: true } } },
      }),
      prisma.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    const average = agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0;
    const count = agg._count.rating;

    // Find the authenticated user's own rating if logged in
    let userRating = null;
    if (req.user) {
      const own = reviews.find((r) => r.userId === req.user.id);
      if (own) userRating = own.rating;
    }

    const formatted = reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body || '',
      createdAt: r.createdAt,
      userName: formatName(r.user.name),
    }));

    return res.json({ average, count, userRating, reviews: formatted });
  } catch (err) {
    console.error('[reviews] getReviews error', err.message);
    return res.status(500).json({ error: 'Could not load reviews.' });
  }
}

/**
 * POST /api/reviews
 * Requires authentication.
 * Body: { productId, rating (1–5), body? }
 * Upserts the review and refreshes the cached average on ShopProduct.
 */
async function upsertReview(req, res) {
  const { productId, rating, body } = req.body || {};

  if (!productId || typeof productId !== 'string' || productId.length > 50) {
    return res.status(400).json({ error: 'Invalid product ID.' });
  }
  const r = parseInt(rating, 10);
  if (isNaN(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  }
  const safeBody = typeof body === 'string' ? body.trim().slice(0, 500) : '';

  try {
    // Verify the product exists
    const product = await prisma.shopProduct.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: 'Product not found.' });

    // Upsert the review
    const review = await prisma.review.upsert({
      where: { productId_userId: { productId, userId: req.user.id } },
      update: { rating: r, body: safeBody, updatedAt: new Date() },
      create: { productId, userId: req.user.id, rating: r, body: safeBody },
    });

    // Recalculate and persist the cached average on ShopProduct
    const agg = await prisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    const newAverage = agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0;
    const newCount = agg._count.rating;

    await prisma.shopProduct.update({
      where: { id: productId },
      data: { rating: newAverage },
    });

    return res.json({ ok: true, review: { id: review.id, rating: review.rating, body: review.body }, newAverage, newCount });
  } catch (err) {
    console.error('[reviews] upsertReview error', err.message);
    return res.status(500).json({ error: 'Could not save review.' });
  }
}

/** Show first name + last initial for privacy: "Jane Doe" → "Jane D." */
function formatName(name) {
  if (!name) return 'Anonymous';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}

module.exports = { getReviews, upsertReview };

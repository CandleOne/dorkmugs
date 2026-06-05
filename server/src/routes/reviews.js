// src/routes/reviews.js — product ratings & reviews
'use strict';

const router = require('express').Router();
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { getReviews, upsertReview } = require('../controllers/reviews');

// GET /api/reviews/:productId — public, shows auth user's own rating if logged in
router.get('/:productId', optionalAuth, getReviews);

// POST /api/reviews — must be logged in
router.post('/', requireAuth, upsertReview);

module.exports = router;

// src/routes/orders.js
const router = require('express').Router();
const ctrl = require('../controllers/orders');
const { requireAuth } = require('../middleware/auth');
const { orderLookupLimiter } = require('../middleware/rateLimiter');

// POST /api/orders/lookup — guest order lookup (no auth, rate-limited)
router.post('/lookup', orderLookupLimiter, ctrl.lookupOrder);

router.get('/:id', requireAuth, ctrl.getOrder);

module.exports = router;

// src/routes/orders.js
const router = require('express').Router();
const ctrl = require('../controllers/orders');
const { requireAuth } = require('../middleware/auth');

router.get('/:id', requireAuth, ctrl.getOrder);

module.exports = router;

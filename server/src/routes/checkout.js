// src/routes/checkout.js
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/checkout');
const { optionalAuth } = require('../middleware/auth');

router.post(
  '/',
  optionalAuth,
  body('items').isArray({ min: 1 }).withMessage('Cart cannot be empty.'),
  body('items.*.name').notEmpty().withMessage('Item name required.'),
  body('items.*.price').isInt({ min: 1 }).withMessage('Price must be a positive integer (cents).'),
  body('items.*.qty').isInt({ min: 1 }).withMessage('Quantity must be at least 1.'),
  ctrl.createCheckout
);

module.exports = router;

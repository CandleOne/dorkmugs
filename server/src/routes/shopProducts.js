// src/routes/shopProducts.js — public storefront catalog
const router = require('express').Router();
const { listShopProducts, getFeaturedProducts } = require('../controllers/admin');

// GET /api/shop-products/featured — featured products for the homepage
router.get('/featured', getFeaturedProducts);

// GET /api/shop-products — returns all published products for the storefront
router.get('/', listShopProducts);

module.exports = router;

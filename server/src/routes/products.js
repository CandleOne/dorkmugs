// src/routes/products.js
const router = require('express').Router();
const ctrl = require('../controllers/products');

router.get('/', ctrl.listProducts);
router.get('/:handle', ctrl.getProduct);

module.exports = router;

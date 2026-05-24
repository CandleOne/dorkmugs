// src/routes/admin.js
const router = require('express').Router();
const ctrl = require('../controllers/admin');
const { requireAuth } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

router.use(requireAuth, requireAdmin);

// Dashboard
router.get('/stats', ctrl.getStats);

// Users
router.get('/users', ctrl.listUsers);
router.patch('/users/:id/role', ctrl.updateUserRole);
router.delete('/users/:id', ctrl.deleteUser);

// Orders
router.get('/orders', ctrl.listOrders);
router.get('/orders/:id', ctrl.getOrder);
router.patch('/orders/:id/status', ctrl.updateOrderStatus);

// Printify
router.get('/printify/products', ctrl.listPrintifyProducts);
router.post('/printify/orders/:printifyOrderId/send', ctrl.sendPrintifyOrderToProduction);

// Printify catalog + mug creator
router.get('/printify/blueprints', ctrl.printifyCatalogBlueprints);
router.get('/printify/blueprints/:bid/providers', ctrl.printifyCatalogProviders);
router.get('/printify/blueprints/:bid/providers/:pid/variants', ctrl.printifyCatalogVariants);
router.post('/printify/create-mug', ctrl.printifyCreateMug);

// Shop Products (catalog management)
router.get('/shop-products', ctrl.adminListShopProducts);
router.post('/shop-products', ctrl.createShopProduct);
router.patch('/shop-products/:id/featured', ctrl.toggleFeaturedProduct);
router.patch('/shop-products/:id', ctrl.updateShopProduct);
router.delete('/shop-products/:id', ctrl.deleteShopProduct);

router.get('/image-assets', ctrl.listImageAssets);

// Collections (admin CRUD)
router.get('/collections', ctrl.adminListCollections);
router.post('/collections', ctrl.createAdminCollection);
router.patch('/collections/:slug', ctrl.updateAdminCollection);
router.delete('/collections/:slug', ctrl.deleteAdminCollection);

module.exports = router;

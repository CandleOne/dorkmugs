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

// Shop Products (catalog management)
router.get('/shop-products', ctrl.adminListShopProducts);
router.post('/shop-products', ctrl.createShopProduct);
router.patch('/shop-products/:id', ctrl.updateShopProduct);
router.delete('/shop-products/:id', ctrl.deleteShopProduct);

module.exports = router;

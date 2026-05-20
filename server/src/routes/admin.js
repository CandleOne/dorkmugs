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

module.exports = router;

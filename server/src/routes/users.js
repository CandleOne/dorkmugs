// src/routes/users.js
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/users');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/me', ctrl.getProfile);
router.put(
  '/me',
  body('name').optional().trim().isLength({ min: 1 }),
  body('newPassword').optional().isLength({ min: 8 })
    .matches(/[A-Z]/).withMessage('New password must contain an uppercase letter.')
    .matches(/[0-9]/).withMessage('New password must contain a number.'),
  ctrl.updateProfile
);

router.get('/me/orders', ctrl.getMyOrders);
router.get('/me/orders/:id', ctrl.getMyOrder);

router.get('/me/addresses', ctrl.getAddresses);
router.post(
  '/me/addresses',
  body('name').trim().notEmpty(),
  body('line1').trim().notEmpty(),
  body('city').trim().notEmpty(),
  body('state').trim().notEmpty(),
  body('zip').trim().notEmpty(),
  ctrl.addAddress
);
router.delete('/me/addresses/:id', ctrl.deleteAddress);

module.exports = router;

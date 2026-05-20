// src/routes/auth.js
const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/auth');
const { requireAuth } = require('../middleware/auth');
const { authLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');

const passwordRules = body('password')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters.')
  .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter.')
  .matches(/[0-9]/).withMessage('Password must contain a number.');

router.post(
  '/register',
  authLimiter,
  body('name').trim().isLength({ min: 1 }).withMessage('Name is required.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  passwordRules,
  ctrl.register
);

router.post(
  '/login',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  ctrl.login
);

router.post('/logout', requireAuth, ctrl.logout);

router.post('/refresh', ctrl.refresh);

router.get('/me', requireAuth, ctrl.me);

router.post(
  '/forgot-password',
  passwordResetLimiter,
  body('email').isEmail().normalizeEmail(),
  ctrl.forgotPassword
);

router.post(
  '/reset-password',
  authLimiter,
  body('token').notEmpty().withMessage('Token required.'),
  passwordRules,
  ctrl.resetPassword
);

module.exports = router;

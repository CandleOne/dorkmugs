// src/routes/webhooks.js
// NOTE: raw body parsing is applied selectively in app.js for the Stripe route
const router = require('express').Router();
const ctrl = require('../controllers/webhooks');

router.post('/stripe', ctrl.stripeWebhook);
router.post('/printify', ctrl.printifyWebhook);

module.exports = router;

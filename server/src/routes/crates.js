// src/routes/crates.js
const router = require('express').Router();
const ctrl   = require('../controllers/crates');
const { requireAuth } = require('../middleware/auth');

// Public — list crates for the storefront
router.get('/', ctrl.listCrates);

// Authenticated — user's own inventory
router.get('/my', requireAuth, ctrl.myInventory);

// Open a specific crate key the user owns
router.post('/open/:userCrateId', requireAuth, ctrl.openCrate);

// Claim a won prize (creates Stripe checkout at discounted price)
router.post('/claim/:claimToken', requireAuth, ctrl.claimPrize);

module.exports = router;

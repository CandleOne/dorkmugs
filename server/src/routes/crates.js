// src/routes/crates.js
const router = require('express').Router();
const ctrl   = require('../controllers/crates');
const { requireAuth } = require('../middleware/auth');

// Public — list crates for the storefront
router.get('/', ctrl.listCrates);

// Authenticated — user's own crate inventory
router.get('/my', requireAuth, ctrl.myInventory);

// Authenticated — full item inventory (shards, vouchers, coins)
router.get('/inventory', requireAuth, ctrl.getInventory);

// Open a specific crate key the user owns
router.post('/open/:userCrateId', requireAuth, ctrl.openCrate);

// Claim a won prize (creates Stripe checkout at discounted price)
router.post('/claim/:claimToken', requireAuth, ctrl.claimPrize);

// Merge 10 shards into a mug voucher
router.post('/merge', requireAuth, ctrl.mergeShards);

// Redeem a mug voucher for a free checkout
router.post('/redeem/:voucherId', requireAuth, ctrl.redeemVoucher);

module.exports = router;

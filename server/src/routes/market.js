// src/routes/market.js — peer-to-peer marketplace routes
'use strict';

const router = require('express').Router();
const { requireAuth, optionalAuth } = require('../middleware/auth');
const {
  getListableInventory,
  getListings, getListing, createListing, updateListing, deleteListing,
  getMyListings, makeOffer, getOffers, respondToOffer,
} = require('../controllers/market');

// Authenticated helpers (must be before /:id wildcard)
router.get('/listable', requireAuth, getListableInventory);
router.get('/my',       requireAuth, getMyListings);

// Public browse
router.get('/',    optionalAuth, getListings);
router.get('/:id', optionalAuth, getListing);

// Listing CRUD (auth required)
router.post('/',      requireAuth, createListing);
router.patch('/:id',  requireAuth, updateListing);
router.delete('/:id', requireAuth, deleteListing);

// Offers
router.post('/:id/offer',            requireAuth, makeOffer);
router.get('/:id/offers',            requireAuth, getOffers);
router.patch('/:id/offers/:offerId', requireAuth, respondToOffer);

module.exports = router;

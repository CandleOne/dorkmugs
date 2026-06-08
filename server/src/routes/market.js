// src/routes/market.js — peer-to-peer marketplace routes
'use strict';

const router = require('express').Router();
const { requireAuth, optionalAuth } = require('../middleware/auth');
const {
  getListings, getListing, createListing, updateListing, deleteListing,
  getMyListings, makeOffer, getOffers, respondToOffer,
} = require('../controllers/market');

// Public browse
router.get('/',    optionalAuth, getListings);
router.get('/my',  requireAuth,  getMyListings);   // must be before /:id
router.get('/:id', optionalAuth, getListing);

// Listing CRUD (auth required)
router.post('/',    requireAuth, createListing);
router.patch('/:id', requireAuth, updateListing);
router.delete('/:id', requireAuth, deleteListing);

// Offers
router.post('/:id/offer',               requireAuth, makeOffer);
router.get('/:id/offers',               requireAuth, getOffers);
router.patch('/:id/offers/:offerId',    requireAuth, respondToOffer);

module.exports = router;

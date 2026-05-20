// src/routes/collections.js — public read-only collections list
const router = require('express').Router();
const ctrl = require('../controllers/admin');

router.get('/', ctrl.getPublicCollections);

module.exports = router;

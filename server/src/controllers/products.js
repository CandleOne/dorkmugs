// src/controllers/products.js — proxy to Printify API
const printify = require('../services/printify');

// GET /api/products
async function listProducts(req, res) {
  try {
    const result = await printify.listProducts();
    return res.json(result);
  } catch (err) {
    console.error('[products] listProducts error', err.message);
    return res.status(502).json({ error: 'Could not fetch products.' });
  }
}

// GET /api/products/:id
async function getProduct(req, res) {
  try {
    const product = await printify.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    return res.json({ product });
  } catch (err) {
    console.error('[products] getProduct error', err.message);
    return res.status(502).json({ error: 'Could not fetch product.' });
  }
}

module.exports = { listProducts, getProduct };

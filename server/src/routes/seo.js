// src/routes/seo.js — Server-rendered product pages for Google indexing
// Mounted at /mugs → handles GET /mugs/:id
'use strict';

const router  = require('express').Router();
const fs      = require('fs');
const path    = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma       = new PrismaClient();
const SITE_URL     = (process.env.SITE_URL || 'https://dorkmugs.shop').replace(/\/+$/, '');
const frontendRoot = path.resolve(__dirname, '../../../');

// Cache item.html once at startup
let _itemTemplate = null;
function getItemTemplate() {
  if (!_itemTemplate) {
    _itemTemplate = fs.readFileSync(path.join(frontendRoot, 'item.html'), 'utf8');
  }
  return _itemTemplate;
}

/** Escape a value for use inside an HTML attribute or text node. */
function escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert a relative asset path like ./Assets/… to an absolute URL. */
function absoluteUrl(relPath) {
  if (!relPath) return '';
  if (/^https?:\/\//i.test(relPath)) return relPath;
  return SITE_URL + '/' + relPath.replace(/^\.\//, '');
}

const COLLECTION_NAMES = {
  bp:   'BP Collection',
  fame: 'Fame & Infamy Collection',
  stem: 'STEM Collection',
};

// GET /mugs/:id  — SSR product page with full SEO <head>
router.get('/:id', async (req, res) => {
  try {
    const product = await prisma.shopProduct.findFirst({
      where: { id: req.params.id, published: true },
    });

    if (!product) {
      return res.status(404).sendFile(path.join(frontendRoot, 'index.html'));
    }

    const pageUrl    = `${SITE_URL}/mugs/${product.id}`;
    const title      = `${product.pname} – Dork Mugs`;
    const rawDesc    = product.description || `Shop the ${product.pname} at Dork Mugs. Premium 11oz ceramic mug.`;
    const desc       = escAttr(rawDesc);
    const imageRel   = product.imageLeft || product.imageCenter || product.imageRight || '';
    const imageAbs   = absoluteUrl(imageRel);
    const collection = escAttr(COLLECTION_NAMES[product.collection] || product.collection);

    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: product.pname,
      description: rawDesc,
      image: imageAbs,
      brand: { '@type': 'Brand', name: 'Dork Mugs' },
      offers: {
        '@type': 'Offer',
        price: String(product.price.toFixed(2)),
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        url: pageUrl,
      },
      additionalProperty: {
        '@type': 'PropertyValue',
        name: 'Collection',
        value: COLLECTION_NAMES[product.collection] || product.collection,
      },
    });

    // Build SEO head block to replace the generic <title>Dork Mugs</title>
    const seoHead = [
      `<title>${escAttr(title)}</title>`,
      `<meta name="description" content="${desc}" />`,
      `<link rel="canonical" href="${pageUrl}" />`,
      `<meta property="og:title" content="${escAttr(title)}" />`,
      `<meta property="og:description" content="${desc}" />`,
      `<meta property="og:image" content="${escAttr(imageAbs)}" />`,
      `<meta property="og:url" content="${pageUrl}" />`,
      `<meta property="og:type" content="product" />`,
      `<meta property="og:site_name" content="Dork Mugs" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${escAttr(title)}" />`,
      `<meta name="twitter:description" content="${desc}" />`,
      `<meta name="twitter:image" content="${escAttr(imageAbs)}" />`,
      `<script type="application/ld+json">${jsonLd}</script>`,
    ].join('\n');

    // Inject product ID so client-side renderItem() can read it
    const productIdScript = `<script>window._productId = ${JSON.stringify(product.id)};</script>`;

    let html = getItemTemplate();
    // Replace the generic title tag with the full SEO head block
    html = html.replace('<title>Dork Mugs</title>', seoHead);
    // Inject product ID just before </head>
    html = html.replace('</head>', `${productIdScript}\n</head>`);

    res.type('text/html').send(html);
  } catch (err) {
    console.error('[seo] /mugs/:id error', err.message);
    res.status(500).send('Internal server error');
  }
});

module.exports = router;

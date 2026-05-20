// src/services/shopify.js — Shopify Storefront & Admin API clients
const axios = require('axios');
const config = require('../config');

// ─── Storefront API (GraphQL, used for cart / checkout) ──────────────────────

const storefrontClient = axios.create({
  baseURL: `https://${config.shopify.storeDomain}/api/2024-01/graphql.json`,
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Storefront-Access-Token': config.shopify.storefrontToken,
  },
  timeout: 15000,
});

async function storefrontQuery(query, variables = {}) {
  const { data } = await storefrontClient.post('', { query, variables });
  if (data.errors && data.errors.length > 0) {
    throw new Error(data.errors.map((e) => e.message).join(' | '));
  }
  return data.data;
}

// ─── Cart API mutations ───────────────────────────────────────────────────────

/**
 * Create a Shopify cart and return { id, checkoutUrl, cost }.
 * @param {Array<{ merchandiseId: string, quantity: number }>} lines
 * @param {string[]} [discountCodes]
 */
async function createCart(lines, discountCodes = []) {
  const query = `
    mutation cartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart {
          id
          checkoutUrl
          cost {
            totalAmount { amount currencyCode }
            subtotalAmount { amount currencyCode }
          }
          lines(first: 50) {
            edges {
              node {
                id
                quantity
                merchandise {
                  ... on ProductVariant {
                    id
                    title
                    price { amount currencyCode }
                    product { title }
                  }
                }
              }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const result = await storefrontQuery(query, {
    input: { lines, discountCodes },
  });
  const { cart, userErrors } = result.cartCreate;
  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map((e) => e.message).join(' | '));
  }
  return cart;
}

/** Fetch products from Shopify Storefront API */
async function listProducts(first = 100, after = null) {
  const query = `
    query getProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            description
            handle
            tags
            priceRange {
              minVariantPrice { amount currencyCode }
            }
            images(first: 1) {
              edges { node { url altText } }
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  availableForSale
                  price { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }
  `;
  return storefrontQuery(query, { first, after });
}

/** Fetch a single product by handle */
async function getProductByHandle(handle) {
  const query = `
    query getProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id title description handle tags
        images(first: 10) { edges { node { url altText } } }
        variants(first: 10) {
          edges {
            node {
              id title availableForSale
              price { amount currencyCode }
            }
          }
        }
      }
    }
  `;
  const result = await storefrontQuery(query, { handle });
  return result.productByHandle;
}

// ─── Admin API (REST, used for order management & webhooks) ──────────────────

const adminClient = axios.create({
  baseURL: `https://${config.shopify.storeDomain}/admin/api/2024-01`,
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': config.shopify.adminToken,
  },
  timeout: 15000,
});

/** List orders from Shopify Admin API */
async function listOrders(params = {}) {
  const { data } = await adminClient.get('/orders.json', { params });
  return data.orders;
}

/** Get a single order */
async function getOrder(orderId) {
  const { data } = await adminClient.get(`/orders/${orderId}.json`);
  return data.order;
}

/** Register a webhook in Shopify Admin */
async function registerWebhook(topic, address) {
  const { data } = await adminClient.post('/webhooks.json', {
    webhook: { topic, address, format: 'json' },
  });
  return data.webhook;
}

/** List registered webhooks */
async function listWebhooks() {
  const { data } = await adminClient.get('/webhooks.json');
  return data.webhooks;
}

/**
 * Verify a Shopify webhook HMAC signature.
 * @param {Buffer} rawBody - the raw request body
 * @param {string} hmacHeader - X-Shopify-Hmac-Sha256 header value
 */
function verifyWebhookSignature(rawBody, hmacHeader) {
  const crypto = require('crypto');
  const digest = crypto
    .createHmac('sha256', config.shopify.webhookSecret)
    .update(rawBody)
    .digest('base64');
  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

module.exports = {
  createCart,
  listProducts,
  getProductByHandle,
  listOrders,
  getOrder,
  registerWebhook,
  listWebhooks,
  verifyWebhookSignature,
};

// Run: node scripts/list-products.js
require('dotenv').config();
const axios = require('axios');

const key = process.env.PRINTIFY_API_KEY;
const shopId = process.env.PRINTIFY_SHOP_ID;
const base = 'https://api.printify.com/v1';
const headers = { Authorization: `Bearer ${key}` };

(async () => {
  const { data } = await axios.get(`${base}/shops/${shopId}/products.json?limit=50`, { headers });
  const products = data.data || data;
  console.log(`Total products: ${products.length}\n`);

  for (const p of products) {
    console.log(`--- ${p.title}`);
    console.log(`  printifyProductId: "${p.id}"`);
    const enabled = p.variants.filter(v => v.is_enabled);
    enabled.slice(0, 10).forEach(v => {
      const price = `$${(v.price / 100).toFixed(2)}`;
      console.log(`  variantId: ${v.id}  |  ${v.title}  |  ${price}`);
    });
    if (enabled.length > 10) console.log(`  ...and ${enabled.length - 10} more variants`);
    console.log();
  }
})().catch(e => console.error(e.response?.data || e.message));

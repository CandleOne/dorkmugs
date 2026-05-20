# Dork Mugs — Backend Setup

## Stack
- **Node.js** (≥18) + **Express** — REST API
- **Prisma** + **SQLite** (dev) / **PostgreSQL** (prod) — database
- **JWT** in `httpOnly` cookies — auth
- **Shopify Storefront API** (Cart API) — hosted checkout
- **Shopify Admin API** — order webhooks & management
- **Printify REST API** — product sync & fulfillment
- **Nodemailer** — transactional emails

---

## First-time setup

```bash
cd server

# 1. Install dependencies
npm install

# 2. Copy env and fill in your keys
cp .env.example .env

# 3. Run DB migrations (creates dev.db)
npx prisma migrate dev --name init

# 4. Seed the first admin user
npm run db:seed

# 5. Start the dev server
npm run dev
# → http://localhost:5000
```

---

## Environment variables to fill in (`.env`)

| Variable | Where to get it |
|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PRINTIFY_API_KEY` | Printify → My Profile → Connections → API |
| `PRINTIFY_SHOP_ID` | Printify → Shops → your shop ID in the URL |
| `SHOPIFY_STORE_DOMAIN` | `yourstore.myshopify.com` |
| `SHOPIFY_STOREFRONT_TOKEN` | Shopify Admin → Apps → Develop apps → Create app → Storefront API access scopes |
| `SHOPIFY_ADMIN_TOKEN` | Same app → Admin API access token |
| `SHOPIFY_WEBHOOK_SECRET` | Set when registering webhooks (see below) |
| `SMTP_*` | Your SMTP provider (SendGrid, Postmark, etc.) |

---

## Shopify setup

1. Create a **Shopify store** and connect **Printify** via their Shopify integration.  
   Printify will push products & handle fulfillment automatically.

2. In Shopify Admin → Apps → Develop apps:
   - Enable Storefront API: `unauthenticated_read_product_listings`, `unauthenticated_write_checkouts`
   - Enable Admin API: `read_orders`, `write_orders`, `read_customers`

3. Register webhooks (run once after server is live):
   ```
   POST https://yourstore.myshopify.com/admin/api/2024-01/webhooks.json
   { "topic": "orders/create",     "address": "https://yourapi.com/api/webhooks/shopify" }
   { "topic": "orders/updated",    "address": "https://yourapi.com/api/webhooks/shopify" }
   { "topic": "orders/fulfilled",  "address": "https://yourapi.com/api/webhooks/shopify" }
   ```

4. Add `merchandiseId` (Shopify variant GID) to each product in `include/prodbs.js`  
   so the cart checkout can pass it to the Shopify Cart API:
   ```js
   { id: "gc01", ..., merchandiseId: "gid://shopify/ProductVariant/12345678" }
   ```

---

## API Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | Create account |
| `POST` | `/api/auth/login` | — | Log in |
| `POST` | `/api/auth/logout` | User | Log out |
| `POST` | `/api/auth/refresh` | — | Rotate access token |
| `GET`  | `/api/auth/me` | User | Current user |
| `POST` | `/api/auth/forgot-password` | — | Send reset email |
| `POST` | `/api/auth/reset-password` | — | Reset password |
| `GET`  | `/api/users/me` | User | Profile |
| `PUT`  | `/api/users/me` | User | Update profile / password |
| `GET`  | `/api/users/me/orders` | User | Order history |
| `GET`  | `/api/users/me/addresses` | User | Saved addresses |
| `POST` | `/api/users/me/addresses` | User | Add address |
| `DELETE` | `/api/users/me/addresses/:id` | User | Delete address |
| `GET`  | `/api/products` | — | Shopify products |
| `GET`  | `/api/products/:handle` | — | Single product |
| `POST` | `/api/checkout` | Optional | Create Shopify cart → return `checkoutUrl` |
| `GET`  | `/api/admin/stats` | Admin | Dashboard stats |
| `GET`  | `/api/admin/orders` | Admin | All orders |
| `PATCH` | `/api/admin/orders/:id/status` | Admin | Update order status |
| `GET`  | `/api/admin/users` | Admin | All users |
| `PATCH` | `/api/admin/users/:id/role` | Admin | Change user role |
| `DELETE` | `/api/admin/users/:id` | Admin | Delete user |
| `GET`  | `/api/admin/printify/products` | Admin | Printify products |
| `POST` | `/api/webhooks/shopify` | HMAC | Shopify order events |
| `POST` | `/api/webhooks/printify` | — | Printify shipment events |

---

## Production checklist

- [ ] Switch `DATABASE_URL` to PostgreSQL and run `prisma migrate deploy`
- [ ] Set `NODE_ENV=production` (enables secure cookies)
- [ ] Set `ALLOWED_ORIGINS` to your production domain
- [ ] Add all secrets to your hosting provider's env config
- [ ] Register Shopify webhooks pointing to your production domain
- [ ] Deploy server behind HTTPS (required for `secure` cookies + Shopify)

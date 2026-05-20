# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Prisma requires OpenSSL
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps first (better layer caching)
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy everything (frontend HTML/CSS/JS + server source)
COPY . .

# Generate Prisma client for debian-openssl-3 (node:20-slim / Debian Bookworm)
RUN cd server && npx prisma generate

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artefacts from builder
COPY --from=builder /app ./

# Persistent volume for SQLite lives at /data
RUN mkdir -p /data

EXPOSE 5000

WORKDIR /app/server

# Run migrations then start; DATABASE_URL must be set as a Fly secret:
#   fly secrets set DATABASE_URL="file:/data/app.db"
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]

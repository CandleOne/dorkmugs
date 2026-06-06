// src/middleware/trackPageView.js
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Paths we never want to count
const SKIP_PREFIXES = ['/api/', '/admin', '/_', '/favicon', '/sitemap', '/robots'];
const SKIP_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg',
                         '.ico', '.woff', '.woff2', '.ttf', '.map', '.json'];

function shouldTrack(path) {
  if (SKIP_PREFIXES.some(p => path.startsWith(p))) return false;
  if (SKIP_EXTENSIONS.some(e => path.endsWith(e))) return false;
  return true;
}

function getIp(req) {
  // Works behind the reverse proxy you've configured with trust proxy
  return req.ip || req.connection?.remoteAddress || '';
}

function getSessionId(req) {
  // Use existing session cookie if present, otherwise derive a stable
  // hash from IP + UA so we can count uniques without storing PII
  if (req.cookies?.sessionId) return req.cookies.sessionId;
  const raw = getIp(req) + '|' + (req.headers['user-agent'] || '');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

module.exports = function trackPageView(req, res, next) {
  if (!shouldTrack(req.path)) return next();

  // Fire-and-forget — never block the response
  prisma.pageView.create({
    data: {
      path:      req.path,
      ip:        getIp(req).slice(0, 45),       // fits IPv6
      userAgent: (req.headers['user-agent'] || '').slice(0, 300),
      sessionId: getSessionId(req),
    },
  }).catch(err => console.error('[trackPageView]', err.message));

  next();
};
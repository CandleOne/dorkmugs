// src/middleware/auth.js — verifies JWT access token from httpOnly cookie
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Attaches req.user = { id, email, role } if a valid access token is present.
 * Returns 401 if missing or invalid.
 */
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.access_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

/**
 * Like requireAuth but also tolerates unauthenticated requests (attaches
 * req.user if valid token present, otherwise req.user = null).
 */
function optionalAuth(req, res, next) {
  const token = req.cookies && req.cookies.access_token;
  if (!token) { req.user = null; return next(); }
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, optionalAuth };

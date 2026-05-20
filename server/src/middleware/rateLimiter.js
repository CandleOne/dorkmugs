// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

/** Strict limiter for auth endpoints (login, register, password reset) */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
  skipSuccessfulRequests: false,
});

/** General API limiter */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

/** Strict limiter for password reset specifically */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Try again in an hour.' },
});

module.exports = { authLimiter, apiLimiter, passwordResetLimiter };

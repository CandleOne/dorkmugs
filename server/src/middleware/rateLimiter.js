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

/** Contact form — prevent spam-relay abuse */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please try again in an hour.' },
});

/** Order lookup — prevent enumeration attacks */
const orderLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lookup attempts. Please try again in 15 minutes.' },
});

/** Newsletter signup — prevent spam */
const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again later.' },
});

module.exports = { authLimiter, apiLimiter, passwordResetLimiter, contactLimiter, orderLookupLimiter, newsletterLimiter };

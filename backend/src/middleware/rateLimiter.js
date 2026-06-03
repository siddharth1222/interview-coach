import rateLimit from 'express-rate-limit';

const json429 = (_req, res) =>
  res.status(429).json({ success: false, message: 'Too many requests, please try again later.' });

/** Stricter limiter for auth endpoints to slow credential-stuffing. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

/** Limiter for Gemini-backed endpoints (cost + abuse protection). */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

/** Baseline limiter for the whole API. */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

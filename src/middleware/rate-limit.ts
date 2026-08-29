import rateLimit from 'express-rate-limit';

/** Login is the only brute-forceable surface. Successful logins don't count. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many login attempts. Try again later.',
      details: [],
    },
  },
});

export const globalLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

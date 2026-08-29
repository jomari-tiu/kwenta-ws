import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/request-logger.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authPublicRoutes } from './modules/auth/auth.routes.js';
import { requireAuth } from './middleware/require-auth.js';
import { apiRouter } from './routes.js';

function buildCorsOptions(): cors.CorsOptions {
  const exact = env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const pattern = env.CORS_ORIGIN_REGEX
    ? new RegExp(env.CORS_ORIGIN_REGEX)
    : null;

  return {
    origin: (origin, cb) => {
      // No Origin header: curl, same-origin, server-to-server.
      if (!origin) return cb(null, true);
      if (exact.includes(origin)) return cb(null, true);
      if (pattern?.test(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: false,
    // PUT is load-bearing: the budgets module uses it, and omitting a verb
    // here fails the browser PREFLIGHT, which surfaces as a bare 'Network
    // Error' with no status — while curl, which sends no preflight, succeeds.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

export function createApp(): Express {
  const app = express();

  // Required behind a reverse proxy, or every client shares one rate-limit
  // bucket and express-rate-limit throws on an unconditional X-Forwarded-For.
  // `1` (a single hop) rather than `true`, which would let a client spoof it.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);
  app.use(globalLimiter);

  // Public.
  app.use('/health', healthRoutes);
  app.get('/', (_req, res) => {
    res.json({ name: 'financial-tracker-api', version: '0.1.0' });
  });

  // Public: login only.
  app.use('/api/v1/auth', authPublicRoutes);

  // Everything else. Guarded by mount order, not by per-route opt-in.
  app.use('/api/v1', requireAuth, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

import 'dotenv/config';
import { z } from 'zod';

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  APP_TIMEZONE: z.string().min(1).default('Asia/Manila'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: boolish.default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(20).default(5),

  JWT_SECRET: z.string().min(1),
  JWT_TTL: z.coerce.number().int().positive().default(604800),

  CORS_ORIGINS: z.string().default(''),
  CORS_ORIGIN_REGEX: z.string().default(''),

  OWNER_EMAIL: z.string().default('owner@localhost'),
  OWNER_NAME: z.string().default('Owner'),
  OWNER_PASSWORD: z.string().default(''),

  RECURRING_CATCHUP_ENABLED: boolish.default(true),
  RECURRING_CATCHUP_MIN_INTERVAL_SEC: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(60),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail at boot with a readable message rather than on request 400.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

// A weak secret in production is a deploy-blocking mistake, not a warning.
if (isProduction) {
  if (env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }
  if (env.JWT_SECRET.startsWith('dev-secret')) {
    throw new Error('JWT_SECRET is still the development placeholder.');
  }
}

export type TEnv = typeof env;

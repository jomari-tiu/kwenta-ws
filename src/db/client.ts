import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

export const sql = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: env.DATABASE_SSL ? 'require' : false,
  // Prepared statements break behind a transaction-mode pooler (pgbouncer,
  // Neon's pooled endpoint) with confusing errors. Negligible cost at this
  // scale, and it removes a whole class of works-locally-fails-in-prod bug.
  prepare: false,
});

export const db = drizzle(sql, { schema, casing: 'snake_case' });

export type TDatabase = typeof db;

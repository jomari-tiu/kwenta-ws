import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../config/env.js';

const client = postgres(env.DATABASE_URL, {
  max: 1,
  ssl: env.DATABASE_SSL ? 'require' : false,
  prepare: false,
});

try {
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  console.log('migrations applied');
} finally {
  await client.end();
}

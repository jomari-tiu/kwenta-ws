import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../config/env.js';

/**
 * Prepare a database on boot: migrate always, seed only when it is untouched.
 *
 * This exists because Render's free tier has no shell, so there is nowhere to
 * run the one-off seed by hand — and without a seeded owner row, login is
 * impossible no matter what password you type.
 *
 * The seed runs ONLY when the users table is empty. Running it on every boot
 * would look harmless (every insert is onConflictDoNothing) but is not: the
 * unique index on categories is PARTIAL, covering unarchived rows only. Archive
 * "Pets" and the next seed no longer conflicts with it, so it inserts a second
 * "Pets". Deciding on an empty users table means it happens exactly once, on a
 * genuinely fresh database.
 */
const client = postgres(env.DATABASE_URL, {
  max: 1,
  ssl: env.DATABASE_SSL ? 'require' : false,
  prepare: false,
});

async function migrateAndCheck(): Promise<boolean> {
  try {
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    console.log('migrations applied');

    // Raw query rather than the schema helper: this runs before the app boots
    // and should depend on as little of it as possible.
    const owner = await client`select 1 from users limit 1`;
    const isFresh = owner.length === 0;
    console.log(
      isFresh
        ? 'no owner found — seeding starter data'
        : 'owner exists — skipping seed',
    );
    return isFresh;
  } finally {
    await client.end();
  }
}

const needsSeed = await migrateAndCheck();

// Imported rather than called: seed.ts runs at module scope and owns its own
// connection. Loading it here is what executes it, and only when needed.
if (needsSeed) {
  await import('./seed.js');
}

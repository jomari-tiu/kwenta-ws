import { bigint, date, timestamp, uuid } from 'drizzle-orm/pg-core';

export const pk = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Money — integer centavos. ₱1.00 === 100. Never a float, never pesos.
 *
 * `bigint` rather than `integer`: integer caps at ₱21,474,836.47, which a
 * lifetime SUM could plausibly reach. `mode: 'number'` is safe because
 * Number.MAX_SAFE_INTEGER is ~₱90 trillion.
 *
 * NOTE: Postgres `sum(bigint)` returns `numeric`, which postgres.js hands back
 * as a STRING. Every aggregate must go through `toCentavos()` in
 * common/money.ts — `"1200" + "800"` is `"1200800"` with no error.
 */
export const centavos = (name: string) => bigint(name, { mode: 'number' });

/**
 * A calendar day — no time, no zone. Always 'YYYY-MM-DD' strings in TS.
 *
 * `mode: 'string'` is mandatory, not stylistic. `mode: 'date'` yields a JS Date
 * at UTC midnight, and the moment anyone writes `.toISOString().slice(0, 10)`
 * the value is off by one — which LOOKS CORRECT in dev (Manila) and is wrong in
 * any UTC runtime. Strings never touch Date, so the bug cannot occur.
 */
export const day = (name: string) => date(name, { mode: 'string' });

import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  accounts,
  budgetOverrides,
  businessMovements,
  businesses,
  categories,
  creditLoans,
  installmentPayments,
  installmentPlans,
  investments,
  recurringRules,
  transactions,
} from '../../db/schema/index.js';

/**
 * Every table EXCEPT `users`, in foreign-key order.
 *
 * Users are deliberately excluded. The row holds an argon2 password hash and a
 * token version; copying those into a portable file spreads a credential around
 * for no benefit, and production sets its own password through `db:seed` from
 * OWNER_PASSWORD. A migration moves the money, not the login.
 *
 * The ORDER IS THE CONTRACT: parents before children, so a straight insert in
 * this sequence never violates a foreign key. transactions comes last but one
 * because it references categories, accounts, rules, payments, loans and funds.
 */
export const TABLES = [
  { key: 'categories', table: categories },
  { key: 'accounts', table: accounts },
  { key: 'businesses', table: businesses },
  { key: 'businessMovements', table: businessMovements },
  { key: 'recurringRules', table: recurringRules },
  { key: 'installmentPlans', table: installmentPlans },
  { key: 'installmentPayments', table: installmentPayments },
  { key: 'creditLoans', table: creditLoans },
  { key: 'investments', table: investments },
  { key: 'transactions', table: transactions },
  { key: 'budgetOverrides', table: budgetOverrides },
] as const;

export type TTableKey = (typeof TABLES)[number]['key'];

export type TDump = Record<TTableKey, Record<string, unknown>[]>;

export async function dumpAll(): Promise<TDump> {
  const out = {} as TDump;
  // Sequential rather than Promise.all: this runs once, by hand, and a stable
  // order makes the file diffable between exports.
  for (const { key, table } of TABLES) {
    out[key] = await db.select().from(table);
  }
  return out;
}

export async function countAll(): Promise<Record<TTableKey, number>> {
  const dump = await dumpAll();
  const counts = {} as Record<TTableKey, number>;
  for (const { key } of TABLES) counts[key] = dump[key].length;
  return counts;
}

/**
 * Tables that only ever hold data the OWNER created.
 *
 * Categories and accounts are excluded on purpose: the seed writes 29 and 8 of
 * them on first boot, so a brand-new server has them before anyone has typed
 * anything. Counting those as "not empty" made mode=empty impossible to satisfy
 * on exactly the deployment it exists to serve — a freshly seeded production
 * database. Untouched has to mean "no ledger of your own", not "zero rows".
 */
const OWNER_DATA_TABLES = [
  'businesses',
  'businessMovements',
  'recurringRules',
  'installmentPlans',
  'installmentPayments',
  'creditLoans',
  'investments',
  'transactions',
  'budgetOverrides',
] as const satisfies readonly TTableKey[];

/** True when nothing the owner created is stored yet. */
export async function isEmpty(): Promise<boolean> {
  const counts = await countAll();
  return OWNER_DATA_TABLES.every((key) => counts[key] === 0);
}

/**
 * A timestamptz round-trips through JSON as an ISO string, and Drizzle needs a
 * Date back. A plain date column is 'YYYY-MM-DD' with no 'T', so matching on
 * the time separator tells the two apart without a per-column list that would
 * silently rot when the schema changes.
 */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function reviveRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && ISO_DATETIME.test(v) ? new Date(v) : v;
  }
  return out;
}

/**
 * Replace everything in one transaction.
 *
 * A failure part-way through must not leave a half-migrated database, so the
 * wipe and every insert share a single transaction — either the whole import
 * lands or none of it does.
 */
export async function replaceAll(
  dump: TDump,
): Promise<Record<TTableKey, number>> {
  const inserted = {} as Record<TTableKey, number>;

  await db.transaction(async (tx) => {
    // `users` is untouched, so the owner stays logged in and keeps their
    // password. CASCADE covers any FK order this list does not.
    await tx.execute(sql`
      truncate table
        transactions,
        installment_payments,
        installment_plans,
        credit_loans,
        investments,
        recurring_rules,
        business_movements,
        businesses,
        budget_overrides,
        categories,
        accounts
      restart identity cascade
    `);

    for (const { key, table } of TABLES) {
      const rows = dump[key] ?? [];
      inserted[key] = rows.length;
      if (rows.length === 0) continue;
      // Chunked: a single insert with thousands of rows can exceed the driver's
      // parameter limit.
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map(reviveRow);
        await tx.insert(table).values(chunk as never);
      }
    }
  });

  return inserted;
}

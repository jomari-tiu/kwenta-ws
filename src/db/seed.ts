import 'dotenv/config';
import argon2 from 'argon2';
import { sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env, isProduction } from '../config/env.js';
import * as schema from './schema/index.js';
import { accounts, categories, users } from './schema/index.js';

type TCategorySeed = {
  name: string;
  kind: 'income' | 'expense';
  icon: string;
  color: string;
  cap?: number;
};

/** Amounts are centavos. ₱12,000 => 1_200_000 */
const EXPENSE_CATEGORIES: TCategorySeed[] = [
  {
    name: 'Food & Groceries',
    kind: 'expense',
    icon: 'shopping-cart',
    color: '#16a34a',
    cap: 1_200_000,
  },
  {
    name: 'Eating Out',
    kind: 'expense',
    icon: 'utensils',
    color: '#f97316',
    cap: 400_000,
  },
  {
    name: 'Transportation',
    kind: 'expense',
    icon: 'car',
    color: '#0ea5e9',
    cap: 400_000,
  },
  {
    name: 'Load & Internet',
    kind: 'expense',
    icon: 'wifi',
    color: '#6366f1',
    cap: 200_000,
  },
  {
    name: 'Utilities',
    kind: 'expense',
    icon: 'zap',
    color: '#eab308',
    cap: 350_000,
  },
  { name: 'Rent', kind: 'expense', icon: 'house', color: '#8b5cf6' },
  {
    name: 'Health & Medicine',
    kind: 'expense',
    icon: 'heart-pulse',
    color: '#ef4444',
    cap: 200_000,
  },
  {
    name: 'Shopping',
    kind: 'expense',
    icon: 'shopping-bag',
    color: '#ec4899',
    cap: 300_000,
  },
  {
    name: 'Personal Care',
    kind: 'expense',
    icon: 'scissors',
    color: '#14b8a6',
    cap: 100_000,
  },
  {
    name: 'Entertainment & Subscriptions',
    kind: 'expense',
    icon: 'tv',
    color: '#a855f7',
    cap: 150_000,
  },
  {
    name: 'Education',
    kind: 'expense',
    icon: 'graduation-cap',
    color: '#3b82f6',
  },
  { name: 'Family Support', kind: 'expense', icon: 'users', color: '#f59e0b' },
  {
    name: 'Insurance & Premiums',
    kind: 'expense',
    icon: 'shield',
    color: '#64748b',
  },
  {
    name: 'Savings & Investments',
    kind: 'expense',
    icon: 'piggy-bank',
    color: '#10b981',
  },
  {
    name: 'Loan & Credit Card Payment',
    kind: 'expense',
    icon: 'credit-card',
    color: '#dc2626',
  },
  { name: 'Installments', kind: 'expense', icon: 'receipt', color: '#b45309' },
  {
    name: 'Church & Donations',
    kind: 'expense',
    icon: 'heart',
    color: '#d946ef',
  },
  { name: 'Pets', kind: 'expense', icon: 'paw-print', color: '#84cc16' },
  {
    name: 'Bank Fees & Charges',
    kind: 'expense',
    icon: 'landmark',
    color: '#78716c',
  },
  {
    name: 'Miscellaneous',
    kind: 'expense',
    icon: 'ellipsis',
    color: '#94a3b8',
  },
];

const INCOME_CATEGORIES: TCategorySeed[] = [
  { name: 'Salary', kind: 'income', icon: 'banknote', color: '#1f8a5b' },
  { name: '13th Month Pay', kind: 'income', icon: 'gift', color: '#059669' },
  {
    name: 'Bonus & Incentives',
    kind: 'income',
    icon: 'trending-up',
    color: '#10b981',
  },
  {
    name: 'Freelance / Sideline',
    kind: 'income',
    icon: 'laptop',
    color: '#0d9488',
  },
  { name: 'Business Income', kind: 'income', icon: 'store', color: '#0891b2' },
  {
    name: 'Interest & Dividends',
    kind: 'income',
    icon: 'chart-line',
    color: '#2563eb',
  },
  {
    name: 'Refunds & Rebates',
    kind: 'income',
    icon: 'undo-2',
    color: '#7c3aed',
  },
  {
    name: 'Gifts Received',
    kind: 'income',
    icon: 'hand-coins',
    color: '#c026d3',
  },
  { name: 'Other Income', kind: 'income', icon: 'plus', color: '#64748b' },
];

type TAccountSeed = {
  name: string;
  kind: 'cash' | 'ewallet' | 'bank' | 'credit_card' | 'savings' | 'other';
  icon: string;
  color: string;
  isDefault?: boolean;
  creditLimitCentavos?: number;
};

const ACCOUNTS: TAccountSeed[] = [
  {
    name: 'Cash',
    kind: 'cash',
    icon: 'wallet',
    color: '#16a34a',
    isDefault: true,
  },
  { name: 'GCash', kind: 'ewallet', icon: 'smartphone', color: '#0ea5e9' },
  { name: 'Maya', kind: 'ewallet', icon: 'smartphone', color: '#10b981' },
  { name: 'BPI Savings', kind: 'bank', icon: 'landmark', color: '#dc2626' },
  { name: 'BDO Savings', kind: 'bank', icon: 'landmark', color: '#2563eb' },
  {
    name: 'Metrobank Payroll',
    kind: 'bank',
    icon: 'landmark',
    color: '#1d4ed8',
  },
  {
    name: 'BPI Credit Card',
    kind: 'credit_card',
    icon: 'credit-card',
    color: '#b91c1c',
    creditLimitCentavos: 5_000_000,
  },
  { name: 'SeaBank', kind: 'savings', icon: 'piggy-bank', color: '#f97316' },
];

const client = postgres(env.DATABASE_URL, {
  max: 1,
  ssl: env.DATABASE_SSL ? 'require' : false,
  prepare: false,
});
const db = drizzle(client, { schema, casing: 'snake_case' });

async function seedOwner(): Promise<void> {
  if (!env.OWNER_PASSWORD) {
    throw new Error('OWNER_PASSWORD is not set — cannot seed the owner.');
  }
  if (isProduction && env.OWNER_PASSWORD === 'change-me-locally') {
    throw new Error(
      'OWNER_PASSWORD is still the placeholder. Refusing to seed.',
    );
  }

  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) {
    console.log(`= owner exists (${existing[0]!.email})`);
    return;
  }

  const passwordHash = await argon2.hash(env.OWNER_PASSWORD, {
    type: argon2.argon2id,
  });
  await db
    .insert(users)
    .values({ email: env.OWNER_EMAIL, name: env.OWNER_NAME, passwordHash });
  console.log(`+ owner created (${env.OWNER_EMAIL})`);
}

async function seedCategories(): Promise<void> {
  const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  let created = 0;

  for (const [i, c] of all.entries()) {
    const rows = await db
      .insert(categories)
      .values({
        name: c.name,
        kind: c.kind,
        icon: c.icon,
        color: c.color,
        monthlyBudgetCentavos: c.cap ?? null,
        sortOrder: i,
      })
      // Matches the partial unique index on (kind, lower(name)).
      .onConflictDoNothing()
      .returning({ id: categories.id });
    if (rows.length > 0) created += 1;
  }
  console.log(
    `  categories: +${created} created, =${all.length - created} existed`,
  );
}

async function seedAccounts(): Promise<void> {
  let created = 0;

  for (const [i, a] of ACCOUNTS.entries()) {
    const rows = await db
      .insert(accounts)
      .values({
        name: a.name,
        kind: a.kind,
        icon: a.icon,
        color: a.color,
        isDefault: a.isDefault ?? false,
        creditLimitCentavos: a.creditLimitCentavos ?? null,
        sortOrder: i,
      })
      .onConflictDoNothing()
      .returning({ id: accounts.id });
    if (rows.length > 0) created += 1;
  }
  console.log(
    `  accounts:   +${created} created, =${ACCOUNTS.length - created} existed`,
  );
}

try {
  await db.execute(dsql`select 1`);
  await seedOwner();
  await seedCategories();
  await seedAccounts();
  console.log('seed complete');
} finally {
  await client.end();
}

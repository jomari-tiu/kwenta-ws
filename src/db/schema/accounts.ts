import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { centavos, createdAt, day, pk, updatedAt } from './_helpers.js';

export const ACCOUNT_KINDS = [
  'cash',
  'ewallet',
  'bank',
  'credit_card',
  'savings',
  'other',
] as const;
export type TAccountKind = (typeof ACCOUNT_KINDS)[number];

export const accounts = pgTable(
  'accounts',
  {
    id: pk(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ACCOUNT_KINDS }).notNull().default('other'),
    icon: text('icon'),
    color: text('color'),
    openingBalanceCentavos: centavos('opening_balance_centavos')
      .notNull()
      .default(0),
    openingBalanceDate: day('opening_balance_date'),
    creditLimitCentavos: centavos('credit_limit_centavos'),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('accounts_name_uq')
      .on(sql`lower(${t.name})`)
      .where(sql`archived_at is null`),
    // At most one default account, guaranteed by the DB.
    uniqueIndex('accounts_single_default_uq')
      .on(t.isDefault)
      .where(sql`is_default`),
    index('accounts_kind_idx').on(t.kind, t.archivedAt),
  ],
);

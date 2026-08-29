import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { centavos, createdAt, pk, updatedAt } from './_helpers.js';

export const CATEGORY_KINDS = ['income', 'expense'] as const;
export type TCategoryKind = (typeof CATEGORY_KINDS)[number];

export const categories = pgTable(
  'categories',
  {
    id: pk(),
    name: text('name').notNull(),
    /** Immutable after creation — flipping it would reclassify every reference. */
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
    /** A lucide icon name from the curated allowlist on the client. */
    icon: text('icon'),
    color: text('color'),
    /** The DEFAULT monthly budget cap. NULL = no cap. Expense-kind only. */
    monthlyBudgetCentavos: centavos('monthly_budget_centavos'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Partial + lower(): no case-variant duplicates per kind, but archiving
    // "Groceries" frees the name for reuse.
    uniqueIndex('categories_kind_name_uq')
      .on(t.kind, sql`lower(${t.name})`)
      .where(sql`archived_at is null`),
    index('categories_kind_idx').on(t.kind, t.archivedAt),
    check(
      'categories_budget_nonneg',
      sql`${t.monthlyBudgetCentavos} is null or ${t.monthlyBudgetCentavos} >= 0`,
    ),
  ],
);

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

export const CATEGORY_SCOPES = ['personal', 'business'] as const;
export type TCategoryScope = (typeof CATEGORY_SCOPES)[number];

export const categories = pgTable(
  'categories',
  {
    id: pk(),
    name: text('name').notNull(),
    /** Immutable after creation — flipping it would reclassify every reference. */
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
    /**
     * Which set of books this category belongs to. Business categories are
     * offered only on business entries, so "Supplier" and "Sales" never clutter
     * the personal chips, and business costs never reach a personal budget.
     *
     * Immutable for exactly the reason `kind` is: flipping it would move every
     * past transaction in this category between the personal and business
     * books, retroactively changing the dashboard for every period.
     */
    scope: text('scope', { enum: CATEGORY_SCOPES })
      .notNull()
      .default('personal'),
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
    //
    // `scope` is part of the key so a business "Rent" can coexist with the
    // personal one. Without it the second insert 409s. Keep
    // categories.repository nameTaken() in step with this.
    uniqueIndex('categories_kind_name_uq')
      .on(t.scope, t.kind, sql`lower(${t.name})`)
      .where(sql`archived_at is null`),
    index('categories_kind_idx').on(t.scope, t.kind, t.archivedAt),
    check(
      'categories_budget_nonneg',
      sql`${t.monthlyBudgetCentavos} is null or ${t.monthlyBudgetCentavos} >= 0`,
    ),
  ],
);

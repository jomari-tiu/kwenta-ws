import { sql } from 'drizzle-orm';
import { check, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { centavos, createdAt, day, pk, updatedAt } from './_helpers.js';
import { categories } from './categories.js';

/**
 * Per-month override of a category's default cap.
 *
 * effectiveCap = coalesce(override.capCentavos, categories.monthlyBudgetCentavos)
 *
 * Carry-forward is free: the ABSENCE of an override means "use the default", so
 * there is no backfill and no per-month row explosion.
 */
export const budgetOverrides = pgTable(
  'budget_overrides',
  {
    id: pk(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** Always the 1st of the month. */
    month: day('month').notNull(),
    capCentavos: centavos('cap_centavos').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('budget_overrides_category_month_uq').on(t.categoryId, t.month),
    check(
      'budget_overrides_month_is_first',
      sql`date_trunc('month', ${t.month})::date = ${t.month}`,
    ),
    check('budget_overrides_cap_nonneg', sql`${t.capCentavos} >= 0`),
  ],
);

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { centavos, createdAt, day, pk, updatedAt } from './_helpers.js';
import { accounts } from './accounts.js';
import { categories } from './categories.js';

export const RECURRING_FREQUENCIES = [
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
] as const;
export type TRecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** Recurring rules are income or expense only — never a transfer. */
export const RECURRING_TYPES = ['income', 'expense'] as const;
export type TRecurringType = (typeof RECURRING_TYPES)[number];

export const recurringRules = pgTable(
  'recurring_rules',
  {
    id: pk(),
    name: text('name').notNull(),
    type: text('type', { enum: RECURRING_TYPES }).notNull(),
    amountCentavos: centavos('amount_centavos').notNull(),
    frequency: text('frequency', { enum: RECURRING_FREQUENCIES }).notNull(),
    interval: integer('interval').notNull().default(1),
    /** ISO day of week: Monday = 1 … Sunday = 7. Never Postgres `dow`. */
    dayOfWeek: integer('day_of_week'),
    dayOfMonth: integer('day_of_month'),
    monthOfYear: integer('month_of_year'),
    startDate: day('start_date').notNull(),
    /** NULL = forever. Inclusive when set. */
    endDate: day('end_date'),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    note: text('note'),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Cursor optimization ONLY. Correctness comes from the unique index on
     * (recurringRuleId, occurrenceDate). A stale cursor costs extra work, never
     * duplicate rows. Never move it backwards — that resurrects deleted rows.
     */
    lastMaterializedDate: day('last_materialized_date'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Soft-deleted so generated transactions keep their provenance. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('recurring_rules_active_idx').on(t.isActive, t.startDate),
    check('recurring_rules_amount_positive', sql`${t.amountCentavos} > 0`),
    check(
      'recurring_rules_end_after_start',
      sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
    check(
      'recurring_rules_dow_range',
      sql`${t.dayOfWeek} is null or ${t.dayOfWeek} between 1 and 7`,
    ),
    check(
      'recurring_rules_dom_range',
      sql`${t.dayOfMonth} is null or ${t.dayOfMonth} between 1 and 31`,
    ),
    check(
      'recurring_rules_moy_range',
      sql`${t.monthOfYear} is null or ${t.monthOfYear} between 1 and 12`,
    ),
    check('recurring_rules_interval_positive', sql`${t.interval} >= 1`),
    // Mirrors the Zod discriminated union so a bad row cannot exist even via
    // db:studio or a psql session.
    check(
      'recurring_rules_shape',
      sql`case ${t.frequency}
            when 'weekly'   then ${t.dayOfWeek} is not null
            when 'biweekly' then ${t.dayOfWeek} is not null
            when 'monthly'  then ${t.dayOfMonth} is not null
            when 'yearly'   then ${t.dayOfMonth} is not null and ${t.monthOfYear} is not null
          end`,
    ),
  ],
);

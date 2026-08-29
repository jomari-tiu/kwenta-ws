import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { centavos, createdAt, day, pk, updatedAt } from './_helpers.js';
import { accounts } from './accounts.js';
import { categories } from './categories.js';

export const installmentPlans = pgTable(
  'installment_plans',
  {
    id: pk(),
    name: text('name').notNull(),
    merchant: text('merchant'),
    /** What will actually be paid in total, interest included. */
    totalCentavos: centavos('total_centavos').notNull(),
    termMonths: integer('term_months').notNull(),
    startDate: day('start_date').notNull(),
    dayOfMonth: integer('day_of_month').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('installment_plans_start_idx').on(t.startDate),
    check('installment_plans_total_positive', sql`${t.totalCentavos} > 0`),
    check(
      'installment_plans_term_range',
      sql`${t.termMonths} between 1 and 120`,
    ),
    check('installment_plans_dom_range', sql`${t.dayOfMonth} between 1 and 31`),
  ],
);

export const INSTALLMENT_PAYMENT_STATUSES = ['pending', 'paid'] as const;
export type TInstallmentPaymentStatus =
  (typeof INSTALLMENT_PAYMENT_STATUSES)[number];

/**
 * `overdue` is NEVER stored. It goes stale at midnight, and keeping it fresh
 * would need the cron we've established is unreliable. It is derived in SQL
 * against todayInAppTz() so the server and client always agree.
 */
export const installmentPayments = pgTable(
  'installment_payments',
  {
    id: pk(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => installmentPlans.id, { onDelete: 'cascade' }),
    sequenceNo: integer('sequence_no').notNull(),
    dueDate: day('due_date').notNull(),
    amountCentavos: centavos('amount_centavos').notNull(),
    status: text('status', { enum: INSTALLMENT_PAYMENT_STATUSES })
      .notNull()
      .default('pending'),
    paidDate: day('paid_date'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('installment_payments_plan_seq_uq').on(t.planId, t.sequenceNo),
    index('installment_payments_due_status_idx').on(t.dueDate, t.status),
    index('installment_payments_plan_idx').on(t.planId),
    check('installment_payments_amount_positive', sql`${t.amountCentavos} > 0`),
    check(
      'installment_payments_paid_requires_date',
      sql`(${t.status} = 'pending' and ${t.paidDate} is null)
       or (${t.status} = 'paid' and ${t.paidDate} is not null)`,
    ),
  ],
);

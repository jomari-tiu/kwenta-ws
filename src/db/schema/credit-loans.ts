import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { centavos, createdAt, day, pk, updatedAt } from './_helpers.js';
import { accounts } from './accounts.js';
import { categories } from './categories.js';

/**
 * Money borrowed, with NO fixed schedule.
 *
 * This is the deliberate contrast with `installment_plans`: an installment is a
 * fixed term that generates N dated payments up front, whereas a credit loan is
 * "I owe this, I'll pay it down as I can". So:
 *
 *   - `dueDate` is NULLABLE. A loan with no agreed date is normal, and the app
 *     must never invent one.
 *   - There is no payments table. Every repayment is an ordinary expense
 *     transaction tagged with `credit_loan_id`, so the outstanding balance is
 *     principal − sum(those transactions). One source of truth, and repayments
 *     show up in the ledger and on the calendar like any other spending.
 */
export const creditLoans = pgTable(
  'credit_loans',
  {
    id: pk(),
    name: text('name').notNull(),
    /** Who it's owed to — a bank, an app, a person. */
    lender: text('lender'),
    principalCentavos: centavos('principal_centavos').notNull(),
    /**
     * OPTIONAL. Null means "no agreed date"; the UI shows "no due date" rather
     * than guessing, and such a loan can never be overdue.
     */
    dueDate: day('due_date'),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    /** Where repayments come from by default. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    note: text('note'),
    /** Set when the owner closes it early; otherwise settlement is derived. */
    closedAt: day('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('credit_loans_due_idx').on(t.dueDate),
    check('credit_loans_principal_positive', sql`${t.principalCentavos} > 0`),
  ],
);

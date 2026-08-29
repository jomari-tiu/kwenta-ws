import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { centavos, createdAt, day, pk, updatedAt } from './_helpers.js';
import { accounts } from './accounts.js';
import { categories } from './categories.js';
import { installmentPayments } from './installments.js';
import { creditLoans } from './credit-loans.js';
import { investments } from './investments.js';
import { recurringRules } from './recurring.js';

/**
 * 'transfer' is RESERVED, not implemented. Reserving the enum value now makes
 * adding transfers later a code change rather than a migration. Until then the
 * README documents the convention: log credit-card purchases as expenses on the
 * card account and never log the bill payment, or a ₱3,000 purchase counts as
 * ₱6,000 spent.
 */
export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;
export type TTransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_SOURCES = [
  'manual',
  'recurring',
  'installment',
] as const;
export type TTransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const transactions = pgTable(
  'transactions',
  {
    id: pk(),
    type: text('type', { enum: TRANSACTION_TYPES }).notNull(),
    /** ALWAYS positive. The sign is implied by `type`. */
    amountCentavos: centavos('amount_centavos').notNull(),
    txnDate: day('txn_date').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    note: text('note'),
    source: text('source', { enum: TRANSACTION_SOURCES })
      .notNull()
      .default('manual'),
    recurringRuleId: uuid('recurring_rule_id').references(
      () => recurringRules.id,
      { onDelete: 'set null' },
    ),
    /**
     * The immutable schedule slot this row satisfies — the idempotency key.
     * Kept separate from txnDate so the date can be edited without breaking
     * dedupe.
     */
    occurrenceDate: day('occurrence_date'),
    /**
     * The only FK between transactions and installment payments. A mirror
     * column on installment_payments would be a cycle: drizzle-kit can emit the
     * two CREATE TABLEs in an unrunnable order, and the same 1:1 fact would live
     * in two places.
     */
    installmentPaymentId: uuid('installment_payment_id').references(
      () => installmentPayments.id,
      { onDelete: 'set null' },
    ),
    /**
     * Set when this expense is a repayment against a credit loan. The loan's
     * outstanding balance is derived by summing these, so there is no separate
     * payments table to drift out of sync.
     */
    creditLoanId: uuid('credit_loan_id').references(() => creditLoans.id, {
      onDelete: 'set null',
    }),
    /**
     * Set when this row moves money into or out of an investment. An EXPENSE so
     * tagged is a contribution, an INCOME so tagged is a withdrawal, and the
     * fund's balance is the difference — so there is no contributions table to
     * drift out of sync.
     */
    investmentId: uuid('investment_id').references(() => investments.id, {
      onDelete: 'set null',
    }),
    /** Set when a generated row is hand-edited; protects it from bulk updates. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('transactions_date_idx').on(t.txnDate),
    index('transactions_type_date_idx').on(t.type, t.txnDate),
    index('transactions_category_date_idx').on(t.categoryId, t.txnDate),
    index('transactions_account_date_idx').on(t.accountId, t.txnDate),
    index('transactions_credit_loan_idx').on(t.creditLoanId),
    index('transactions_investment_idx').on(t.investmentId),
    // Deliberately NOT partial. Postgres treats NULLs as distinct by default,
    // so the many manual rows with (null, null) never collide — and a plain
    // unique index lets ON CONFLICT (recurring_rule_id, occurrence_date) work
    // without restating an index predicate.
    uniqueIndex('transactions_rule_occurrence_uq').on(
      t.recurringRuleId,
      t.occurrenceDate,
    ),
    uniqueIndex('transactions_installment_payment_uq').on(
      t.installmentPaymentId,
    ),
    check('transactions_amount_positive', sql`${t.amountCentavos} > 0`),
  ],
);

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { centavos, createdAt, day, pk, updatedAt } from './_helpers.js';
import { accounts } from './accounts.js';
import { categories } from './categories.js';

export const INVESTMENT_KINDS = [
  'fund',
  'stocks',
  'crypto',
  'time_deposit',
  'savings_goal',
  'insurance',
  'other',
] as const;
export type TInvestmentKind = (typeof INVESTMENT_KINDS)[number];

/**
 * A pot you put money into — a mutual fund, a stock account, an emergency fund,
 * a time deposit.
 *
 * The mirror image of `credit_loans`, and built the same way: there is NO
 * contributions table. Every contribution is an ordinary EXPENSE transaction
 * tagged `investment_id`, and every withdrawal an ordinary INCOME transaction
 * tagged the same way, so:
 *
 *     netContributed = sum(tagged expenses) − sum(tagged income)
 *
 * One source of truth, contributions show up in the ledger and on the calendar
 * like any other money movement, and deleting a contribution can never leave a
 * stale stored balance behind.
 *
 * Three fields are nullable on purpose, because the two things people mean by
 * "investment" want different ones and neither should be faked:
 *
 *   - `targetCentavos` — a savings GOAL ("₱100,000 emergency fund"). Null means
 *     "just accumulate", and progress is simply not shown.
 *   - `targetDate` — when you want to hit it. Null is normal. Note this is a
 *     goal, NOT a debt: it appears on the calendar but never reddens a day.
 *   - `currentValueCentavos` — what it is worth TODAY, entered by hand, for
 *     things that fluctuate. Null means "not valued", and the app then shows
 *     what you put in rather than inventing a return. The app deliberately does
 *     not fetch prices or model returns.
 */
export const investments = pgTable(
  'investments',
  {
    id: pk(),
    name: text('name').notNull(),
    /** Where it is held — COL Financial, BPI, Binance, GInvest. */
    provider: text('provider'),
    kind: text('kind', { enum: INVESTMENT_KINDS }).notNull().default('fund'),
    /** OPTIONAL goal. Null means there is no target to be short of. */
    targetCentavos: centavos('target_centavos'),
    /** OPTIONAL. A goal date, never an overdue date. */
    targetDate: day('target_date'),
    /** OPTIONAL hand-entered valuation. Null means "not valued". */
    currentValueCentavos: centavos('current_value_centavos'),
    /** When the valuation above was taken — so a stale figure is visibly stale. */
    valueAsOf: day('value_as_of'),
    /** Expense category used for contributions. */
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    /** Where contributions come from by default. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    note: text('note'),
    /** Set when the owner closes it out; otherwise "funded" is derived. */
    closedAt: day('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('investments_target_date_idx').on(t.targetDate),
    // A CHECK that evaluates to NULL passes, so these constrain the value only
    // when one was given — exactly what "optional, but positive if set" means.
    check('investments_target_positive', sql`${t.targetCentavos} > 0`),
    check(
      'investments_current_value_not_negative',
      sql`${t.currentValueCentavos} >= 0`,
    ),
  ],
);

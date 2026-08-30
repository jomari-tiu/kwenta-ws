import { sql } from 'drizzle-orm';
import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, day, pk, updatedAt } from './_helpers.js';
import { accounts } from './accounts.js';

/**
 * A business I run. Its books live in the same ledger as everything else — a
 * business row is an ordinary transaction tagged with `businessId`, exactly as
 * a fund contribution is one tagged with `investmentId`. There is no separate
 * set of books to drift out of sync.
 *
 * The dedicated account is the load-bearing part of the design. Money put INTO
 * the business and money drawn OUT of it are ordinary TRANSFERS between a
 * personal account and this one. Recording them as expense/income instead would
 * corrupt every balance: accounts.repository subtracts every expense from its
 * account unconditionally, so "capital in" would destroy ₱50,000 that never
 * left the bank. On a shared account those moves are a relabelling of a pot,
 * not a movement of cash — and the transfer shape CHECK already says so, by
 * refusing a transfer whose source and destination are the same account.
 *
 * It also makes the P&L FALSIFIABLE: net cash derived from the tagged rows must
 * equal this account's derived balance. A gap is a mis-tagged row, surfaced
 * continuously, instead of a number no screen can ever contradict.
 */
export const businesses = pgTable(
  'businesses',
  {
    id: pk(),
    name: text('name').notNull(),
    note: text('note'),
    /**
     * The business's OWN account, when it has one. OPTIONAL, because plenty of
     * small businesses are genuinely run out of a personal wallet and forcing a
     * separate account there would be a lie dressed as rigour.
     *
     * With an account: capital and drawings are real transfers, and the books
     * are checkable against the balance (see above).
     * Without one: only revenue and costs are tracked, recorded against
     * whichever account actually paid. Capital and drawings are not offered,
     * because moving money from a pocket to itself is not a movement.
     */
    accountId: uuid('account_id').references(() => accounts.id, {
      onDelete: 'restrict',
    }),
    startedOn: day('started_on'),
    /** Set when the business is wound up. Closed ones drop out of lists. */
    closedAt: day('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Partial, like categories and accounts: closing a business frees its name.
    uniqueIndex('businesses_name_uq')
      .on(sql`lower(${t.name})`)
      .where(sql`closed_at is null`),
    // One account belongs to at most one business. This is what turns "is this
    // a business account?" into a lookup rather than a guess, and it is what
    // keeps business cash out of the dashboard's disposable money.
    //
    // Postgres treats NULLs as distinct, so any number of businesses can share
    // "no dedicated account" without colliding here.
    uniqueIndex('businesses_account_uq').on(t.accountId),
  ],
);

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { uuid } from 'drizzle-orm/pg-core';
import { centavos, createdAt, day, pk, updatedAt } from './_helpers.js';
import { businesses } from './businesses.js';

export const MOVEMENT_KINDS = ['capital', 'drawing'] as const;
export type TMovementKind = (typeof MOVEMENT_KINDS)[number];

/**
 * Capital put in, or a drawing taken out, WHEN NO MONEY ACTUALLY MOVES between
 * accounts — the ordinary case when a business is run out of a personal wallet.
 *
 * Saying "₱4,000 of my GoTyme is the shop's puhunan" is a real and useful fact,
 * but it is an earmark, not a movement: the peso never left GoTyme. It
 * therefore cannot be a transaction. Recording it as one would either move a
 * balance that did not move (an expense/income row) or be rejected outright
 * (a transfer needs two different accounts).
 *
 * So it lives here, deliberately OUTSIDE the ledger: it changes no account
 * balance, appears in no income or spending total, and exists only to make the
 * business's own books read correctly.
 *
 * Cross-account capital and drawings are NOT stored here — those are real
 * transfers, tagged with `businessId` like every other business row.
 */
export const businessMovements = pgTable(
  'business_movements',
  {
    id: pk(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: MOVEMENT_KINDS }).notNull(),
    amountCentavos: centavos('amount_centavos').notNull(),
    movedOn: day('moved_on').notNull(),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('business_movements_business_idx').on(t.businessId, t.movedOn),
    check('business_movements_amount_positive', sql`${t.amountCentavos} > 0`),
  ],
);

import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_helpers.js';

/**
 * Exactly one row, enforced by the DB via the `singleton` unique index.
 *
 * A table rather than env-only so the owner can change their password without a
 * redeploy, and so `tokenVersion` gives real revocation.
 */
export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name').notNull().default('Owner'),
    passwordHash: text('password_hash').notNull(),
    /** Bump to invalidate every outstanding JWT. */
    tokenVersion: integer('token_version').notNull().default(0),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    singleton: boolean('singleton').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_singleton_uq').on(t.singleton),
  ],
);

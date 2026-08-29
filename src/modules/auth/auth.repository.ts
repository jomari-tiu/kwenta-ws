import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema/index.js';

export type TUserRow = typeof users.$inferSelect;

export async function findOwner(): Promise<TUserRow | undefined> {
  const rows = await db.select().from(users).limit(1);
  return rows[0];
}

export async function findUserById(id: string): Promise<TUserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function touchLastLogin(id: string): Promise<void> {
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, id));
}

/** Sets a new hash and bumps tokenVersion, invalidating every existing JWT. */
export async function updatePasswordAndRevoke(
  id: string,
  passwordHash: string,
): Promise<void> {
  await db
    .update(users)
    .set({
      passwordHash,
      tokenVersion: sql`${users.tokenVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
}

export async function bumpTokenVersion(id: string): Promise<void> {
  await db
    .update(users)
    .set({
      tokenVersion: sql`${users.tokenVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
}

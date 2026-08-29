import { and, asc, count, eq, ilike, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { toCentavos } from '../../common/money.js';
import {
  accounts,
  installmentPlans,
  recurringRules,
  transactions,
} from '../../db/schema/index.js';
import type { TAccountKind } from '../../db/schema/index.js';

export type TAccountRow = typeof accounts.$inferSelect;
export type TAccountInsert = typeof accounts.$inferInsert;

export type TListAccountsArgs = {
  kind?: TAccountKind;
  search?: string;
  includeArchived: boolean;
  limit: number;
  offset: number;
};

function listWhere({ kind, search, includeArchived }: TListAccountsArgs) {
  return and(
    includeArchived ? undefined : isNull(accounts.archivedAt),
    kind ? eq(accounts.kind, kind) : undefined,
    search ? ilike(accounts.name, `%${search}%`) : undefined,
  );
}

export async function listAccounts(
  args: TListAccountsArgs,
): Promise<{ rows: TAccountRow[]; total: number }> {
  const where = listWhere(args);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(where)
      .orderBy(asc(accounts.sortOrder), asc(accounts.name))
      .limit(args.limit)
      .offset(args.offset),
    db.select({ value: count() }).from(accounts).where(where),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

/**
 * Derived balance per account: opening + income − expense.
 *
 * Grouped over transactions only, so accounts with no activity are absent from
 * the map and the service falls back to the opening balance. Transfers are
 * excluded because the type is reserved but unimplemented — when it lands, it
 * must be added here with both legs.
 */
export async function sumMovementByAccount(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountId: transactions.accountId,
      net: sql<string>`
        coalesce(sum(${transactions.amountCentavos})
          filter (where ${transactions.type} = 'income'), 0)
        - coalesce(sum(${transactions.amountCentavos})
          filter (where ${transactions.type} = 'expense'), 0)
      `,
    })
    .from(transactions)
    .groupBy(transactions.accountId);

  return new Map(rows.map((r) => [r.accountId, toCentavos(r.net)]));
}

export async function findAccountById(
  id: string,
): Promise<TAccountRow | undefined> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  return rows[0];
}

export async function findWritableAccount(
  id: string,
): Promise<TAccountRow | undefined> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), isNull(accounts.archivedAt)))
    .limit(1);
  return rows[0];
}

export async function insertAccount(
  values: TAccountInsert,
): Promise<TAccountRow> {
  return db.transaction(async (tx) => {
    if (values.isDefault) {
      await tx.update(accounts).set({ isDefault: false });
    }
    const rows = await tx.insert(accounts).values(values).returning();
    return rows[0]!;
  });
}

export async function updateAccount(
  id: string,
  values: Partial<TAccountInsert>,
): Promise<TAccountRow | undefined> {
  return db.transaction(async (tx) => {
    // The DB enforces at-most-one default; clear the old one first so the
    // unique index never sees two.
    if (values.isDefault) {
      await tx.update(accounts).set({ isDefault: false });
    }
    const rows = await tx
      .update(accounts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(accounts.id, id))
      .returning();
    return rows[0];
  });
}

export async function countAccountReferences(id: string): Promise<number> {
  const [txns, rules, plans] = await Promise.all([
    db
      .select({ value: count() })
      .from(transactions)
      .where(eq(transactions.accountId, id)),
    db
      .select({ value: count() })
      .from(recurringRules)
      .where(eq(recurringRules.accountId, id)),
    db
      .select({ value: count() })
      .from(installmentPlans)
      .where(eq(installmentPlans.accountId, id)),
  ]);
  return (
    (txns[0]?.value ?? 0) + (rules[0]?.value ?? 0) + (plans[0]?.value ?? 0)
  );
}

export async function archiveAccount(id: string): Promise<void> {
  await db
    .update(accounts)
    .set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() })
    .where(eq(accounts.id, id));
}

export async function restoreAccount(
  id: string,
): Promise<TAccountRow | undefined> {
  const rows = await db
    .update(accounts)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(accounts.id, id))
    .returning();
  return rows[0];
}

export async function deleteAccount(id: string): Promise<void> {
  await db.delete(accounts).where(eq(accounts.id, id));
}

export async function nameTaken(
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        sql`lower(${accounts.name}) = lower(${name})`,
        isNull(accounts.archivedAt),
        exceptId ? sql`${accounts.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { TPlainDate } from '../../common/date.js';
import { toCentavos } from '../../common/money.js';
import {
  businessMovements,
  businesses,
  transactions,
} from '../../db/schema/index.js';
import type { TMovementKind } from '../../db/schema/index.js';

export type TBusinessRow = typeof businesses.$inferSelect;
export type TBusinessInsert = typeof businesses.$inferInsert;

export async function listBusinesses(
  includeClosed: boolean,
  limit: number,
  offset: number,
): Promise<{ rows: TBusinessRow[]; total: number }> {
  const where = includeClosed ? undefined : isNull(businesses.closedAt);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(businesses)
      .where(where)
      .orderBy(asc(businesses.name))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(businesses).where(where),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

export async function findBusinessById(
  id: string,
): Promise<TBusinessRow | undefined> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, id))
    .limit(1);
  return rows[0];
}

export async function nameTaken(
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        sql`lower(${businesses.name}) = lower(${name})`,
        isNull(businesses.closedAt),
        exceptId ? sql`${businesses.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** The accounts owned by a business — what the dashboard subtracts from disposable. */
export async function businessAccountIds(): Promise<string[]> {
  const rows = await db.select({ id: businesses.accountId }).from(businesses);
  // Businesses run out of a personal wallet have no account of their own, and
  // must not drag that wallet out of the dashboard's disposable money.
  return rows.map((r) => r.id).filter((id): id is string => id !== null);
}

export type TBusinessFlows = {
  revenue: number;
  cost: number;
  capital: number;
  drawing: number;
};

/**
 * The four flows per business, straight from the ledger — no stored balance to
 * drift out of sync, exactly as loans and funds work.
 *
 * Capital and drawings are TRANSFERS, so direction is what separates them:
 * money landing in the business account is capital, money leaving it is a
 * drawing. Joining `businesses` is how the query knows which account that is.
 */
export async function flowsByBusiness(): Promise<Map<string, TBusinessFlows>> {
  const rows = await db
    .select({
      businessId: transactions.businessId,
      revenue: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income'), 0)`,
      cost: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense'), 0)`,
      capital: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'transfer' and ${transactions.transferAccountId} = ${businesses.accountId}), 0)`,
      drawing: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'transfer' and ${transactions.accountId} = ${businesses.accountId}), 0)`,
    })
    .from(transactions)
    .innerJoin(businesses, eq(transactions.businessId, businesses.id))
    .groupBy(transactions.businessId);

  return new Map(
    rows
      .filter((r): r is typeof r & { businessId: string } =>
        Boolean(r.businessId),
      )
      .map((r) => [
        r.businessId,
        {
          revenue: toCentavos(r.revenue),
          cost: toCentavos(r.cost),
          capital: toCentavos(r.capital),
          drawing: toCentavos(r.drawing),
        },
      ]),
  );
}

/**
 * Earmarked capital and drawings — the ones where no money moved between
 * accounts. Summed separately from the transfer-based ones and added to the
 * same totals, because to the owner they are the same fact.
 */
export async function earmarksByBusiness(): Promise<
  Map<string, { capital: number; drawing: number }>
> {
  const rows = await db
    .select({
      businessId: businessMovements.businessId,
      capital: sql<string>`coalesce(sum(${businessMovements.amountCentavos}) filter (where ${businessMovements.kind} = 'capital'), 0)`,
      drawing: sql<string>`coalesce(sum(${businessMovements.amountCentavos}) filter (where ${businessMovements.kind} = 'drawing'), 0)`,
    })
    .from(businessMovements)
    .groupBy(businessMovements.businessId);

  return new Map(
    rows.map((r) => [
      r.businessId,
      { capital: toCentavos(r.capital), drawing: toCentavos(r.drawing) },
    ]),
  );
}

export async function insertEarmark(args: {
  businessId: string;
  kind: TMovementKind;
  amountCentavos: number;
  movedOn: TPlainDate;
  note: string | null;
}): Promise<{ id: string }> {
  const rows = await db
    .insert(businessMovements)
    .values(args)
    .returning({ id: businessMovements.id });
  return { id: rows[0]!.id };
}

export type TEarmarkRow = {
  id: string;
  kind: TMovementKind;
  amountCentavos: number;
  movedOn: string;
  note: string | null;
};

export async function listEarmarks(businessId: string): Promise<TEarmarkRow[]> {
  return db
    .select({
      id: businessMovements.id,
      kind: businessMovements.kind,
      amountCentavos: businessMovements.amountCentavos,
      movedOn: businessMovements.movedOn,
      note: businessMovements.note,
    })
    .from(businessMovements)
    .where(eq(businessMovements.businessId, businessId))
    .orderBy(desc(businessMovements.movedOn));
}

/** Ownership-checked, exactly like deleteEntry: the id comes from the URL. */
export async function deleteEarmark(
  businessId: string,
  movementId: string,
): Promise<boolean> {
  const rows = await db
    .delete(businessMovements)
    .where(
      and(
        eq(businessMovements.id, movementId),
        eq(businessMovements.businessId, businessId),
      ),
    )
    .returning({ id: businessMovements.id });
  return rows.length > 0;
}

export async function insertBusiness(
  values: TBusinessInsert,
): Promise<TBusinessRow> {
  const rows = await db.insert(businesses).values(values).returning();
  return rows[0]!;
}

export async function updateBusiness(
  id: string,
  values: Partial<TBusinessInsert>,
): Promise<TBusinessRow | undefined> {
  const rows = await db
    .update(businesses)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(businesses.id, id))
    .returning();
  return rows[0];
}

/**
 * Delete a business. Its transactions SURVIVE with a null FK — that money
 * really did move, exactly as with credit loans, funds and installment plans.
 * Deleting them would corrupt every account balance they touched.
 */
export async function deleteBusiness(
  id: string,
): Promise<{ keptTransactionCount: number }> {
  return db.transaction(async (tx) => {
    const kept = await tx
      .select({ value: count() })
      .from(transactions)
      .where(eq(transactions.businessId, id));
    await tx.delete(businesses).where(eq(businesses.id, id));
    return { keptTransactionCount: kept[0]?.value ?? 0 };
  });
}

/** Revenue (income) or a cost (expense), always on the business's own account. */
export async function insertEntry(args: {
  businessId: string;
  type: 'income' | 'expense';
  amountCentavos: number;
  txnDate: TPlainDate;
  categoryId: string;
  accountId: string;
  note: string | null;
}): Promise<{ transactionId: string }> {
  const rows = await db
    .insert(transactions)
    .values({
      type: args.type,
      amountCentavos: args.amountCentavos,
      txnDate: args.txnDate,
      categoryId: args.categoryId,
      accountId: args.accountId,
      note: args.note,
      source: 'manual',
      businessId: args.businessId,
    })
    .returning({ id: transactions.id });
  return { transactionId: rows[0]!.id };
}

/**
 * Capital in or a drawing out — a transfer between a personal account and the
 * business account. `categoryId` stays null, which the transfer shape CHECK
 * requires and which is also simply correct: neither is income or spending.
 */
export async function insertMovement(args: {
  businessId: string;
  fromAccountId: string;
  toAccountId: string;
  amountCentavos: number;
  txnDate: TPlainDate;
  note: string | null;
}): Promise<{ transactionId: string }> {
  const rows = await db
    .insert(transactions)
    .values({
      type: 'transfer',
      amountCentavos: args.amountCentavos,
      txnDate: args.txnDate,
      categoryId: null,
      accountId: args.fromAccountId,
      transferAccountId: args.toAccountId,
      note: args.note,
      source: 'manual',
      businessId: args.businessId,
    })
    .returning({ id: transactions.id });
  return { transactionId: rows[0]!.id };
}

export type TBusinessEntryRow = {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amountCentavos: number;
  txnDate: string;
  note: string | null;
  categoryName: string | null;
  accountId: string;
  transferAccountId: string | null;
};

export async function listEntries(
  businessId: string,
): Promise<TBusinessEntryRow[]> {
  return db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountCentavos: transactions.amountCentavos,
      txnDate: transactions.txnDate,
      note: transactions.note,
      categoryName: sql<string | null>`(
        select c.name from categories c where c.id = ${transactions.categoryId}
      )`,
      accountId: transactions.accountId,
      transferAccountId: transactions.transferAccountId,
    })
    .from(transactions)
    .where(eq(transactions.businessId, businessId))
    .orderBy(desc(transactions.txnDate), desc(transactions.createdAt));
}

/**
 * Delete one entry, but ONLY if it belongs to this business — the transaction
 * id comes from the URL, so without the ownership check any row in the ledger
 * could be deleted through this route.
 */
export async function deleteEntry(
  businessId: string,
  transactionId: string,
): Promise<boolean> {
  const rows = await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.businessId, businessId),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length > 0;
}

import { and, asc, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { TPlainDate } from '../../common/date.js';
import { recurringRules, transactions } from '../../db/schema/index.js';

export type TRuleRow = typeof recurringRules.$inferSelect;
export type TRuleInsert = typeof recurringRules.$inferInsert;

export async function listRules(
  args: { isActive?: boolean; type?: 'income' | 'expense' },
  limit: number,
  offset: number,
): Promise<{ rows: TRuleRow[]; total: number }> {
  const where = and(
    isNull(recurringRules.deletedAt),
    args.isActive === undefined
      ? undefined
      : eq(recurringRules.isActive, args.isActive),
    args.type ? eq(recurringRules.type, args.type) : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(recurringRules)
      .where(where)
      .orderBy(desc(recurringRules.isActive), asc(recurringRules.name))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(recurringRules).where(where),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

export async function findRuleById(id: string): Promise<TRuleRow | undefined> {
  const rows = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.id, id), isNull(recurringRules.deletedAt)))
    .limit(1);
  return rows[0];
}

/** Active, undeleted rules — the materializer's work list. */
export async function listMaterializable(): Promise<TRuleRow[]> {
  return db
    .select()
    .from(recurringRules)
    .where(
      and(eq(recurringRules.isActive, true), isNull(recurringRules.deletedAt)),
    );
}

export async function insertRule(values: TRuleInsert): Promise<TRuleRow> {
  const rows = await db.insert(recurringRules).values(values).returning();
  return rows[0]!;
}

export async function updateRule(
  id: string,
  values: Partial<TRuleInsert>,
): Promise<TRuleRow | undefined> {
  const rows = await db
    .update(recurringRules)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(recurringRules.id, id))
    .returning();
  return rows[0];
}

export async function softDeleteRule(id: string): Promise<void> {
  await db
    .update(recurringRules)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(eq(recurringRules.id, id));
}

/**
 * Insert occurrences idempotently.
 *
 * Correctness comes from the unique index on
 * (recurring_rule_id, occurrence_date) — NOT from lastMaterializedDate, which
 * is only a cursor optimisation. Running this twice inserts nothing the second
 * time. Because the index is non-partial and Postgres treats NULLs as distinct,
 * this is a plain ON CONFLICT with no index predicate to restate.
 */
export async function insertOccurrences(
  rule: TRuleRow,
  dates: TPlainDate[],
): Promise<number> {
  if (dates.length === 0) return 0;

  const inserted = await db
    .insert(transactions)
    .values(
      dates.map((d) => ({
        type: rule.type,
        amountCentavos: rule.amountCentavos,
        txnDate: d,
        categoryId: rule.categoryId,
        accountId: rule.accountId,
        // Carried through, or a business's shop rent materializes untagged and
        // drops out of its books every single month.
        businessId: rule.businessId,
        note: rule.note,
        source: 'recurring' as const,
        recurringRuleId: rule.id,
        occurrenceDate: d,
      })),
    )
    .onConflictDoNothing({
      target: [transactions.recurringRuleId, transactions.occurrenceDate],
    })
    .returning({ id: transactions.id });

  return inserted.length;
}

/** `null` rewinds the cursor so catch-up recomputes from the rule's start. */
export async function setLastMaterialized(
  id: string,
  date: TPlainDate | null,
): Promise<void> {
  await db
    .update(recurringRules)
    .set({ lastMaterializedDate: date, updatedAt: new Date() })
    .where(eq(recurringRules.id, id));
}

/**
 * Update already-materialized rows for a rule, SKIPPING any that were
 * hand-edited. That's what transactions.editedAt buys: a one-off "rent was
 * PHP 500 more that month" survives a bulk rule update.
 */
export async function applyRuleToExisting(
  ruleId: string,
  values: {
    amountCentavos?: number;
    categoryId?: string;
    accountId?: string;
    note?: string | null;
  },
  onlyFutureFrom?: TPlainDate,
): Promise<number> {
  const rows = await db
    .update(transactions)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.recurringRuleId, ruleId),
        isNull(transactions.editedAt),
        onlyFutureFrom ? gt(transactions.txnDate, onlyFutureFrom) : undefined,
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}

export async function deleteGenerated(
  ruleId: string,
  onlyFutureFrom?: TPlainDate,
): Promise<number> {
  const rows = await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.recurringRuleId, ruleId),
        onlyFutureFrom ? gt(transactions.txnDate, onlyFutureFrom) : undefined,
      ),
    )
    .returning({ id: transactions.id });
  return rows.length;
}

/**
 * Cooperative lock so a burst of concurrent requests doesn't all run the
 * catch-up pass. Returns false when another request already holds it.
 */
export async function tryAdvisoryLock(): Promise<boolean> {
  const rows = await db.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_lock(hashtext('recurring_catchup')) as locked`,
  );
  const first = (rows as unknown as { locked: boolean }[])[0];
  return first?.locked === true;
}

export async function releaseAdvisoryLock(): Promise<void> {
  await db.execute(
    sql`select pg_advisory_unlock(hashtext('recurring_catchup'))`,
  );
}

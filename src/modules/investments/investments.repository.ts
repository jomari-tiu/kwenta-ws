import { and, asc, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { TPlainDate } from '../../common/date.js';
import { toCentavos } from '../../common/money.js';
import { investments, transactions } from '../../db/schema/index.js';

export type TInvestmentRow = typeof investments.$inferSelect;
export type TInvestmentInsert = typeof investments.$inferInsert;

export async function listInvestments(
  limit: number,
  offset: number,
): Promise<{ rows: TInvestmentRow[]; total: number }> {
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(investments)
      // Goals with a date come first, soonest first; open-ended pots trail —
      // there is nothing to count down to.
      .orderBy(
        sql`${investments.targetDate} is null`,
        asc(investments.targetDate),
        desc(investments.createdAt),
      )
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(investments),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

export async function findInvestmentById(
  id: string,
): Promise<TInvestmentRow | undefined> {
  const rows = await db
    .select()
    .from(investments)
    .where(eq(investments.id, id))
    .limit(1);
  return rows[0];
}

export type TFlows = { contributed: number; withdrawn: number };

/**
 * Money in and money out, per investment, straight from the ledger.
 *
 * Split by transaction TYPE in one pass: a tagged expense is a contribution, a
 * tagged income is a withdrawal. Deriving this rather than storing a balance is
 * what makes editing or deleting a contribution safe.
 */
export async function flowsByInvestment(): Promise<Map<string, TFlows>> {
  const rows = await db
    .select({
      investmentId: transactions.investmentId,
      contributed: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense'), 0)`,
      withdrawn: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income'), 0)`,
    })
    .from(transactions)
    .where(sql`${transactions.investmentId} is not null`)
    .groupBy(transactions.investmentId);

  return new Map(
    rows
      .filter((r): r is typeof r & { investmentId: string } =>
        Boolean(r.investmentId),
      )
      .map((r) => [
        r.investmentId,
        {
          contributed: toCentavos(r.contributed),
          withdrawn: toCentavos(r.withdrawn),
        },
      ]),
  );
}

export async function insertInvestment(
  values: TInvestmentInsert,
): Promise<TInvestmentRow> {
  const rows = await db.insert(investments).values(values).returning();
  return rows[0]!;
}

export async function updateInvestment(
  id: string,
  values: Partial<TInvestmentInsert>,
): Promise<TInvestmentRow | undefined> {
  const rows = await db
    .update(investments)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(investments.id, id))
    .returning();
  return rows[0];
}

/**
 * Delete an investment. Its contribution and withdrawal transactions SURVIVE
 * with a null FK — that money really did move, exactly as with credit loans and
 * installment plans.
 */
export async function deleteInvestment(
  id: string,
  removeTransactions: boolean,
): Promise<{ keptTransactionCount: number; removedTransactionCount: number }> {
  return db.transaction(async (tx) => {
    const linked = await tx
      .select({ value: count() })
      .from(transactions)
      .where(eq(transactions.investmentId, id));
    const n = linked[0]?.value ?? 0;

    // KEEPING them leaves the ledger untouched: those pesos really did leave
    // the account, and a fund record disappearing does not undo that.
    // REMOVING them is the "I never actually moved this money" case — the
    // expenses go, so the account balances rise back by exactly what went in.
    //
    // The caller must choose, because both answers are wrong half the time,
    // and silently picking one is how money goes missing from an account with
    // nothing appearing to have happened.
    if (removeTransactions) {
      await tx.delete(transactions).where(eq(transactions.investmentId, id));
    }
    await tx.delete(investments).where(eq(investments.id, id));

    return {
      keptTransactionCount: removeTransactions ? 0 : n,
      removedTransactionCount: removeTransactions ? n : 0,
    };
  });
}

/** Record a contribution (expense) or a withdrawal (income) against a fund. */
export async function insertFlow(args: {
  investmentId: string;
  type: 'expense' | 'income';
  amountCentavos: number;
  txnDate: TPlainDate;
  categoryId: string;
  accountId: string;
  note: string;
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
      investmentId: args.investmentId,
    })
    .returning({ id: transactions.id });
  return { transactionId: rows[0]!.id };
}

export type TInvestmentFlow = {
  id: string;
  type: string;
  amountCentavos: number;
  txnDate: string;
  note: string | null;
};

export async function listFlows(
  investmentId: string,
): Promise<TInvestmentFlow[]> {
  return db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountCentavos: transactions.amountCentavos,
      txnDate: transactions.txnDate,
      note: transactions.note,
    })
    .from(transactions)
    .where(eq(transactions.investmentId, investmentId))
    .orderBy(desc(transactions.txnDate));
}

/**
 * Delete one contribution or withdrawal, but ONLY if it belongs to this fund —
 * the transaction id comes from the URL, so without the ownership check any row
 * could be deleted through this route.
 */
export async function deleteFlow(
  investmentId: string,
  transactionId: string,
): Promise<boolean> {
  const rows = await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.investmentId, investmentId),
      ),
    )
    .returning({ id: transactions.id });
  return rows.length > 0;
}

export type TInvestmentSummary = {
  activeCount: number;
  fundedCount: number;
  untargetedCount: number;
  totalNetContributedCentavos: number;
  /** Null when NOTHING is valued — showing ₱0 would read as a total loss. */
  totalCurrentValueCentavos: number | null;
  /** Gain across valued funds only. Null when nothing is valued. */
  totalGainCentavos: number | null;
  nextTargetDate: string | null;
};

export async function summary(): Promise<TInvestmentSummary> {
  const [rows, flows] = await Promise.all([
    db.select().from(investments),
    flowsByInvestment(),
  ]);

  let activeCount = 0;
  let fundedCount = 0;
  let untargetedCount = 0;
  let net = 0;
  let valued = 0;
  let valuedNet = 0;
  let hasValued = false;
  let nextTargetDate: string | null = null;

  for (const row of rows) {
    if (row.closedAt !== null) continue;
    const flow = flows.get(row.id) ?? { contributed: 0, withdrawn: 0 };
    const netContributed = flow.contributed - flow.withdrawn;

    activeCount += 1;
    net += netContributed;

    if (row.targetCentavos === null) {
      untargetedCount += 1;
    } else if (netContributed >= row.targetCentavos) {
      fundedCount += 1;
    }

    if (row.currentValueCentavos !== null) {
      hasValued = true;
      valued += row.currentValueCentavos;
      // Gain is only meaningful against the funds that HAVE a valuation, so the
      // comparison base is those funds' contributions, not every fund's.
      valuedNet += netContributed;
    }

    if (row.targetDate !== null) {
      if (nextTargetDate === null || row.targetDate < nextTargetDate) {
        nextTargetDate = row.targetDate;
      }
    }
  }

  return {
    activeCount,
    fundedCount,
    untargetedCount,
    totalNetContributedCentavos: net,
    totalCurrentValueCentavos: hasValued ? valued : null,
    totalGainCentavos: hasValued ? valued - valuedNet : null,
    nextTargetDate,
  };
}

/** Funds whose goal date falls in a range — for the calendar. */
export type TTargetRow = {
  id: string;
  name: string;
  provider: string | null;
  targetDate: string;
  targetCentavos: number | null;
};

export async function listTargetsBetween(
  from: TPlainDate,
  to: TPlainDate,
): Promise<TTargetRow[]> {
  const rows = await db
    .select({
      id: investments.id,
      name: investments.name,
      provider: investments.provider,
      targetDate: investments.targetDate,
      targetCentavos: investments.targetCentavos,
    })
    .from(investments)
    .where(
      and(
        sql`${investments.targetDate} is not null`,
        sql`${investments.targetDate} >= ${from}`,
        lte(investments.targetDate, to),
        isNull(investments.closedAt),
      ),
    );

  return rows.filter((r): r is TTargetRow => r.targetDate !== null);
}

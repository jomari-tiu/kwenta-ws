import { and, asc, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { TPlainDate } from '../../common/date.js';
import { toCentavos } from '../../common/money.js';
import { creditLoans, transactions } from '../../db/schema/index.js';

export type TCreditLoanRow = typeof creditLoans.$inferSelect;
export type TCreditLoanInsert = typeof creditLoans.$inferInsert;

export async function listLoans(
  limit: number,
  offset: number,
): Promise<{ rows: TCreditLoanRow[]; total: number }> {
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(creditLoans)
      // Loans with a due date come first, soonest first; undated ones trail —
      // there is nothing to be urgent about.
      .orderBy(
        sql`${creditLoans.dueDate} is null`,
        asc(creditLoans.dueDate),
        desc(creditLoans.createdAt),
      )
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(creditLoans),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

export async function findLoanById(
  id: string,
): Promise<TCreditLoanRow | undefined> {
  const rows = await db
    .select()
    .from(creditLoans)
    .where(eq(creditLoans.id, id))
    .limit(1);
  return rows[0];
}

/**
 * Total repaid per loan.
 *
 * The balance is derived from the ledger rather than stored, so deleting or
 * editing a repayment transaction can never leave a loan showing a stale
 * figure.
 */
export async function repaidByLoan(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      creditLoanId: transactions.creditLoanId,
      repaid: sql<string>`coalesce(sum(${transactions.amountCentavos}), 0)`,
    })
    .from(transactions)
    .where(sql`${transactions.creditLoanId} is not null`)
    .groupBy(transactions.creditLoanId);

  return new Map(
    rows
      .filter((r): r is { creditLoanId: string; repaid: string } =>
        Boolean(r.creditLoanId),
      )
      .map((r) => [r.creditLoanId, toCentavos(r.repaid)]),
  );
}

export async function insertLoan(
  values: TCreditLoanInsert,
): Promise<TCreditLoanRow> {
  const rows = await db.insert(creditLoans).values(values).returning();
  return rows[0]!;
}

export async function updateLoan(
  id: string,
  values: Partial<TCreditLoanInsert>,
): Promise<TCreditLoanRow | undefined> {
  const rows = await db
    .update(creditLoans)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(creditLoans.id, id))
    .returning();
  return rows[0];
}

/**
 * Delete a loan. Its repayment transactions SURVIVE with a null FK — that was
 * real money leaving the account, exactly as with installment plans.
 */
export async function deleteLoan(
  id: string,
): Promise<{ keptTransactionCount: number }> {
  return db.transaction(async (tx) => {
    const kept = await tx
      .select({ value: count() })
      .from(transactions)
      .where(eq(transactions.creditLoanId, id));
    await tx.delete(creditLoans).where(eq(creditLoans.id, id));
    return { keptTransactionCount: kept[0]?.value ?? 0 };
  });
}

/** Record a repayment as a real expense, linked back to the loan. */
export async function insertRepayment(args: {
  loan: TCreditLoanRow;
  amountCentavos: number;
  paidDate: TPlainDate;
  accountId: string;
  note: string;
}): Promise<{ transactionId: string }> {
  const rows = await db
    .insert(transactions)
    .values({
      type: 'expense',
      amountCentavos: args.amountCentavos,
      txnDate: args.paidDate,
      categoryId: args.loan.categoryId,
      accountId: args.accountId,
      note: args.note,
      source: 'manual',
      creditLoanId: args.loan.id,
    })
    .returning({ id: transactions.id });
  return { transactionId: rows[0]!.id };
}

export type TLoanRepayment = {
  id: string;
  amountCentavos: number;
  txnDate: string;
  note: string | null;
};

export async function listRepayments(
  loanId: string,
): Promise<TLoanRepayment[]> {
  return db
    .select({
      id: transactions.id,
      amountCentavos: transactions.amountCentavos,
      txnDate: transactions.txnDate,
      note: transactions.note,
    })
    .from(transactions)
    .where(eq(transactions.creditLoanId, loanId))
    .orderBy(desc(transactions.txnDate));
}

export type TCreditLoanSummary = {
  openCount: number;
  overdueCount: number;
  undatedCount: number;
  totalOutstandingCentavos: number;
  nextDueDate: string | null;
};

/**
 * `today` comes from the app timezone, never Postgres current_date — and a loan
 * with a NULL due date is never counted as overdue.
 */
export async function summary(today: TPlainDate): Promise<TCreditLoanSummary> {
  const [loans, repaid] = await Promise.all([
    db.select().from(creditLoans),
    repaidByLoan(),
  ]);

  let openCount = 0;
  let overdueCount = 0;
  let undatedCount = 0;
  let outstanding = 0;
  let nextDueDate: string | null = null;

  for (const loan of loans) {
    const balance = loan.principalCentavos - (repaid.get(loan.id) ?? 0);
    const isSettled = balance <= 0 || loan.closedAt !== null;
    if (isSettled) continue;

    openCount += 1;
    outstanding += balance;

    if (loan.dueDate === null) {
      undatedCount += 1;
      continue;
    }
    if (loan.dueDate < today) overdueCount += 1;
    if (nextDueDate === null || loan.dueDate < nextDueDate) {
      nextDueDate = loan.dueDate;
    }
  }

  return {
    openCount,
    overdueCount,
    undatedCount,
    totalOutstandingCentavos: outstanding,
    nextDueDate,
  };
}

/** Loans whose due date falls in a range — for the calendar. */
export type TLoanDueRow = {
  id: string;
  name: string;
  lender: string | null;
  dueDate: string;
  principalCentavos: number;
};

export async function listDuesBetween(
  from: TPlainDate,
  to: TPlainDate,
): Promise<TLoanDueRow[]> {
  const rows = await db
    .select({
      id: creditLoans.id,
      name: creditLoans.name,
      lender: creditLoans.lender,
      dueDate: creditLoans.dueDate,
      principalCentavos: creditLoans.principalCentavos,
    })
    .from(creditLoans)
    .where(
      and(
        sql`${creditLoans.dueDate} is not null`,
        sql`${creditLoans.dueDate} >= ${from}`,
        lte(creditLoans.dueDate, to),
        isNull(creditLoans.closedAt),
      ),
    );

  return rows.filter((r): r is TLoanDueRow => r.dueDate !== null);
}

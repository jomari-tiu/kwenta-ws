import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../../db/client.js';
import { toCentavos } from '../../common/money.js';
import type { TPlainDate } from '../../common/date.js';
import { accounts, categories, transactions } from '../../db/schema/index.js';
import type { TListTransactionsQuery } from './transactions.schema.js';

export type TTransactionRow = typeof transactions.$inferSelect;
export type TTransactionInsert = typeof transactions.$inferInsert;

/** The joined row shape the list and day views render directly. */
const listColumns = {
  id: transactions.id,
  type: transactions.type,
  amountCentavos: transactions.amountCentavos,
  txnDate: transactions.txnDate,
  note: transactions.note,
  source: transactions.source,
  installmentPaymentId: transactions.installmentPaymentId,
  creditLoanId: transactions.creditLoanId,
  recurringRuleId: transactions.recurringRuleId,
  editedAt: transactions.editedAt,
  categoryId: categories.id,
  categoryName: categories.name,
  categoryIcon: categories.icon,
  categoryColor: categories.color,
  accountId: accounts.id,
  accountName: accounts.name,
  accountIcon: accounts.icon,
  accountColor: accounts.color,
};

export type TTransactionJoinedRow = {
  creditLoanId: string | null;
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amountCentavos: number;
  txnDate: string;
  note: string | null;
  source: 'manual' | 'recurring' | 'installment';
  installmentPaymentId: string | null;
  recurringRuleId: string | null;
  editedAt: Date | null;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  accountId: string;
  accountName: string;
  accountIcon: string | null;
  accountColor: string | null;
};

function buildFilters(q: TListTransactionsQuery): SQL | undefined {
  return and(
    // Transfers are reserved but unimplemented; exclude them from every
    // income/expense read so the type's arrival can't silently skew totals.
    sql`${transactions.type} <> 'transfer'`,
    q.dateFrom ? gte(transactions.txnDate, q.dateFrom) : undefined,
    q.dateTo ? lte(transactions.txnDate, q.dateTo) : undefined,
    q.type ? eq(transactions.type, q.type) : undefined,
    q.categoryId ? inArray(transactions.categoryId, q.categoryId) : undefined,
    q.accountId ? inArray(transactions.accountId, q.accountId) : undefined,
    q.amountMinCentavos !== undefined
      ? gte(transactions.amountCentavos, q.amountMinCentavos)
      : undefined,
    q.amountMaxCentavos !== undefined
      ? lte(transactions.amountCentavos, q.amountMaxCentavos)
      : undefined,
    q.source ? eq(transactions.source, q.source) : undefined,
    q.search ? ilike(transactions.note, `%${q.search}%`) : undefined,
  );
}

function orderFor(q: TListTransactionsQuery) {
  const dir = q.sortDir === 'asc' ? asc : desc;
  const col =
    q.sortBy === 'amount'
      ? transactions.amountCentavos
      : q.sortBy === 'created'
        ? transactions.createdAt
        : transactions.txnDate;
  // Secondary key keeps pagination stable when many rows share a date.
  return [dir(col), desc(transactions.createdAt)];
}

export type TListSummary = {
  incomeCentavos: number;
  expenseCentavos: number;
  netCentavos: number;
  count: number;
};

export async function listTransactions(
  q: TListTransactionsQuery,
  limit: number,
  offset: number,
): Promise<{
  rows: TTransactionJoinedRow[];
  total: number;
  summary: TListSummary;
}> {
  const where = buildFilters(q);

  const [rows, totals, summaryRows] = await Promise.all([
    db
      .select(listColumns)
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(where)
      .orderBy(...orderFor(q))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(transactions).where(where),
    // Summary spans EVERY matching row, not the current page — that's the
    // question the list view exists to answer.
    db
      .select({
        income: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income'), 0)`,
        expense: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense'), 0)`,
      })
      .from(transactions)
      .where(where),
  ]);

  const income = toCentavos(summaryRows[0]?.income);
  const expense = toCentavos(summaryRows[0]?.expense);
  const total = totals[0]?.value ?? 0;

  return {
    rows: rows,
    total,
    summary: {
      incomeCentavos: income,
      expenseCentavos: expense,
      netCentavos: income - expense,
      count: total,
    },
  };
}

/** Unpaged cursor for CSV export. */
export async function streamForExport(
  q: TListTransactionsQuery,
  hardCap: number,
): Promise<TTransactionJoinedRow[]> {
  const rows = await db
    .select(listColumns)
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(buildFilters(q))
    .orderBy(...orderFor(q))
    .limit(hardCap);
  return rows;
}

export async function findJoinedById(
  id: string,
): Promise<TTransactionJoinedRow | undefined> {
  const rows = await db
    .select(listColumns)
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(eq(transactions.id, id))
    .limit(1);
  return rows[0];
}

export async function findById(
  id: string,
): Promise<TTransactionRow | undefined> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  return rows[0];
}

export async function insertTransaction(
  values: TTransactionInsert,
): Promise<TTransactionRow> {
  const rows = await db.insert(transactions).values(values).returning();
  return rows[0]!;
}

export async function updateTransaction(
  id: string,
  values: Partial<TTransactionInsert>,
): Promise<TTransactionRow | undefined> {
  const rows = await db
    .update(transactions)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(transactions.id, id))
    .returning();
  return rows[0];
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.id, id));
}

/** Per-day aggregates for a date range, for the calendar grid. */
export type TDayAggregate = {
  txnDate: string;
  incomeCentavos: number;
  expenseCentavos: number;
  transactionCount: number;
};

export async function aggregateByDay(
  from: TPlainDate,
  to: TPlainDate,
): Promise<TDayAggregate[]> {
  const rows = await db
    .select({
      txnDate: transactions.txnDate,
      income: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense'), 0)`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, to),
        sql`${transactions.type} <> 'transfer'`,
      ),
    )
    .groupBy(transactions.txnDate);

  return rows.map((r) => ({
    txnDate: r.txnDate,
    incomeCentavos: toCentavos(r.income),
    expenseCentavos: toCentavos(r.expense),
    transactionCount: r.transactionCount,
  }));
}

/** Every transaction in a date range, joined — powers the calendar day panel. */
export async function listJoinedBetween(
  from: TPlainDate,
  to: TPlainDate,
): Promise<TTransactionJoinedRow[]> {
  const rows = await db
    .select(listColumns)
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, to),
        sql`${transactions.type} <> 'transfer'`,
      ),
    )
    .orderBy(asc(transactions.txnDate), asc(transactions.createdAt));
  return rows;
}

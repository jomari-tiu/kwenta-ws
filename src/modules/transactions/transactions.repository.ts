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
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/client.js';
import { toCentavos } from '../../common/money.js';
import type { TPlainDate } from '../../common/date.js';
import {
  accounts,
  businesses,
  categories,
  transactions,
} from '../../db/schema/index.js';
import type { TListTransactionsQuery } from './transactions.schema.js';

export type TTransactionRow = typeof transactions.$inferSelect;
export type TTransactionInsert = typeof transactions.$inferInsert;

/** The joined row shape the list and day views render directly. */
const toAccounts = alias(accounts, 'to_accounts');

const listColumns = {
  id: transactions.id,
  type: transactions.type,
  amountCentavos: transactions.amountCentavos,
  txnDate: transactions.txnDate,
  note: transactions.note,
  source: transactions.source,
  installmentPaymentId: transactions.installmentPaymentId,
  creditLoanId: transactions.creditLoanId,
  investmentId: transactions.investmentId,
  businessId: transactions.businessId,
  businessName: businesses.name,
  transferAccountId: transactions.transferAccountId,
  transferAccountName: toAccounts.name,
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
  investmentId: string | null;
  businessId: string | null;
  businessName: string | null;
  transferAccountId: string | null;
  transferAccountName: string | null;
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amountCentavos: number;
  txnDate: string;
  note: string | null;
  source: 'manual' | 'recurring' | 'installment';
  installmentPaymentId: string | null;
  recurringRuleId: string | null;
  editedAt: Date | null;
  // Nullable because the category join is now LEFT: a transfer has none.
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  accountId: string;
  accountName: string;
  accountIcon: string | null;
  accountColor: string | null;
};

function buildFilters(q: TListTransactionsQuery): SQL | undefined {
  return and(
    // Transfers ARE listed: money moved, and hiding it would leave the ledger
    // unable to explain a balance change. They stay out of the income/expense
    // SUMS via the `filter (where type = ...)` clauses instead, so listing them
    // cannot skew a total.
    q.dateFrom ? gte(transactions.txnDate, q.dateFrom) : undefined,
    q.dateTo ? lte(transactions.txnDate, q.dateTo) : undefined,
    q.type ? eq(transactions.type, q.type) : undefined,
    // These two must exclude BOTH funds and business rows, matching the
    // dashboard's Spending and Income tiles exactly. Miss one and clicking a
    // tile opens a list whose summary is larger than the tile you clicked —
    // the most visible symptom of the personal/business split going wrong.
    q.bucket === 'spending'
      ? and(
          eq(transactions.type, 'expense'),
          sql`${transactions.investmentId} is null`,
          sql`${transactions.businessId} is null`,
        )
      : undefined,
    q.bucket === 'income'
      ? and(
          eq(transactions.type, 'income'),
          sql`${transactions.investmentId} is null`,
          sql`${transactions.businessId} is null`,
        )
      : undefined,
    // Both directions: a contribution and a withdrawal are the same story.
    q.bucket === 'invested'
      ? sql`${transactions.investmentId} is not null`
      : undefined,
    // Likewise both directions: revenue, cost, capital and drawings are all
    // the business's story, and splitting them here would need four buckets.
    q.bucket === 'business'
      ? sql`${transactions.businessId} is not null`
      : undefined,
    // Excludes business transfers: a capital move belongs in the business's
    // own bucket, not your personal transfers. With this, the five buckets
    // partition the ledger exactly once — no row counted twice, none missed.
    q.bucket === 'transfer'
      ? and(
          eq(transactions.type, 'transfer'),
          sql`${transactions.businessId} is null`,
        )
      : undefined,
    q.businessId ? eq(transactions.businessId, q.businessId) : undefined,
    q.categoryId ? inArray(transactions.categoryId, q.categoryId) : undefined,
    // Either leg: filtering by Cash must surface transfers INTO Cash too,
    // otherwise the account filter disagrees with the account's own balance.
    q.accountId
      ? or(
          inArray(transactions.accountId, q.accountId),
          inArray(transactions.transferAccountId, q.accountId),
        )
      : undefined,
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
  /** Personal income: excludes fund withdrawals and business revenue. */
  incomeCentavos: number;
  /**
   * EVERY expense row, funds and business costs included. Kept as the raw
   * total because a filtered list should be able to say what left the account,
   * but it is NOT what net is built from — see below.
   */
  expenseCentavos: number;
  /** Money consumed: excludes fund contributions and business costs. */
  spendingCentavos: number;
  /** Net moved into funds. Yours still — neither spending nor income. */
  savedCentavos: number;
  /** Business revenue minus costs. Kept out of the personal figures. */
  businessNetCentavos: number;
  /**
   * Total moved by transfers. Kept out of net on purpose — a transfer changes
   * no total — but reported, because a bucket made only of transfers would
   * otherwise show a row count beside ₱0.00 and read as broken.
   */
  transferCentavos: number;
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
      // LEFT, not INNER: a transfer has no category, and an inner join would drop
      // it from the list entirely — money silently missing from the ledger view.
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(toAccounts, eq(transactions.transferAccountId, toAccounts.id))
      .leftJoin(businesses, eq(transactions.businessId, businesses.id))
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
        // Split exactly as the dashboard splits it. Summing every expense row
        // into one "expense" total and calling income minus that "net" counts
        // saving as a loss — ₱54,000 put into funds made a good month read as
        // −₱1,312. Same structural rule: personal is neither fund nor business.
        income: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income' and ${transactions.investmentId} is null and ${transactions.businessId} is null), 0)`,
        expense: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense'), 0)`,
        spending: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense' and ${transactions.investmentId} is null and ${transactions.businessId} is null), 0)`,
        fundIn: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense' and ${transactions.investmentId} is not null), 0)`,
        fundOut: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income' and ${transactions.investmentId} is not null), 0)`,
        businessIn: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income' and ${transactions.businessId} is not null), 0)`,
        businessOut: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense' and ${transactions.businessId} is not null), 0)`,
        transfer: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'transfer'), 0)`,
      })
      .from(transactions)
      .where(where),
  ]);

  const income = toCentavos(summaryRows[0]?.income);
  const expense = toCentavos(summaryRows[0]?.expense);
  const spending = toCentavos(summaryRows[0]?.spending);
  const fundIn = toCentavos(summaryRows[0]?.fundIn);
  const fundOut = toCentavos(summaryRows[0]?.fundOut);
  const businessIn = toCentavos(summaryRows[0]?.businessIn);
  const businessOut = toCentavos(summaryRows[0]?.businessOut);
  const transfer = toCentavos(summaryRows[0]?.transfer);
  const total = totals[0]?.value ?? 0;
  const businessNet = businessIn - businessOut;

  return {
    rows: rows,
    total,
    summary: {
      incomeCentavos: income,
      expenseCentavos: expense,
      spendingCentavos: spending,
      savedCentavos: fundIn - fundOut,
      businessNetCentavos: businessNet,
      transferCentavos: transfer,
      // EXACTLY the dashboard's formula: income − spending − saved. Money put
      // into a fund is not spending, but it is allocated, so net is what was
      // left over unallocated. Business results are reported separately and
      // deliberately excluded — the personal figure must keep meaning what it
      // means on the dashboard, or the same month reads two different ways.
      netCentavos: income - spending - (fundIn - fundOut) + businessNet,
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
    // LEFT, not INNER: a transfer has no category, and an inner join would drop
    // it from the list entirely — money silently missing from the ledger view.
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(toAccounts, eq(transactions.transferAccountId, toAccounts.id))
    .leftJoin(businesses, eq(transactions.businessId, businesses.id))
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
    // LEFT, not INNER: a transfer has no category, and an inner join would drop
    // it from the list entirely — money silently missing from the ledger view.
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(toAccounts, eq(transactions.transferAccountId, toAccounts.id))
    .leftJoin(businesses, eq(transactions.businessId, businesses.id))
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

/** Every transaction in a date range, joined — powers the calendar day panel. */
export async function listJoinedBetween(
  from: TPlainDate,
  to: TPlainDate,
): Promise<TTransactionJoinedRow[]> {
  const rows = await db
    .select(listColumns)
    .from(transactions)
    // LEFT, not INNER: a transfer has no category, and an inner join would drop
    // it from the list entirely — money silently missing from the ledger view.
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(toAccounts, eq(transactions.transferAccountId, toAccounts.id))
    .leftJoin(businesses, eq(transactions.businessId, businesses.id))
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, to),
        // Transfers ARE included: money moved that day, and a calendar that
        // hides it shows an empty cell for a day something happened. They are
        // kept out of the day's income and expense sums separately, in the
        // calendar service, so the day's net stays correct.
      ),
    )
    .orderBy(asc(transactions.txnDate), asc(transactions.createdAt));
  return rows;
}

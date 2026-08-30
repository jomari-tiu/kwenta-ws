import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { TPlainDate } from '../../common/date.js';
import { toCentavos } from '../../common/money.js';
import { categories, transactions } from '../../db/schema/index.js';

export type TGranularity = 'daily' | 'weekly' | 'monthly';

export type TSeriesRow = {
  bucket: string;
  incomeCentavos: number;
  expenseCentavos: number;
  transactionCount: number;
};

/**
 * Grouped income-vs-expense series.
 *
 * Two things make this simple rather than fiddly:
 *  - `date_trunc('week', ...)` in Postgres is ISO **Monday**-start already, so
 *    there is no offset arithmetic anywhere.
 *  - txn_date is a `date` column, so there is NO timezone handling at all. That
 *    is the entire payoff of the plain-date decision.
 *
 * Two conditional SUMs in one pass beats two round trips. `::date` because
 * date_trunc returns timestamp; `count(*)::int` so postgres.js gives a number
 * rather than a string.
 */
export async function series(
  from: TPlainDate,
  to: TPlainDate,
  granularity: TGranularity,
): Promise<TSeriesRow[]> {
  const bucket =
    granularity === 'daily'
      ? sql<string>`${transactions.txnDate}::date`
      : granularity === 'weekly'
        ? sql<string>`date_trunc('week', ${transactions.txnDate})::date`
        : sql<string>`date_trunc('month', ${transactions.txnDate})::date`;

  const rows = await db
    .select({
      bucket,
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
        // Fund movements are excluded here too, so the chart cannot contradict
        // the Spending tile above it. Business rows go for the same reason:
        // this chart is the personal story.
        sql`${transactions.investmentId} is null`,
        sql`${transactions.businessId} is null`,
      ),
    )
    .groupBy(bucket)
    .orderBy(bucket);

  return rows.map((r) => ({
    bucket: r.bucket,
    incomeCentavos: toCentavos(r.income),
    expenseCentavos: toCentavos(r.expense),
    transactionCount: r.transactionCount,
  }));
}

export type TCategoryTotal = {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  totalCentavos: number;
  transactionCount: number;
};

export async function byCategory(
  from: TPlainDate,
  to: TPlainDate,
  type: 'income' | 'expense',
): Promise<TCategoryTotal[]> {
  const rows = await db
    .select({
      categoryId: categories.id,
      name: categories.name,
      icon: categories.icon,
      color: categories.color,
      total: sql<string>`coalesce(sum(${transactions.amountCentavos}), 0)`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.type, type),
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, to),
        // Otherwise "Savings & Investments" tops the spending list with money
        // you did not spend, and the rows no longer sum to the Spending tile.
        // Business categories would break it the same way, from the other end.
        sql`${transactions.investmentId} is null`,
        sql`${transactions.businessId} is null`,
      ),
    )
    .groupBy(categories.id, categories.name, categories.icon, categories.color)
    .orderBy(desc(sql`coalesce(sum(${transactions.amountCentavos}), 0)`));

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    icon: r.icon,
    color: r.color,
    totalCentavos: toCentavos(r.total),
    transactionCount: r.transactionCount,
  }));
}

export type TPeriodTotals = {
  /** Real income. A fund withdrawal is your own money coming back, not income. */
  incomeCentavos: number;
  /** Real spending — money consumed. Excludes anything moved into a fund. */
  spendingCentavos: number;
  /** Net moved INTO funds: contributions minus withdrawals. */
  savedCentavos: number;
  /** Everything that left the account, savings included. Drives the true net. */
  expenseCentavos: number;
  /**
   * Business revenue minus business costs. Kept as its own term rather than
   * folded into income/spending, because the personal figures must keep meaning
   * what they mean — but leaving it out of the headline net entirely would be a
   * different lie: real money left a real account and would appear nowhere.
   */
  businessNetCentavos: number;
};

/**
 * Money moved into a savings pot is NOT spending — you still have it. Counting
 * it as an expense makes saving look like consumption and, worse, drags the
 * savings rate DOWN the more you save.
 *
 * The split is structural (`investment_id is not null`) rather than by category
 * name, so renaming a category cannot silently change what counts as spending.
 */
export async function totalsBetween(
  from: TPlainDate,
  to: TPlainDate,
): Promise<TPeriodTotals> {
  const isBusiness = sql`${transactions.businessId} is not null`;
  const intoFund = sql`${transactions.investmentId} is not null and ${transactions.businessId} is null`;
  // "Personal" is neither a fund movement nor a business row. Both exclusions
  // are structural, never by category name.
  const personal = sql`${transactions.investmentId} is null and ${transactions.businessId} is null`;

  const rows = await db
    .select({
      income: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income' and ${personal}), 0)`,
      spending: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense' and ${personal}), 0)`,
      fundIn: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense' and ${intoFund}), 0)`,
      fundOut: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income' and ${intoFund}), 0)`,
      businessIn: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income' and ${isBusiness}), 0)`,
      businessOut: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense' and ${isBusiness}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, to),
        sql`${transactions.type} <> 'transfer'`,
      ),
    );

  const income = toCentavos(rows[0]?.income);
  const spending = toCentavos(rows[0]?.spending);
  const fundIn = toCentavos(rows[0]?.fundIn);
  const fundOut = toCentavos(rows[0]?.fundOut);
  const businessIn = toCentavos(rows[0]?.businessIn);
  const businessOut = toCentavos(rows[0]?.businessOut);

  return {
    incomeCentavos: income,
    spendingCentavos: spending,
    savedCentavos: fundIn - fundOut,
    expenseCentavos: spending + fundIn,
    businessNetCentavos: businessIn - businessOut,
  };
}

/**
 * Everything that ever moved, deliberately unfiltered — fund contributions and
 * business revenue and costs all count, because this answers "what has passed
 * through my hands", not "what did I personally earn and spend".
 *
 * Capital and drawings are transfers and so are already excluded, which is the
 * right answer: they shuffle money between two pockets I own and would
 * otherwise inflate both sides of this figure without changing anything.
 */
export async function allTimeTotals(): Promise<{
  incomeCentavos: number;
  expenseCentavos: number;
}> {
  const rows = await db
    .select({
      income: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense'), 0)`,
    })
    .from(transactions)
    .where(sql`${transactions.type} <> 'transfer'`);

  return {
    incomeCentavos: toCentavos(rows[0]?.income),
    expenseCentavos: toCentavos(rows[0]?.expense),
  };
}

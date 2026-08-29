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

export async function totalsBetween(
  from: TPlainDate,
  to: TPlainDate,
): Promise<{ incomeCentavos: number; expenseCentavos: number }> {
  const rows = await db
    .select({
      income: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${transactions.amountCentavos}) filter (where ${transactions.type} = 'expense'), 0)`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, to),
        sql`${transactions.type} <> 'transfer'`,
      ),
    );

  return {
    incomeCentavos: toCentavos(rows[0]?.income),
    expenseCentavos: toCentavos(rows[0]?.expense),
  };
}

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

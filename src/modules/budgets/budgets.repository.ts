import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { TPlainDate } from '../../common/date.js';
import { toCentavos } from '../../common/money.js';
import {
  budgetOverrides,
  categories,
  transactions,
} from '../../db/schema/index.js';

export type TOverrideRow = typeof budgetOverrides.$inferSelect;

export type TBudgetRow = {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  defaultCapCentavos: number | null;
  overrideCapCentavos: number | null;
  overrideId: string | null;
  spentCentavos: number;
};

/**
 * One pass: every unarchived expense category, its default cap, this month's
 * override if any, and this month's spend.
 *
 * effectiveCap = coalesce(override, default) — carry-forward is free, because
 * the ABSENCE of an override means "use the default".
 */
export async function budgetsForMonth(
  monthStart: TPlainDate,
  monthEnd: TPlainDate,
): Promise<TBudgetRow[]> {
  const spendSub = db
    .select({
      categoryId: transactions.categoryId,
      spent: sql<string>`coalesce(sum(${transactions.amountCentavos}), 0)`.as(
        'spent',
      ),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, 'expense'),
        gte(transactions.txnDate, monthStart),
        lte(transactions.txnDate, monthEnd),
        // A budget caps what you CONSUME. Money moved into a fund is still
        // yours, so counting it here made saving look like overspending — and
        // a business grocery run must not eat the personal Groceries cap.
        sql`${transactions.investmentId} is null`,
        sql`${transactions.businessId} is null`,
      ),
    )
    .groupBy(transactions.categoryId)
    .as('spend');

  const rows = await db
    .select({
      categoryId: categories.id,
      name: categories.name,
      icon: categories.icon,
      color: categories.color,
      defaultCapCentavos: categories.monthlyBudgetCentavos,
      overrideCapCentavos: budgetOverrides.capCentavos,
      overrideId: budgetOverrides.id,
      spent: spendSub.spent,
    })
    .from(categories)
    .leftJoin(
      budgetOverrides,
      and(
        eq(budgetOverrides.categoryId, categories.id),
        eq(budgetOverrides.month, monthStart),
      ),
    )
    .leftJoin(spendSub, eq(spendSub.categoryId, categories.id))
    // Personal only: budgets are a personal-spending tool, and listing business
    // categories here would put unbudgetable rows on the page and spurious
    // entries in the dashboard's budget alerts.
    .where(
      and(
        eq(categories.kind, 'expense'),
        eq(categories.scope, 'personal'),
        isNull(categories.archivedAt),
      ),
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    icon: r.icon,
    color: r.color,
    defaultCapCentavos: r.defaultCapCentavos,
    overrideCapCentavos: r.overrideCapCentavos,
    overrideId: r.overrideId,
    spentCentavos: toCentavos(r.spent),
  }));
}

export async function setDefaultCap(
  categoryId: string,
  capCentavos: number | null,
): Promise<void> {
  await db
    .update(categories)
    .set({ monthlyBudgetCentavos: capCentavos, updatedAt: new Date() })
    .where(eq(categories.id, categoryId));
}

export async function upsertOverride(
  categoryId: string,
  monthStart: TPlainDate,
  capCentavos: number,
): Promise<TOverrideRow> {
  const rows = await db
    .insert(budgetOverrides)
    .values({ categoryId, month: monthStart, capCentavos })
    .onConflictDoUpdate({
      target: [budgetOverrides.categoryId, budgetOverrides.month],
      set: { capCentavos, updatedAt: new Date() },
    })
    .returning();
  return rows[0]!;
}

export async function deleteOverride(
  categoryId: string,
  monthStart: TPlainDate,
): Promise<boolean> {
  const rows = await db
    .delete(budgetOverrides)
    .where(
      and(
        eq(budgetOverrides.categoryId, categoryId),
        eq(budgetOverrides.month, monthStart),
      ),
    )
    .returning({ id: budgetOverrides.id });
  return rows.length > 0;
}

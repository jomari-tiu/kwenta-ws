import {
  firstDayOfMonth,
  lastDayOfMonth,
  monthKeyOf,
  todayInAppTz,
} from '../../common/date.js';
import { badRequest, notFound } from '../../common/errors.js';
import * as categoriesRepo from '../categories/categories.repository.js';
import * as repo from './budgets.repository.js';

export type TBudget = {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  capCentavos: number | null;
  capSource: 'default' | 'override' | 'none';
  spentCentavos: number;
  remainingCentavos: number | null;
  percentUsed: number | null;
  isOverBudget: boolean;
  /** 80-100% of cap. Drives the amber state. */
  isNearLimit: boolean;
};

export type TBudgetsResult = {
  month: string;
  budgeted: TBudget[];
  unbudgeted: TBudget[];
  totals: {
    capCentavos: number;
    spentCentavos: number;
    remainingCentavos: number;
    isOverBudget: boolean;
  };
};

function toDto(row: repo.TBudgetRow): TBudget {
  const cap = row.overrideCapCentavos ?? row.defaultCapCentavos ?? null;
  const capSource =
    row.overrideCapCentavos !== null
      ? 'override'
      : row.defaultCapCentavos !== null
        ? 'default'
        : 'none';

  const percentUsed =
    cap === null || cap === 0
      ? null
      : Math.round((row.spentCentavos / cap) * 100);

  return {
    categoryId: row.categoryId,
    name: row.name,
    icon: row.icon,
    color: row.color,
    capCentavos: cap,
    capSource,
    spentCentavos: row.spentCentavos,
    remainingCentavos: cap === null ? null : cap - row.spentCentavos,
    percentUsed,
    // spent === cap is NOT over budget. Over means strictly greater. Pinned by
    // a test, because the UI colour depends on it.
    isOverBudget: cap !== null && row.spentCentavos > cap,
    isNearLimit:
      cap !== null &&
      row.spentCentavos <= cap &&
      percentUsed !== null &&
      percentUsed >= 80,
  };
}

export async function forMonth(monthKey?: string): Promise<TBudgetsResult> {
  const month = monthKey ?? monthKeyOf(todayInAppTz());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw badRequest('month must be YYYY-MM');
  }

  const rows = await repo.budgetsForMonth(
    firstDayOfMonth(month),
    lastDayOfMonth(month),
  );
  const dtos = rows.map(toDto);

  const budgeted = dtos.filter((b) => b.capCentavos !== null);
  const unbudgeted = dtos.filter((b) => b.capCentavos === null);

  const capCentavos = budgeted.reduce((a, b) => a + (b.capCentavos ?? 0), 0);
  const spentCentavos = budgeted.reduce((a, b) => a + b.spentCentavos, 0);

  return {
    month,
    budgeted,
    unbudgeted,
    totals: {
      capCentavos,
      spentCentavos,
      remainingCentavos: capCentavos - spentCentavos,
      isOverBudget: spentCentavos > capCentavos,
    },
  };
}

async function assertExpenseCategory(categoryId: string): Promise<void> {
  const category = await categoriesRepo.findWritableCategory(categoryId);
  if (!category) throw notFound('Category not found or archived');
  if (category.kind !== 'expense') {
    throw badRequest('Only expense categories can have a budget.');
  }
}

export async function setDefault(
  categoryId: string,
  capCentavos: number | null,
): Promise<TBudgetsResult> {
  await assertExpenseCategory(categoryId);
  await repo.setDefaultCap(categoryId, capCentavos);
  return forMonth();
}

export async function setOverride(
  categoryId: string,
  monthKey: string,
  capCentavos: number,
): Promise<TBudgetsResult> {
  await assertExpenseCategory(categoryId);
  await repo.upsertOverride(categoryId, firstDayOfMonth(monthKey), capCentavos);
  return forMonth(monthKey);
}

export async function clearOverride(
  categoryId: string,
  monthKey: string,
): Promise<TBudgetsResult> {
  const removed = await repo.deleteOverride(
    categoryId,
    firstDayOfMonth(monthKey),
  );
  if (!removed) throw notFound('No override set for that category and month');
  return forMonth(monthKey);
}

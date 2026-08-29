import {
  todayInAppTz,
  monthKeyOf,
  type TPlainDate,
} from '../../common/date.js';
import * as accountsService from '../accounts/accounts.service.js';
import * as budgetsService from '../budgets/budgets.service.js';
import * as creditLoansService from '../credit-loans/credit-loans.service.js';
import * as investmentsService from '../investments/investments.service.js';
import * as installmentsService from '../installments/installments.service.js';
import * as repo from './dashboard.repository.js';
import {
  fillBuckets,
  windowFor,
  type TPeriod,
  type TSeriesPoint,
} from './dashboard.buckets.js';

export type TDashboardSummary = {
  period: TPeriod;
  label: string;
  from: string;
  to: string;
  incomeCentavos: number;
  expenseCentavos: number;
  netCentavos: number;
  savingsRatePercent: number | null;
  netBalanceAllTimeCentavos: number;
  series: TSeriesPoint[];
  topCategories: repo.TCategoryTotal[];
  accountBalances: {
    accountId: string;
    name: string;
    kind: string;
    icon: string | null;
    color: string | null;
    currentBalanceCentavos: number;
  }[];
  budgetAlerts: {
    categoryId: string;
    name: string;
    color: string | null;
    capCentavos: number;
    spentCentavos: number;
    percentUsed: number | null;
    isOverBudget: boolean;
  }[];
  installments: {
    pendingCount: number;
    overdueCount: number;
    dueSoonCount: number;
    activePlanCount: number;
    totalRemainingCentavos: number;
    nextDueDate: string | null;
  };
  investments: {
    activeCount: number;
    fundedCount: number;
    untargetedCount: number;
    totalNetContributedCentavos: number;
    /** Null when nothing is valued — a ₱0 total would read as a total loss. */
    totalCurrentValueCentavos: number | null;
    totalGainCentavos: number | null;
    nextTargetDate: string | null;
  };
  creditLoans: {
    openCount: number;
    overdueCount: number;
    /** Loans with no agreed due date — open, but never overdue. */
    undatedCount: number;
    totalOutstandingCentavos: number;
    nextDueDate: string | null;
  };
};

export async function summary(
  period: TPeriod,
  anchorInput?: TPlainDate,
): Promise<TDashboardSummary> {
  const anchor = anchorInput ?? todayInAppTz();
  const w = windowFor(period, anchor);

  // Nine independent reads in parallel; on a warm local DB this is noise.
  const [
    totals,
    seriesRows,
    topCategories,
    allTime,
    balances,
    inst,
    budgets,
    loans,
    funds,
  ] = await Promise.all([
    repo.totalsBetween(w.from, w.to),
    repo.series(w.from, w.to, w.granularity),
    repo.byCategory(w.from, w.to, 'expense'),
    repo.allTimeTotals(),
    accountsService.balances(),
    installmentsService.summary(),
    budgetsService.forMonth(monthKeyOf(anchor)),
    creditLoansService.summary(),
    investmentsService.summary(),
  ]);

  const net = totals.incomeCentavos - totals.expenseCentavos;

  return {
    period,
    label: w.label,
    from: w.from,
    to: w.to,
    incomeCentavos: totals.incomeCentavos,
    expenseCentavos: totals.expenseCentavos,
    netCentavos: net,
    savingsRatePercent:
      totals.incomeCentavos === 0
        ? null
        : Math.round((net / totals.incomeCentavos) * 100),
    netBalanceAllTimeCentavos: allTime.incomeCentavos - allTime.expenseCentavos,
    series: fillBuckets(seriesRows, w.from, w.to, w.granularity),
    topCategories: topCategories.slice(0, 8),
    accountBalances: balances.map((a) => ({
      accountId: a.id,
      name: a.name,
      kind: a.kind,
      icon: a.icon,
      color: a.color,
      currentBalanceCentavos: a.currentBalanceCentavos,
    })),
    budgetAlerts: budgets.budgeted
      .filter((b) => b.isOverBudget || b.isNearLimit)
      .slice(0, 5)
      .map((b) => ({
        categoryId: b.categoryId,
        name: b.name,
        color: b.color,
        capCentavos: b.capCentavos ?? 0,
        spentCentavos: b.spentCentavos,
        percentUsed: b.percentUsed,
        isOverBudget: b.isOverBudget,
      })),
    investments: {
      activeCount: funds.activeCount,
      fundedCount: funds.fundedCount,
      untargetedCount: funds.untargetedCount,
      totalNetContributedCentavos: funds.totalNetContributedCentavos,
      totalCurrentValueCentavos: funds.totalCurrentValueCentavos,
      totalGainCentavos: funds.totalGainCentavos,
      nextTargetDate: funds.nextTargetDate,
    },
    creditLoans: {
      openCount: loans.openCount,
      overdueCount: loans.overdueCount,
      undatedCount: loans.undatedCount,
      totalOutstandingCentavos: loans.totalOutstandingCentavos,
      nextDueDate: loans.nextDueDate,
    },
    installments: {
      pendingCount: inst.pendingCount,
      overdueCount: inst.overdueCount,
      dueSoonCount: inst.dueSoonCount,
      activePlanCount: inst.activePlanCount,
      totalRemainingCentavos: inst.totalRemainingCentavos,
      nextDueDate: inst.nextDueDate,
    },
  };
}

export async function byCategory(
  from: TPlainDate,
  to: TPlainDate,
  type: 'income' | 'expense',
): Promise<{ data: repo.TCategoryTotal[]; totalCentavos: number }> {
  const data = await repo.byCategory(from, to, type);
  return {
    data,
    totalCentavos: data.reduce((a, c) => a + c.totalCentavos, 0),
  };
}

import {
  addDays,
  todayInAppTz,
  monthKeyOf,
  type TPlainDate,
} from '../../common/date.js';
import * as accountsService from '../accounts/accounts.service.js';
import * as budgetsService from '../budgets/budgets.service.js';
import * as creditLoansService from '../credit-loans/credit-loans.service.js';
import * as investmentsService from '../investments/investments.service.js';
import * as installmentsRepo from '../installments/installments.repository.js';
import * as creditLoansRepo from '../credit-loans/credit-loans.repository.js';
import * as installmentsService from '../installments/installments.service.js';
import * as repo from './dashboard.repository.js';
import {
  fillBuckets,
  windowFor,
  type TPeriod,
  type TSeriesPoint,
} from './dashboard.buckets.js';

/**
 * A single thing the owner still owes, itemised.
 *
 * Only two things in this app have a real unpaid state: an installment payment
 * (pending until marked paid) and a credit loan (outstanding until repaid). A
 * recurring rule does NOT belong here — it assumes payment on its date and
 * writes the transaction itself, so it is never "unpaid" to begin with.
 */
export type TDueItem = {
  kind: 'installment' | 'loan';
  /** The owning plan or loan, so the UI can link to it. */
  id: string;
  name: string;
  detail: string | null;
  amountCentavos: number;
  /** Null only for a loan with no agreed date. */
  dueDate: string | null;
  status: 'overdue' | 'dueSoon' | 'upcoming' | 'undated';
  /** Negative when overdue. Null for an undated loan. */
  daysUntil: number | null;
};

const DUE_HORIZON_DAYS = 30;
const DUE_SOON_DAYS = 7;
/** Every pending payment ever, however far back — an old miss is still owed. */
const FAR_PAST = '1900-01-01';

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

async function collectDueItems(today: string): Promise<TDueItem[]> {
  const horizon = addDays(today, DUE_HORIZON_DAYS);

  const [dues, loanPage, repaid] = await Promise.all([
    installmentsRepo.listDuesBetween(FAR_PAST, horizon),
    creditLoansRepo.listLoans(500, 0),
    creditLoansRepo.repaidByLoan(),
  ]);

  const items: TDueItem[] = [];

  for (const d of dues) {
    if (d.status === 'paid') continue;
    const daysUntil = daysBetween(today, d.dueDate);
    items.push({
      kind: 'installment',
      id: d.planId,
      name: d.planName,
      detail: `Payment ${d.sequenceNo} of ${d.termMonths}`,
      amountCentavos: d.amountCentavos,
      dueDate: d.dueDate,
      status:
        daysUntil < 0
          ? 'overdue'
          : daysUntil <= DUE_SOON_DAYS
            ? 'dueSoon'
            : 'upcoming',
      daysUntil,
    });
  }

  for (const loan of loanPage.rows) {
    const outstanding = loan.principalCentavos - (repaid.get(loan.id) ?? 0);
    // Settled or closed loans are not owed, whatever their date says.
    if (outstanding <= 0 || loan.closedAt !== null) continue;

    if (loan.dueDate === null) {
      // Still owed, just never nagging. Listed last rather than hidden — an
      // undated debt is the easiest one to forget.
      items.push({
        kind: 'loan',
        id: loan.id,
        name: loan.name,
        detail: loan.lender,
        amountCentavos: outstanding,
        dueDate: null,
        status: 'undated',
        daysUntil: null,
      });
      continue;
    }

    const daysUntil = daysBetween(today, loan.dueDate);
    if (daysUntil > DUE_HORIZON_DAYS) continue;
    items.push({
      kind: 'loan',
      id: loan.id,
      name: loan.name,
      detail: loan.lender,
      amountCentavos: outstanding,
      dueDate: loan.dueDate,
      status:
        daysUntil < 0
          ? 'overdue'
          : daysUntil <= DUE_SOON_DAYS
            ? 'dueSoon'
            : 'upcoming',
      daysUntil,
    });
  }

  // Most urgent first: the longest overdue at the top, undated at the bottom
  // where it cannot push a real deadline off the list.
  const rank = { overdue: 0, dueSoon: 1, upcoming: 2, undated: 3 };
  return items.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
  );
}

export type TDashboardSummary = {
  period: TPeriod;
  label: string;
  from: string;
  to: string;
  incomeCentavos: number;
  /** Money consumed. Excludes anything moved into a savings pot. */
  spendingCentavos: number;
  /** Net moved into savings pots this period. */
  savedCentavos: number;
  /** Spending + savings — everything that left the account. */
  expenseCentavos: number;
  netCentavos: number;
  savingsRatePercent: number | null;
  netBalanceAllTimeCentavos: number;
  /** Everything still owed, most urgent first. */
  dueItems: TDueItem[];
  /**
   * Money you could actually spend right now: the balance of every live
   * account EXCEPT credit cards, whose negative balance is debt owed rather
   * than cash on hand.
   */
  disposableCentavos: number;
  /** Money currently sitting in investment pots — real, but not spendable. */
  investedCentavos: number;
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
    dueItems,
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
    collectDueItems(anchor === todayInAppTz() ? anchor : todayInAppTz()),
  ]);

  const net = totals.incomeCentavos - totals.expenseCentavos;

  return {
    period,
    label: w.label,
    from: w.from,
    to: w.to,
    incomeCentavos: totals.incomeCentavos,
    spendingCentavos: totals.spendingCentavos,
    savedCentavos: totals.savedCentavos,
    expenseCentavos: totals.expenseCentavos,
    netCentavos: net,
    // What share of income you did NOT spend — money parked in a fund counts as
    // kept, not spent. Using `net` here would punish you for saving.
    savingsRatePercent:
      totals.incomeCentavos === 0
        ? null
        : Math.round(
            ((totals.incomeCentavos - totals.spendingCentavos) /
              totals.incomeCentavos) *
              100,
          ),
    netBalanceAllTimeCentavos: allTime.incomeCentavos - allTime.expenseCentavos,
    // Always "as of today", never the browsed period: what you owe does not
    // change because you clicked back to July.
    dueItems,
    // Credit cards are excluded on purpose. Their balance is what you OWE, and
    // folding a debt into "money I can spend" understates both.
    disposableCentavos: balances
      .filter((a) => a.kind !== 'credit_card')
      .reduce((sum, a) => sum + a.currentBalanceCentavos, 0),
    investedCentavos: funds.totalNetContributedCentavos,
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

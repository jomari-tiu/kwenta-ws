import {
  addDays,
  firstDayOfMonth,
  mondayOf,
  monthKeyOf,
  todayInAppTz,
  type TPlainDate,
} from '../../common/date.js';
import { badRequest } from '../../common/errors.js';
import * as creditLoansRepo from '../credit-loans/credit-loans.repository.js';
import * as installmentsRepo from '../installments/installments.repository.js';
import * as investmentsRepo from '../investments/investments.repository.js';
import {
  deriveStatus,
  type TDerivedStatus,
} from '../installments/installments.service.js';
import { projectFuture } from '../recurring/recurring.materializer.js';
import * as recurringRepo from '../recurring/recurring.repository.js';
import * as txnRepo from '../transactions/transactions.repository.js';
import { toDto as toTransactionDto } from '../transactions/transactions.service.js';
import type { TTransaction } from '../transactions/transactions.types.js';

const DUE_SOON_DAYS = 7;

export type TCalendarDue = {
  id: string;
  planId: string;
  planName: string;
  sequenceNo: number;
  termMonths: number;
  dueDate: string;
  amountCentavos: number;
  status: 'pending' | 'paid';
  paidDate: string | null;
  derivedStatus: TDerivedStatus;
  /**
   * The expense created by marking this due paid, if any. The day panel merges
   * the due and its transaction into ONE row — otherwise the same money shows
   * twice and you stop trusting the app.
   */
  transactionId: string | null;
};

export type TCalendarLoanDue = {
  id: string;
  name: string;
  lender: string | null;
  dueDate: string;
  principalCentavos: number;
  /** Principal minus everything repaid so far — what the day actually costs. */
  outstandingCentavos: number;
  isOverdue: boolean;
};

/**
 * A savings goal landing on this day. Deliberately NOT a due: a goal you have
 * not reached is a goal you are behind on, not a debt, so it never reddens the
 * day and there is no "overdue" flag here to accidentally wire up later.
 */
export type TCalendarFundTarget = {
  id: string;
  name: string;
  provider: string | null;
  targetDate: string;
  targetCentavos: number | null;
  netContributedCentavos: number;
  isReached: boolean;
};

export type TCalendarProjection = {
  ruleId: string;
  ruleName: string;
  type: 'income' | 'expense';
  amountCentavos: number;
  date: string;
};

export type TCalendarDay = {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  incomeCentavos: number;
  expenseCentavos: number;
  netCentavos: number;
  transactionCount: number;
  /**
   * Money moved between the owner's own accounts that day. Kept apart from
   * income and expense because it is neither — folding it in would make the
   * day's net wrong.
   */
  transferCentavos: number;
  hasOverdueInstallment: boolean;
  hasDueInstallment: boolean;
  hasProjectedRecurring: boolean;
  entries: TTransaction[];
  dues: TCalendarDue[];
  loanDues: TCalendarLoanDue[];
  fundTargets: TCalendarFundTarget[];
  projections: TCalendarProjection[];
};

export type TCalendarMonth = {
  month: string;
  gridStart: string;
  gridEnd: string;
  today: string;
  days: TCalendarDay[];
  totals: {
    incomeCentavos: number;
    expenseCentavos: number;
    netCentavos: number;
  };
  projectedTotals: { incomeCentavos: number; expenseCentavos: number };
};

/** 6 rows x 7 days, always. A variable row count makes the page height jump. */
function buildGrid(monthKey: string): TPlainDate[] {
  const gridStart = mondayOf(firstDayOfMonth(monthKey));
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export async function getMonth(monthKey: string): Promise<TCalendarMonth> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw badRequest('month must be YYYY-MM');
  }

  const today = todayInAppTz();
  const cutoff = addDays(today, DUE_SOON_DAYS);
  const grid = buildGrid(monthKey);
  const gridStart = grid[0]!;
  const gridEnd = grid[41]!;

  const [entries, dues, rules, loanDues, repaidByLoan, fundTargets, fundFlows] =
    await Promise.all([
      txnRepo.listJoinedBetween(gridStart, gridEnd),
      installmentsRepo.listDuesBetween(gridStart, gridEnd),
      recurringRepo.listMaterializable(),
      // Loans with NO due date are simply absent here — they can never be
      // overdue and have no day to sit on.
      creditLoansRepo.listDuesBetween(gridStart, gridEnd),
      creditLoansRepo.repaidByLoan(),
      investmentsRepo.listTargetsBetween(gridStart, gridEnd),
      investmentsRepo.flowsByInvestment(),
    ]);

  const entriesByDay = new Map<string, TTransaction[]>();
  for (const row of entries) {
    const list = entriesByDay.get(row.txnDate) ?? [];
    list.push(toTransactionDto(row));
    entriesByDay.set(row.txnDate, list);
  }

  const duesByDay = new Map<string, TCalendarDue[]>();
  for (const d of dues) {
    const list = duesByDay.get(d.dueDate) ?? [];
    list.push({
      id: d.id,
      planId: d.planId,
      planName: d.planName,
      sequenceNo: d.sequenceNo,
      termMonths: d.termMonths,
      dueDate: d.dueDate,
      amountCentavos: d.amountCentavos,
      status: d.status,
      paidDate: d.paidDate,
      derivedStatus: deriveStatus(d, today, cutoff),
      transactionId: d.transactionId,
    });
    duesByDay.set(d.dueDate, list);
  }

  const loanDuesByDay = new Map<string, TCalendarLoanDue[]>();
  for (const l of loanDues) {
    // A loan you have already paid off is not a due, even if nobody got round
    // to closing it — otherwise its day stays red forever.
    const outstandingCentavos =
      l.principalCentavos - (repaidByLoan.get(l.id) ?? 0);
    if (outstandingCentavos <= 0) continue;

    const list = loanDuesByDay.get(l.dueDate) ?? [];
    list.push({
      id: l.id,
      name: l.name,
      lender: l.lender,
      dueDate: l.dueDate,
      principalCentavos: l.principalCentavos,
      outstandingCentavos,
      isOverdue: l.dueDate < today,
    });
    loanDuesByDay.set(l.dueDate, list);
  }

  const fundTargetsByDay = new Map<string, TCalendarFundTarget[]>();
  for (const t of fundTargets) {
    const flow = fundFlows.get(t.id) ?? { contributed: 0, withdrawn: 0 };
    const netContributedCentavos = flow.contributed - flow.withdrawn;
    const list = fundTargetsByDay.get(t.targetDate) ?? [];
    list.push({
      id: t.id,
      name: t.name,
      provider: t.provider,
      targetDate: t.targetDate,
      targetCentavos: t.targetCentavos,
      netContributedCentavos,
      isReached:
        t.targetCentavos !== null && netContributedCentavos >= t.targetCentavos,
    });
    fundTargetsByDay.set(t.targetDate, list);
  }

  const projectionsByDay = new Map<string, TCalendarProjection[]>();
  for (const { rule, date } of projectFuture(
    rules,
    gridStart,
    gridEnd,
    today,
  )) {
    const list = projectionsByDay.get(date) ?? [];
    list.push({
      ruleId: rule.id,
      ruleName: rule.name,
      type: rule.type,
      amountCentavos: rule.amountCentavos,
      date,
    });
    projectionsByDay.set(date, list);
  }

  let monthIncome = 0;
  let monthExpense = 0;
  let projIncome = 0;
  let projExpense = 0;

  const days: TCalendarDay[] = grid.map((date) => {
    const dayEntries = entriesByDay.get(date) ?? [];
    const dayDues = duesByDay.get(date) ?? [];
    const dayProjections = projectionsByDay.get(date) ?? [];
    const dayLoanDues = loanDuesByDay.get(date) ?? [];
    const dayFundTargets = fundTargetsByDay.get(date) ?? [];
    const inMonth = monthKeyOf(date) === monthKey;

    const incomeCentavos = dayEntries
      .filter((e) => e.type === 'income')
      .reduce((a, e) => a + e.amountCentavos, 0);
    const expenseCentavos = dayEntries
      .filter((e) => e.type === 'expense')
      .reduce((a, e) => a + e.amountCentavos, 0);
    const transferCentavos = dayEntries
      .filter((e) => e.type === 'transfer')
      .reduce((a, e) => a + e.amountCentavos, 0);

    if (inMonth) {
      monthIncome += incomeCentavos;
      monthExpense += expenseCentavos;
      for (const p of dayProjections) {
        if (p.type === 'income') projIncome += p.amountCentavos;
        else projExpense += p.amountCentavos;
      }
    }

    return {
      date,
      inMonth,
      isToday: date === today,
      incomeCentavos,
      expenseCentavos,
      netCentavos: incomeCentavos - expenseCentavos,
      transactionCount: dayEntries.length,
      transferCentavos,
      // This is what paints the day RED.
      // What paints the day RED: an overdue installment payment OR an overdue
      // credit loan. A loan with no due date has no day and can never land here.
      hasOverdueInstallment:
        dayDues.some((d) => d.derivedStatus === 'overdue') ||
        dayLoanDues.some((l) => l.isOverdue),
      hasDueInstallment: dayDues.length > 0 || dayLoanDues.length > 0,
      hasProjectedRecurring: dayProjections.length > 0,
      entries: dayEntries,
      dues: dayDues,
      loanDues: dayLoanDues,
      fundTargets: dayFundTargets,
      projections: dayProjections,
    };
  });

  return {
    month: monthKey,
    gridStart,
    gridEnd,
    today,
    days,
    totals: {
      incomeCentavos: monthIncome,
      expenseCentavos: monthExpense,
      netCentavos: monthIncome - monthExpense,
    },
    // Kept SEPARATE from totals. Folding a forecast into net balance would make
    // the headline number a fiction.
    projectedTotals: {
      incomeCentavos: projIncome,
      expenseCentavos: projExpense,
    },
  };
}

/** Convenience for a single day, reusing the month assembly. */
export async function getDay(date: TPlainDate): Promise<TCalendarDay> {
  const month = await getMonth(monthKeyOf(date));
  const day = month.days.find((d) => d.date === date);
  if (!day) throw badRequest('date is outside the requested month grid');
  return day;
}

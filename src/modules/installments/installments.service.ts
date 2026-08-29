import { addDays, todayInAppTz, type TPlainDate } from '../../common/date.js';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginatedResult } from '../../common/types.js';
import * as accountsRepo from '../accounts/accounts.repository.js';
import * as categoriesRepo from '../categories/categories.repository.js';
import * as repo from './installments.repository.js';
import type {
  TCreatePlanBody,
  TDeletePlanQuery,
  TListPlansQuery,
  TPayPaymentBody,
  TPreviewScheduleBody,
  TUpdatePlanBody,
} from './installments.schema.js';
import {
  generateSchedule,
  type TScheduledPayment,
} from './installments.split.js';

/** How far ahead counts as "due soon". */
const DUE_SOON_DAYS = 7;

export type TDerivedStatus = 'paid' | 'overdue' | 'dueSoon' | 'pending';

export type TPayment = {
  id: string;
  sequenceNo: number;
  dueDate: string;
  amountCentavos: number;
  status: 'pending' | 'paid';
  paidDate: string | null;
  derivedStatus: TDerivedStatus;
};

export type TPlan = {
  id: string;
  name: string;
  merchant: string | null;
  totalCentavos: number;
  termMonths: number;
  startDate: string;
  dayOfMonth: number;
  categoryId: string;
  accountId: string;
  note: string | null;
  paidCount: number;
  paidCentavos: number;
  remainingCentavos: number;
  percentPaid: number;
  nextDueDate: string | null;
  overdueCount: number;
  isCompleted: boolean;
};

/**
 * Derived, never stored — a stored `overdue` goes stale at midnight. `today`
 * comes from the app timezone so the client's own string comparison agrees.
 */
export function deriveStatus(
  payment: { status: 'pending' | 'paid'; dueDate: string },
  today: TPlainDate,
  dueSoonCutoff: TPlainDate,
): TDerivedStatus {
  if (payment.status === 'paid') return 'paid';
  if (payment.dueDate < today) return 'overdue';
  if (payment.dueDate <= dueSoonCutoff) return 'dueSoon';
  return 'pending';
}

function toPaymentDto(
  row: repo.TPaymentRow,
  today: TPlainDate,
  cutoff: TPlainDate,
): TPayment {
  return {
    id: row.id,
    sequenceNo: row.sequenceNo,
    dueDate: row.dueDate,
    amountCentavos: row.amountCentavos,
    status: row.status,
    paidDate: row.paidDate,
    derivedStatus: deriveStatus(row, today, cutoff),
  };
}

function toPlanDto(
  row: repo.TPlanRow,
  progress: repo.TPlanProgress | undefined,
): TPlan {
  const paidCount = progress?.paidCount ?? 0;
  const paidCentavos = progress?.paidCentavos ?? 0;
  return {
    id: row.id,
    name: row.name,
    merchant: row.merchant,
    totalCentavos: row.totalCentavos,
    termMonths: row.termMonths,
    startDate: row.startDate,
    dayOfMonth: row.dayOfMonth,
    categoryId: row.categoryId,
    accountId: row.accountId,
    note: row.note,
    paidCount,
    paidCentavos,
    remainingCentavos: row.totalCentavos - paidCentavos,
    percentPaid:
      row.totalCentavos === 0
        ? 0
        : Math.round((paidCentavos / row.totalCentavos) * 100),
    nextDueDate: progress?.nextDueDate ?? null,
    overdueCount: progress?.overdueCount ?? 0,
    isCompleted: paidCount >= row.termMonths,
  };
}

/**
 * The preview endpoint calls the SAME pure function the create path uses, so a
 * client preview can never disagree with what gets saved.
 */
export function preview(body: TPreviewScheduleBody): TScheduledPayment[] {
  if (body.totalCentavos < body.termMonths) {
    throw badRequest('Total must be at least 1 centavo per month.');
  }
  return generateSchedule(body);
}

export async function list(
  query: TListPlansQuery,
): Promise<TPaginatedResult<TPlan>> {
  const today = todayInAppTz();
  const { page, size, limit, offset } = resolvePagination(
    query.pageNumber,
    query.pageSize,
  );

  const [{ rows, total }, progress] = await Promise.all([
    repo.listPlans(limit, offset),
    repo.progressByPlan(today),
  ]);

  let dtos = rows.map((r) => toPlanDto(r, progress.get(r.id)));
  if (query.status === 'active') dtos = dtos.filter((p) => !p.isCompleted);
  if (query.status === 'completed') dtos = dtos.filter((p) => p.isCompleted);

  return { data: dtos, meta: buildPaginationMeta(total, page, size) };
}

export async function summary(): Promise<repo.TInstallmentSummary> {
  const today = todayInAppTz();
  return repo.summary(today, addDays(today, DUE_SOON_DAYS));
}

export async function getById(
  id: string,
): Promise<TPlan & { payments: TPayment[] }> {
  const today = todayInAppTz();
  const cutoff = addDays(today, DUE_SOON_DAYS);

  const row = await repo.findPlanById(id);
  if (!row) throw notFound('Installment plan not found');

  const [progress, payments] = await Promise.all([
    repo.progressByPlan(today),
    repo.listPaymentsForPlan(id),
  ]);

  return {
    ...toPlanDto(row, progress.get(id)),
    payments: payments.map((p) => toPaymentDto(p, today, cutoff)),
  };
}

async function assertRefs(
  categoryId: string,
  accountId: string,
): Promise<void> {
  const [category, account] = await Promise.all([
    categoriesRepo.findWritableCategory(categoryId),
    accountsRepo.findWritableAccount(accountId),
  ]);
  if (!category) throw badRequest('Category not found or archived.');
  if (category.kind !== 'expense') {
    throw badRequest('An installment plan needs an expense category.');
  }
  if (!account) throw badRequest('Account not found or archived.');
}

export async function create(
  body: TCreatePlanBody,
): Promise<TPlan & { payments: TPayment[] }> {
  await assertRefs(body.categoryId, body.accountId);
  const schedule = preview(body);

  const { plan } = await repo.insertPlanWithSchedule(
    {
      name: body.name,
      merchant: body.merchant ?? null,
      totalCentavos: body.totalCentavos,
      termMonths: body.termMonths,
      startDate: body.startDate,
      dayOfMonth: body.dayOfMonth,
      categoryId: body.categoryId,
      accountId: body.accountId,
      note: body.note ?? null,
    },
    schedule,
  );

  return getById(plan.id);
}

const SCHEDULE_FIELDS = [
  'totalCentavos',
  'termMonths',
  'startDate',
  'dayOfMonth',
] as const;

export async function update(
  id: string,
  body: TUpdatePlanBody,
): Promise<TPlan & { payments: TPayment[] }> {
  const existing = await repo.findPlanById(id);
  if (!existing) throw notFound('Installment plan not found');

  if (body.categoryId ?? body.accountId) {
    await assertRefs(
      body.categoryId ?? existing.categoryId,
      body.accountId ?? existing.accountId,
    );
  }

  const touchesSchedule = SCHEDULE_FIELDS.some(
    (f) => body[f] !== undefined && body[f] !== existing[f],
  );

  if (!touchesSchedule) {
    await repo.updatePlanMetadata(id, body);
    return getById(id);
  }

  // Repricing a partially-paid plan has no obviously-right answer (re-amortize
  // the remainder? adjust the last payment? what about the expenses already
  // created?). Refuse it and say why.
  const paid = await repo.countPaid(id);
  if (paid > 0) {
    throw conflict(
      `Cannot change the schedule: ${paid} payment(s) are already marked paid. Unmark them first, or create a new plan.`,
    );
  }

  const next = {
    totalCentavos: body.totalCentavos ?? existing.totalCentavos,
    termMonths: body.termMonths ?? existing.termMonths,
    startDate: body.startDate ?? existing.startDate,
    dayOfMonth: body.dayOfMonth ?? existing.dayOfMonth,
  };
  const schedule = preview(next);
  await repo.replaceSchedule(id, { ...body, ...next }, schedule);
  return getById(id);
}

export async function remove(
  id: string,
  query: TDeletePlanQuery,
): Promise<{
  deletedPlanId: string;
  deletedPaymentCount: number;
  deletedTransactionCount: number;
}> {
  const existing = await repo.findPlanById(id);
  if (!existing) throw notFound('Installment plan not found');

  const result = await repo.deletePlan(id, query.deleteGeneratedTransactions);
  return { deletedPlanId: id, ...result };
}

export async function pay(
  planId: string,
  paymentId: string,
  body: TPayPaymentBody,
): Promise<{ payment: TPayment; transactionId: string }> {
  const today = todayInAppTz();
  const cutoff = addDays(today, DUE_SOON_DAYS);

  const [plan, payment] = await Promise.all([
    repo.findPlanById(planId),
    repo.findPaymentById(paymentId),
  ]);
  if (!plan) throw notFound('Installment plan not found');
  if (!payment || payment.planId !== planId) {
    throw notFound('Installment payment not found for this plan');
  }

  const accountId = body.accountId ?? plan.accountId;
  if (body.accountId) {
    const account = await accountsRepo.findWritableAccount(body.accountId);
    if (!account) throw badRequest('Account not found or archived.');
  }

  const result = await repo.payPayment({
    paymentId,
    plan,
    paidDate: body.paidDate ?? today,
    amountCentavos: body.amountCentavos ?? payment.amountCentavos,
    accountId,
    note: `${plan.name} — ${payment.sequenceNo}/${plan.termMonths}`,
  });

  if (result === 'already_paid') {
    throw conflict('That payment is already marked paid.');
  }

  return {
    payment: toPaymentDto(result.payment, today, cutoff),
    transactionId: result.transactionId,
  };
}

export async function unpay(
  planId: string,
  paymentId: string,
): Promise<{
  payment: TPayment;
  deletedTransaction: {
    id: string;
    amountCentavos: number;
    txnDate: string;
  } | null;
}> {
  const today = todayInAppTz();
  const cutoff = addDays(today, DUE_SOON_DAYS);

  const payment = await repo.findPaymentById(paymentId);
  if (!payment || payment.planId !== planId) {
    throw notFound('Installment payment not found for this plan');
  }

  const result = await repo.unpayPayment(paymentId);
  if (result === 'not_paid') {
    throw conflict('That payment is not marked paid.');
  }

  return {
    payment: toPaymentDto(result.payment, today, cutoff),
    deletedTransaction: result.deleted,
  };
}

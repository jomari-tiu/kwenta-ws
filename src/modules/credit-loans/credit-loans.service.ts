import { todayInAppTz, type TPlainDate } from '../../common/date.js';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginatedResult } from '../../common/types.js';
import * as accountsRepo from '../accounts/accounts.repository.js';
import * as categoriesRepo from '../categories/categories.repository.js';
import * as repo from './credit-loans.repository.js';
import type {
  TCreateCreditLoanBody,
  TListCreditLoansQuery,
  TRepayCreditLoanBody,
  TUpdateCreditLoanBody,
} from './credit-loans.schema.js';

/** Derived, never stored — same reasoning as installment payment status. */
export type TLoanStatus = 'settled' | 'overdue' | 'dueSoon' | 'open';

const DUE_SOON_DAYS = 7;

export type TCreditLoan = {
  id: string;
  name: string;
  lender: string | null;
  principalCentavos: number;
  repaidCentavos: number;
  outstandingCentavos: number;
  percentRepaid: number;
  /** null means no agreed date — NOT overdue, and never rendered as a date. */
  dueDate: string | null;
  categoryId: string;
  accountId: string;
  note: string | null;
  isSettled: boolean;
  status: TLoanStatus;
};

export function deriveStatus(
  loan: { dueDate: string | null; closedAt: string | null },
  outstandingCentavos: number,
  today: TPlainDate,
  dueSoonCutoff: TPlainDate,
): TLoanStatus {
  if (outstandingCentavos <= 0 || loan.closedAt !== null) return 'settled';
  // A loan with no agreed date can never be overdue. Treating null as "due
  // now" would nag the owner about something they never promised.
  if (loan.dueDate === null) return 'open';
  if (loan.dueDate < today) return 'overdue';
  if (loan.dueDate <= dueSoonCutoff) return 'dueSoon';
  return 'open';
}

function toDto(
  row: repo.TCreditLoanRow,
  repaidCentavos: number,
  today: TPlainDate,
  cutoff: TPlainDate,
): TCreditLoan {
  const outstanding = Math.max(0, row.principalCentavos - repaidCentavos);
  const status = deriveStatus(row, outstanding, today, cutoff);
  return {
    id: row.id,
    name: row.name,
    lender: row.lender,
    principalCentavos: row.principalCentavos,
    repaidCentavos,
    outstandingCentavos: outstanding,
    percentRepaid:
      row.principalCentavos === 0
        ? 0
        : Math.min(
            100,
            Math.round((repaidCentavos / row.principalCentavos) * 100),
          ),
    dueDate: row.dueDate,
    categoryId: row.categoryId,
    accountId: row.accountId,
    note: row.note,
    isSettled: status === 'settled',
    status,
  };
}

function addDaysTo(date: TPlainDate, days: number): TPlainDate {
  const t = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
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
    throw badRequest('A credit loan needs an expense category.');
  }
  if (!account) throw badRequest('Account not found or archived.');
}

export async function list(
  query: TListCreditLoansQuery,
): Promise<TPaginatedResult<TCreditLoan>> {
  const today = todayInAppTz();
  const cutoff = addDaysTo(today, DUE_SOON_DAYS);
  const { page, size, limit, offset } = resolvePagination(
    query.pageNumber,
    query.pageSize,
  );

  const [{ rows, total }, repaid] = await Promise.all([
    repo.listLoans(limit, offset),
    repo.repaidByLoan(),
  ]);

  let data = rows.map((r) => toDto(r, repaid.get(r.id) ?? 0, today, cutoff));
  if (query.status === 'open') data = data.filter((l) => !l.isSettled);
  if (query.status === 'settled') data = data.filter((l) => l.isSettled);

  return { data, meta: buildPaginationMeta(total, page, size) };
}

export async function summary(): Promise<repo.TCreditLoanSummary> {
  return repo.summary(todayInAppTz());
}

export async function getById(
  id: string,
): Promise<TCreditLoan & { repayments: repo.TLoanRepayment[] }> {
  const today = todayInAppTz();
  const cutoff = addDaysTo(today, DUE_SOON_DAYS);

  const row = await repo.findLoanById(id);
  if (!row) throw notFound('Credit loan not found');

  const [repaid, repayments] = await Promise.all([
    repo.repaidByLoan(),
    repo.listRepayments(id),
  ]);

  return {
    ...toDto(row, repaid.get(id) ?? 0, today, cutoff),
    repayments,
  };
}

export async function create(
  body: TCreateCreditLoanBody,
): Promise<TCreditLoan> {
  await assertRefs(body.categoryId, body.accountId);
  const row = await repo.insertLoan({
    name: body.name,
    lender: body.lender ?? null,
    principalCentavos: body.principalCentavos,
    // Explicitly null when omitted — an absent due date is a real state.
    dueDate: body.dueDate ?? null,
    categoryId: body.categoryId,
    accountId: body.accountId,
    note: body.note ?? null,
  });
  const today = todayInAppTz();
  return toDto(row, 0, today, addDaysTo(today, DUE_SOON_DAYS));
}

export async function update(
  id: string,
  body: TUpdateCreditLoanBody,
): Promise<TCreditLoan> {
  const existing = await repo.findLoanById(id);
  if (!existing) throw notFound('Credit loan not found');

  if (body.categoryId ?? body.accountId) {
    await assertRefs(
      body.categoryId ?? existing.categoryId,
      body.accountId ?? existing.accountId,
    );
  }

  // `dueDate: null` must be able to CLEAR the date, so only skip the key when
  // it is genuinely absent from the payload.
  const patch: Partial<repo.TCreditLoanInsert> = { ...body };
  if (body.dueDate === undefined) delete patch.dueDate;

  const row = await repo.updateLoan(id, patch);
  if (!row) throw notFound('Credit loan not found');

  const repaid = await repo.repaidByLoan();
  const today = todayInAppTz();
  return toDto(
    row,
    repaid.get(id) ?? 0,
    today,
    addDaysTo(today, DUE_SOON_DAYS),
  );
}

export async function remove(
  id: string,
): Promise<{ deletedLoanId: string; keptTransactionCount: number }> {
  const existing = await repo.findLoanById(id);
  if (!existing) throw notFound('Credit loan not found');
  const { keptTransactionCount } = await repo.deleteLoan(id);
  return { deletedLoanId: id, keptTransactionCount };
}

/** Undo a repayment. The loan's balance is derived, so it simply goes back up. */
export async function removeRepayment(
  id: string,
  transactionId: string,
): Promise<TCreditLoan & { repayments: repo.TLoanRepayment[] }> {
  const loan = await repo.findLoanById(id);
  if (!loan) throw notFound('Credit loan not found');

  const deleted = await repo.deleteRepayment(id, transactionId);
  if (!deleted) throw notFound('Repayment not found on this loan');

  return getById(id);
}

export async function repay(
  id: string,
  body: TRepayCreditLoanBody,
): Promise<{ loan: TCreditLoan; transactionId: string }> {
  const loan = await repo.findLoanById(id);
  if (!loan) throw notFound('Credit loan not found');

  const repaidMap = await repo.repaidByLoan();
  const outstanding = loan.principalCentavos - (repaidMap.get(id) ?? 0);
  if (outstanding <= 0) {
    throw conflict('This loan is already fully repaid.');
  }
  if (body.amountCentavos > outstanding) {
    throw badRequest(
      'That is more than the outstanding balance. Reduce the amount, or edit the principal if the loan grew.',
    );
  }

  const accountId = body.accountId ?? loan.accountId;
  if (body.accountId) {
    const account = await accountsRepo.findWritableAccount(body.accountId);
    if (!account) throw badRequest('Account not found or archived.');
  }

  const { transactionId } = await repo.insertRepayment({
    loan,
    amountCentavos: body.amountCentavos,
    paidDate: body.paidDate ?? todayInAppTz(),
    accountId,
    note: body.note?.trim() ? body.note.trim() : `${loan.name} — repayment`,
  });

  return { loan: await getById(id), transactionId };
}

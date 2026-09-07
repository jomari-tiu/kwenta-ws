import { todayInAppTz, type TPlainDate } from '../../common/date.js';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginatedResult } from '../../common/types.js';
import * as accountsRepo from '../accounts/accounts.repository.js';
import * as businessesRepo from '../businesses/businesses.repository.js';
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
  /** Null when the debt is personal. Set means repayments are business costs. */
  businessId: string | null;
  businessName: string | null;
  /**
   * Where a repayment will actually be drawn from, decided by the server.
   *
   * A business that keeps its own account must pay its own costs from it, or
   * `expected === actual` stops proving anything — so the client renders this
   * as fixed text rather than a picker, instead of silently overriding a
   * choice the owner thought they had made.
   */
  repayAccountId: string;
  isRepayAccountFixed: boolean;
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

type TBusinessInfo = { name: string; accountId: string | null };
/** Business id → what the repay path needs to know about it. */
type TBusinessMap = Map<string, TBusinessInfo>;

/**
 * Closed businesses are INCLUDED. A loan can outlive the business that took it
 * on, and a repayment against a wound-up shop still has to name it correctly
 * rather than render a blank where the business used to be.
 */
async function businessMap(): Promise<TBusinessMap> {
  const { rows } = await businessesRepo.listBusinesses(true, 500, 0);
  return new Map(
    rows.map((b) => [b.id, { name: b.name, accountId: b.accountId }]),
  );
}

/**
 * Which account a repayment comes out of.
 *
 * A business with its OWN account must pay from it — that is the constraint
 * `businesses.addEntry` already enforces, and the one that keeps the
 * reconciliation check able to prove anything. Everything else falls back to
 * the loan's own default.
 */
function resolveRepayAccount(
  row: repo.TCreditLoanRow,
  businesses: TBusinessMap,
): { accountId: string; isFixed: boolean } {
  const ownAccountId = row.businessId
    ? (businesses.get(row.businessId)?.accountId ?? null)
    : null;
  return ownAccountId === null
    ? { accountId: row.accountId, isFixed: false }
    : { accountId: ownAccountId, isFixed: true };
}

function toDto(
  row: repo.TCreditLoanRow,
  repaidCentavos: number,
  today: TPlainDate,
  cutoff: TPlainDate,
  businesses: TBusinessMap,
): TCreditLoan {
  const outstanding = Math.max(0, row.principalCentavos - repaidCentavos);
  const status = deriveStatus(row, outstanding, today, cutoff);
  const repayAccount = resolveRepayAccount(row, businesses);
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
    businessId: row.businessId,
    businessName: row.businessId
      ? (businesses.get(row.businessId)?.name ?? null)
      : null,
    repayAccountId: repayAccount.accountId,
    isRepayAccountFixed: repayAccount.isFixed,
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

/**
 * A loan's category must match the set of books it belongs to, exactly as
 * `businesses.addEntry` requires — repayments are stamped with `businessId`,
 * so a personal category on a business loan would file a business cost under a
 * personal heading and keep the two sets of books from staying apart.
 *
 * The check runs in both directions: a business category on a PERSONAL loan is
 * equally wrong, and would be invisible rather than merely misfiled, since the
 * dashboard's category breakdown excludes business-tagged rows outright.
 */
async function assertRefs(
  categoryId: string,
  accountId: string,
  businessId: string | null,
): Promise<void> {
  const [category, account, business] = await Promise.all([
    categoriesRepo.findWritableCategory(categoryId),
    accountsRepo.findWritableAccount(accountId),
    businessId ? businessesRepo.findBusinessById(businessId) : null,
  ]);
  if (!category) throw badRequest('Category not found or archived.');
  if (category.kind !== 'expense') {
    throw badRequest('A credit loan needs an expense category.');
  }
  if (!account) throw badRequest('Account not found or archived.');

  if (businessId) {
    if (!business) throw badRequest('Business not found.');
    if (business.closedAt !== null) {
      throw badRequest(
        `${business.name} is closed. Reopen it before filing a loan against it.`,
      );
    }
    if (category.scope !== 'business') {
      throw badRequest(
        'A business loan needs a business category. Personal categories keep the two sets of books apart.',
      );
    }
    return;
  }

  if (category.scope !== 'personal') {
    throw badRequest(
      'That is a business category. Pick the business this loan belongs to, or choose a personal category.',
    );
  }
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

  const [{ rows, total }, repaid, businesses] = await Promise.all([
    repo.listLoans(limit, offset),
    repo.repaidByLoan(),
    businessMap(),
  ]);

  let data = rows.map((r) =>
    toDto(r, repaid.get(r.id) ?? 0, today, cutoff, businesses),
  );
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

  const [repaid, repayments, businesses] = await Promise.all([
    repo.repaidByLoan(),
    repo.listRepayments(id),
    businessMap(),
  ]);

  return {
    ...toDto(row, repaid.get(id) ?? 0, today, cutoff, businesses),
    repayments,
  };
}

export async function create(
  body: TCreateCreditLoanBody,
): Promise<TCreditLoan> {
  await assertRefs(body.categoryId, body.accountId, body.businessId ?? null);
  const row = await repo.insertLoan({
    name: body.name,
    lender: body.lender ?? null,
    principalCentavos: body.principalCentavos,
    // Explicitly null when omitted — an absent due date is a real state.
    dueDate: body.dueDate ?? null,
    categoryId: body.categoryId,
    accountId: body.accountId,
    businessId: body.businessId ?? null,
    note: body.note ?? null,
  });
  const today = todayInAppTz();
  return toDto(
    row,
    0,
    today,
    addDaysTo(today, DUE_SOON_DAYS),
    await businessMap(),
  );
}

export async function update(
  id: string,
  body: TUpdateCreditLoanBody,
): Promise<TCreditLoan> {
  const existing = await repo.findLoanById(id);
  if (!existing) throw notFound('Credit loan not found');

  const nextBusinessId =
    body.businessId === undefined
      ? existing.businessId
      : (body.businessId ?? null);

  /**
   * Moving a loan between the personal and business books is blocked once it
   * has repayments, for the reason `businesses.update` blocks an account
   * change: the repayments already in the ledger carry the OLD tag, so the
   * loan would claim one set of books while its history sits in another.
   *
   * Re-tagging them instead would silently move past money between the
   * personal and business books, changing the dashboard for every period those
   * repayments fall in. Better to make the owner unwind it deliberately.
   */
  if (nextBusinessId !== existing.businessId) {
    const repaidSoFar = await repo.repaidByLoan();
    if ((repaidSoFar.get(id) ?? 0) > 0) {
      throw conflict(
        'This loan already has repayments recorded, so it cannot be moved between personal and business. Remove them first, or add a new loan.',
      );
    }
  }

  // Re-validate whenever ANY of the three interlocking refs moves: changing
  // only the business still changes which category scope is legal.
  if (
    body.categoryId !== undefined ||
    body.accountId !== undefined ||
    body.businessId !== undefined
  ) {
    await assertRefs(
      body.categoryId ?? existing.categoryId,
      body.accountId ?? existing.accountId,
      nextBusinessId,
    );
  }

  // `dueDate: null` must be able to CLEAR the date, so only skip the key when
  // it is genuinely absent from the payload. `businessId` is the same: null
  // means "move this back to personal", absent means "leave it alone".
  const patch: Partial<repo.TCreditLoanInsert> = { ...body };
  if (body.dueDate === undefined) delete patch.dueDate;
  if (body.businessId === undefined) delete patch.businessId;

  const row = await repo.updateLoan(id, patch);
  if (!row) throw notFound('Credit loan not found');

  const [repaid, businesses] = await Promise.all([
    repo.repaidByLoan(),
    businessMap(),
  ]);
  const today = todayInAppTz();
  return toDto(
    row,
    repaid.get(id) ?? 0,
    today,
    addDaysTo(today, DUE_SOON_DAYS),
    businesses,
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

  /**
   * A business that keeps its own account pays its own costs from it, and the
   * caller's choice is not consulted — the same rule `businesses.addEntry`
   * applies, and the reason is the same: let a business cost leave a personal
   * wallet and `expected === actual` stops being able to prove anything.
   *
   * This is not a silent override. `isRepayAccountFixed` on the DTO tells the
   * client to render the account as fixed text rather than a picker, so the
   * owner sees where the money is coming from before they confirm.
   */
  const businesses = await businessMap();
  const fixed = resolveRepayAccount(loan, businesses);

  const accountId = fixed.isFixed
    ? fixed.accountId
    : (body.accountId ?? loan.accountId);

  if (!fixed.isFixed && body.accountId) {
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

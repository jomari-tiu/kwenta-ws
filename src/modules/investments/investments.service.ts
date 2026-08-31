import { todayInAppTz } from '../../common/date.js';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginatedResult } from '../../common/types.js';
import type { TInvestmentKind } from '../../db/schema/investments.js';
import * as accountsRepo from '../accounts/accounts.repository.js';
import * as categoriesRepo from '../categories/categories.repository.js';
import * as repo from './investments.repository.js';
import type {
  TContributeBody,
  TCreateInvestmentBody,
  TListInvestmentsQuery,
  TUpdateInvestmentBody,
  TWithdrawBody,
} from './investments.schema.js';

/** Derived, never stored — same reasoning as loan and installment status. */
export type TInvestmentStatus = 'closed' | 'funded' | 'active';

export type TInvestment = {
  id: string;
  name: string;
  provider: string | null;
  kind: TInvestmentKind;
  contributedCentavos: number;
  withdrawnCentavos: number;
  netContributedCentavos: number;
  targetCentavos: number | null;
  /**
   * What the pot actually holds: the hand-entered valuation when there is one,
   * otherwise what has been contributed through the app. This is what progress
   * is measured against — a fund you have told the app is worth ₱50,000 is
   * halfway to a ₱100,000 goal whether or not those contributions were logged
   * here, and reading 0% in that case is simply wrong.
   */
  heldCentavos: number;
  /**
   * Money in this pot that the app never saw arrive: its valuation minus what
   * was contributed here, floored at zero. Zero when unvalued — an unvalued
   * fund is known only by what went in, so nothing is unaccounted for.
   *
   * Derived HERE rather than in the UI so the card, the dialog and the summary
   * tile cannot drift apart, which is precisely how this figure went wrong.
   */
  untrackedCentavos: number;
  /** Null when there is no target — the UI shows no progress bar at all. */
  percentToTarget: number | null;
  targetDate: string | null;
  currentValueCentavos: number | null;
  valueAsOf: string | null;
  categoryId: string;
  accountId: string;
  note: string | null;
  isClosed: boolean;
  status: TInvestmentStatus;
};

export function deriveStatus(
  row: { targetCentavos: number | null; closedAt: string | null },
  netContributedCentavos: number,
): TInvestmentStatus {
  if (row.closedAt !== null) return 'closed';
  // A fund with no target can never be "funded" — there is nothing to reach.
  // Calling it done at an arbitrary number would be the app inventing a goal.
  if (row.targetCentavos === null) return 'active';
  return netContributedCentavos >= row.targetCentavos ? 'funded' : 'active';
}

function toDto(row: repo.TInvestmentRow, flows: repo.TFlows): TInvestment {
  const net = flows.contributed - flows.withdrawn;
  // A valuation, once given, is the better answer to "how much is in there" —
  // it accounts for contributions made before this app existed, and for growth.
  const held = row.currentValueCentavos ?? net;
  const status = deriveStatus(row, net);

  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    kind: row.kind,
    contributedCentavos: flows.contributed,
    withdrawnCentavos: flows.withdrawn,
    netContributedCentavos: net,
    targetCentavos: row.targetCentavos,
    heldCentavos: held,
    untrackedCentavos:
      row.currentValueCentavos === null
        ? 0
        : Math.max(0, row.currentValueCentavos - net),
    percentToTarget:
      row.targetCentavos === null || row.targetCentavos === 0
        ? null
        : Math.max(
            0,
            Math.min(100, Math.round((held / row.targetCentavos) * 100)),
          ),
    targetDate: row.targetDate,
    currentValueCentavos: row.currentValueCentavos,
    valueAsOf: row.valueAsOf,
    categoryId: row.categoryId,
    accountId: row.accountId,
    note: row.note,
    isClosed: status === 'closed',
    status,
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
    throw badRequest('Contributions need an expense category.');
  }
  if (!account) throw badRequest('Account not found or archived.');
}

export async function list(
  query: TListInvestmentsQuery,
): Promise<TPaginatedResult<TInvestment>> {
  const { page, size, limit, offset } = resolvePagination(
    query.pageNumber,
    query.pageSize,
  );

  const [{ rows, total }, flows] = await Promise.all([
    repo.listInvestments(limit, offset),
    repo.flowsByInvestment(),
  ]);

  let data = rows.map((r) =>
    toDto(r, flows.get(r.id) ?? { contributed: 0, withdrawn: 0 }),
  );
  if (query.status === 'active') data = data.filter((i) => !i.isClosed);
  if (query.status === 'closed') data = data.filter((i) => i.isClosed);

  return { data, meta: buildPaginationMeta(total, page, size) };
}

export async function summary(): Promise<repo.TInvestmentSummary> {
  return repo.summary();
}

export async function getById(
  id: string,
): Promise<TInvestment & { flows: repo.TInvestmentFlow[] }> {
  const row = await repo.findInvestmentById(id);
  if (!row) throw notFound('Investment not found');

  const [flows, ledger] = await Promise.all([
    repo.flowsByInvestment(),
    repo.listFlows(id),
  ]);

  return {
    ...toDto(row, flows.get(id) ?? { contributed: 0, withdrawn: 0 }),
    flows: ledger,
  };
}

export async function create(
  body: TCreateInvestmentBody,
): Promise<TInvestment> {
  await assertRefs(body.categoryId, body.accountId);

  const row = await repo.insertInvestment({
    name: body.name,
    provider: body.provider ?? null,
    kind: body.kind,
    // Explicitly null when omitted — "no goal" and "no valuation" are real
    // states, not missing data to be filled in later with a guess.
    targetCentavos: body.targetCentavos ?? null,
    targetDate: body.targetDate ?? null,
    currentValueCentavos: body.currentValueCentavos ?? null,
    // A valuation with no date is undatable rather than today's — say when it
    // was taken only if the owner said.
    valueAsOf: body.valueAsOf ?? null,
    categoryId: body.categoryId,
    accountId: body.accountId,
    note: body.note ?? null,
  });

  return toDto(row, { contributed: 0, withdrawn: 0 });
}

export async function update(
  id: string,
  body: TUpdateInvestmentBody,
): Promise<TInvestment> {
  const existing = await repo.findInvestmentById(id);
  if (!existing) throw notFound('Investment not found');

  if (body.categoryId ?? body.accountId) {
    await assertRefs(
      body.categoryId ?? existing.categoryId,
      body.accountId ?? existing.accountId,
    );
  }

  // An explicit null must be able to CLEAR each optional field, so only drop a
  // key when it is genuinely absent from the payload.
  const patch: Partial<repo.TInvestmentInsert> = { ...body };
  if (body.targetCentavos === undefined) delete patch.targetCentavos;
  if (body.targetDate === undefined) delete patch.targetDate;
  if (body.currentValueCentavos === undefined) {
    delete patch.currentValueCentavos;
  }
  if (body.valueAsOf === undefined) delete patch.valueAsOf;

  const row = await repo.updateInvestment(id, patch);
  if (!row) throw notFound('Investment not found');

  const flows = await repo.flowsByInvestment();
  return toDto(row, flows.get(id) ?? { contributed: 0, withdrawn: 0 });
}

export async function remove(
  id: string,
  removeTransactions = false,
): Promise<{
  deletedInvestmentId: string;
  keptTransactionCount: number;
  removedTransactionCount: number;
}> {
  const existing = await repo.findInvestmentById(id);
  if (!existing) throw notFound('Investment not found');
  const counts = await repo.deleteInvestment(id, removeTransactions);
  return { deletedInvestmentId: id, ...counts };
}

/**
 * Undo a contribution or withdrawal. The fund's balance is derived from these
 * rows, so removing one simply moves it back.
 */
export async function removeFlow(
  id: string,
  transactionId: string,
): Promise<TInvestment & { flows: repo.TInvestmentFlow[] }> {
  const row = await repo.findInvestmentById(id);
  if (!row) throw notFound('Investment not found');

  const deleted = await repo.deleteFlow(id, transactionId);
  if (!deleted) throw notFound('Entry not found on this investment');

  return getById(id);
}

/**
 * Keep a fund's stated value in step with money actually moving in or out.
 *
 * Only funds that HAVE a value are touched: an unvalued fund is tracked purely
 * by what was put in, and inventing a valuation for it would be the app making
 * up a number. Clamped at zero because the column forbids a negative value.
 */
async function bumpValue(
  row: repo.TInvestmentRow,
  deltaCentavos: number,
  on: string | undefined,
): Promise<void> {
  if (row.currentValueCentavos === null) return;
  await repo.updateInvestment(row.id, {
    currentValueCentavos: Math.max(0, row.currentValueCentavos + deltaCentavos),
    valueAsOf: on ?? todayInAppTz(),
  });
}

export async function contribute(
  id: string,
  body: TContributeBody,
): Promise<{ investment: TInvestment; transactionId: string }> {
  const row = await repo.findInvestmentById(id);
  if (!row) throw notFound('Investment not found');
  if (row.closedAt !== null) {
    throw conflict('This investment is closed. Reopen it before adding to it.');
  }

  const accountId = body.accountId ?? row.accountId;
  if (body.accountId) {
    const account = await accountsRepo.findWritableAccount(body.accountId);
    if (!account) throw badRequest('Account not found or archived.');
  }

  const { transactionId } = await repo.insertFlow({
    investmentId: id,
    type: 'expense',
    amountCentavos: body.amountCentavos,
    txnDate: body.paidDate ?? todayInAppTz(),
    categoryId: row.categoryId,
    accountId,
    note: body.note?.trim() ? body.note.trim() : `${row.name} — contribution`,
  });

  // Money going in makes the pot worth more. Leaving the stated value frozen
  // is what made a valued fund read as though the contribution vanished — and
  // then reported the untracked opening balance as profit.
  await bumpValue(row, body.amountCentavos, body.paidDate);

  return { investment: await getById(id), transactionId };
}

export async function withdraw(
  id: string,
  body: TWithdrawBody,
): Promise<{ investment: TInvestment; transactionId: string }> {
  const row = await repo.findInvestmentById(id);
  if (!row) throw notFound('Investment not found');

  const flows = await repo.flowsByInvestment();
  const current = flows.get(id) ?? { contributed: 0, withdrawn: 0 };
  const net = current.contributed - current.withdrawn;
  if (net <= 0) {
    throw conflict('There is nothing in this fund to withdraw.');
  }

  // Deliberately NOT capped at `net`: a fund that grew can pay out more than
  // was put in, and refusing that would make the app wrong about real money.
  // The cap that does apply is on nothing — only an empty fund is blocked.
  const category = await categoriesRepo.findWritableCategory(body.categoryId);
  if (!category) throw badRequest('Category not found or archived.');
  if (category.kind !== 'income') {
    throw badRequest('Money coming out of a fund needs an income category.');
  }

  const accountId = body.accountId ?? row.accountId;
  if (body.accountId) {
    const account = await accountsRepo.findWritableAccount(body.accountId);
    if (!account) throw badRequest('Account not found or archived.');
  }

  const { transactionId } = await repo.insertFlow({
    investmentId: id,
    type: 'income',
    amountCentavos: body.amountCentavos,
    txnDate: body.paidDate ?? todayInAppTz(),
    categoryId: body.categoryId,
    accountId,
    note: body.note?.trim() ? body.note.trim() : `${row.name} — withdrawal`,
  });

  // Mirror of a contribution: taking money out makes the pot worth less.
  await bumpValue(row, -body.amountCentavos, body.paidDate);

  return { investment: await getById(id), transactionId };
}

import { todayInAppTz } from '../../common/date.js';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginatedResult } from '../../common/types.js';
import * as accountsRepo from '../accounts/accounts.repository.js';
import * as categoriesRepo from '../categories/categories.repository.js';
import * as repo from './businesses.repository.js';
import type {
  TCapitalBody,
  TCreateBusinessBody,
  TDrawingBody,
  TEntryBody,
  TListBusinessesQuery,
  TUpdateBusinessBody,
} from './businesses.schema.js';

/**
 * What a tagged row means. Derived, never stored — a second discriminator
 * column would only be a redundant copy of facts the row already carries, and
 * one more thing to keep honest when a row is edited.
 */
export type TBusinessEntryKind = 'revenue' | 'cost' | 'capital' | 'drawing';

export function deriveEntryKind(
  row: { type: string; accountId: string; transferAccountId: string | null },
  businessAccountId: string | null,
): TBusinessEntryKind {
  if (row.type === 'income') return 'revenue';
  if (row.type === 'expense') return 'cost';
  // Only a business with its own account can have capital or drawings, so a
  // stray transfer on one without an account reads as a drawing (money left).
  return row.transferAccountId !== null &&
    row.transferAccountId === businessAccountId
    ? 'capital'
    : 'drawing';
}

export type TBusiness = {
  id: string;
  name: string;
  note: string | null;
  /** Null when the business has no dedicated account of its own. */
  accountId: string | null;
  accountName: string | null;
  /** False when there is no dedicated account: capital/drawings are hidden. */
  hasOwnAccount: boolean;
  startedOn: string | null;
  closedAt: string | null;
  isClosed: boolean;
  revenueCentavos: number;
  costCentavos: number;
  /** Cash-basis: revenue minus costs. NOT accounting profit — no inventory. */
  netCashCentavos: number;
  capitalCentavos: number;
  drawingCentavos: number;
  /** What the books say the business should be holding. */
  expectedBalanceCentavos: number;
  /** What the account actually holds. Null without a dedicated account. */
  actualBalanceCentavos: number | null;
  /**
   * actual − expected. Zero is the healthy state. Anything else is a row on the
   * business account that the books do not explain — a mis-tagged entry, or a
   * personal transaction recorded against the business account by mistake.
   * This check is the entire reason the business owns a real account.
   */
  reconciliationDiffCentavos: number | null;
};

async function toDto(
  row: repo.TBusinessRow,
  flows: Map<string, repo.TBusinessFlows>,
  balances: Map<string, { name: string; balance: number }>,
  earmarks: Map<string, { capital: number; drawing: number }>,
): Promise<TBusiness> {
  return Promise.resolve(buildDto(row, flows, balances, earmarks));
}

function buildDto(
  row: repo.TBusinessRow,
  flows: Map<string, repo.TBusinessFlows>,
  balances: Map<string, { name: string; balance: number }>,
  earmarks: Map<string, { capital: number; drawing: number }>,
): TBusiness {
  const ledger = flows.get(row.id) ?? {
    revenue: 0,
    cost: 0,
    capital: 0,
    drawing: 0,
  };
  const mark = earmarks.get(row.id) ?? { capital: 0, drawing: 0 };
  // Capital is capital whether the peso crossed an account boundary or was
  // simply declared. The distinction only matters for reconciliation below.
  const f = {
    revenue: ledger.revenue,
    cost: ledger.cost,
    capital: ledger.capital + mark.capital,
    drawing: ledger.drawing + mark.drawing,
  };
  const hasEarmarks = mark.capital + mark.drawing > 0;
  const account =
    row.accountId === null ? undefined : balances.get(row.accountId);
  const hasOwnAccount = row.accountId !== null;
  const expected = f.capital + f.revenue - f.cost - f.drawing;
  // Without its own account there is nothing to reconcile AGAINST — the money
  // sits in a personal wallet mixed with everything else — so reporting a
  // difference would invent a discrepancy out of thin air.
  // Reconciliation compares the books against a real balance, so it only
  // means anything when every entry actually moved money. One earmark and the
  // comparison is apples to oranges — better to make no claim than a wrong one.
  const actual = hasOwnAccount && !hasEarmarks ? (account?.balance ?? 0) : null;

  return {
    id: row.id,
    name: row.name,
    note: row.note,
    accountId: row.accountId,
    accountName: account?.name ?? null,
    hasOwnAccount,
    startedOn: row.startedOn,
    closedAt: row.closedAt,
    isClosed: row.closedAt !== null,
    revenueCentavos: f.revenue,
    costCentavos: f.cost,
    netCashCentavos: f.revenue - f.cost,
    capitalCentavos: f.capital,
    drawingCentavos: f.drawing,
    expectedBalanceCentavos: expected,
    actualBalanceCentavos: actual,
    reconciliationDiffCentavos: actual === null ? null : actual - expected,
  };
}

/** Account id → name and derived balance, for the reconciliation check. */
async function balanceMap(): Promise<
  Map<string, { name: string; balance: number }>
> {
  const [rows, movement] = await Promise.all([
    accountsRepo.listAccounts({ includeArchived: true, limit: 500, offset: 0 }),
    accountsRepo.sumMovementByAccount(),
  ]);
  return new Map(
    rows.rows.map((a) => [
      a.id,
      {
        name: a.name,
        balance: a.openingBalanceCentavos + (movement.get(a.id) ?? 0),
      },
    ]),
  );
}

export async function list(
  q: TListBusinessesQuery,
): Promise<TPaginatedResult<TBusiness>> {
  const { page, size, limit, offset } = resolvePagination(
    q.pageNumber,
    q.pageSize,
  );
  const [{ rows, total }, flows, balances, earmarks] = await Promise.all([
    repo.listBusinesses(q.status !== 'active', limit, offset),
    repo.flowsByBusiness(),
    balanceMap(),
    repo.earmarksByBusiness(),
  ]);

  const filtered =
    q.status === 'closed' ? rows.filter((r) => r.closedAt !== null) : rows;

  return {
    data: filtered.map((r) => buildDto(r, flows, balances, earmarks)),
    meta: buildPaginationMeta(total, page, size),
  };
}

export async function getById(id: string): Promise<TBusiness> {
  const row = await repo.findBusinessById(id);
  if (!row) throw notFound('Business not found');
  const [flows, balances, earmarks] = await Promise.all([
    repo.flowsByBusiness(),
    balanceMap(),
    repo.earmarksByBusiness(),
  ]);
  return toDto(row, flows, balances, earmarks);
}

export type TBusinessEntry = {
  id: string;
  kind: TBusinessEntryKind;
  type: 'income' | 'expense' | 'transfer';
  amountCentavos: number;
  txnDate: string;
  note: string | null;
  categoryName: string | null;
  /**
   * True when this is an earmark — capital or a drawing that changed no
   * account balance. The UI says so, because "₱4,000 capital" that did not
   * move is a different fact from one that did.
   */
  isEarmark: boolean;
};

export async function entries(id: string): Promise<TBusinessEntry[]> {
  const business = await repo.findBusinessById(id);
  if (!business) throw notFound('Business not found');
  const [rows, earmarks] = await Promise.all([
    repo.listEntries(id),
    repo.listEarmarks(id),
  ]);

  const fromLedger: TBusinessEntry[] = rows.map((r) => ({
    id: r.id,
    kind: deriveEntryKind(r, business.accountId),
    type: r.type,
    amountCentavos: r.amountCentavos,
    txnDate: r.txnDate,
    note: r.note,
    categoryName: r.categoryName,
    isEarmark: false,
  }));

  const fromEarmarks: TBusinessEntry[] = earmarks.map((e) => ({
    id: e.id,
    kind: e.kind,
    // Neither income nor expense: nothing moved. 'transfer' is the closest
    // existing shape and keeps the row out of any income/expense styling.
    type: 'transfer' as const,
    amountCentavos: e.amountCentavos,
    txnDate: e.movedOn,
    note: e.note,
    categoryName: null,
    isEarmark: true,
  }));

  return [...fromLedger, ...fromEarmarks].sort((a, b) =>
    b.txnDate.localeCompare(a.txnDate),
  );
}

/**
 * A business's account must be a real, unarchived account that no OTHER
 * business already claims. The unique index enforces the second half too, but
 * catching it here turns a raw 23505 into a sentence that says what to do.
 */
async function assertAccount(accountId: string, exceptId?: string) {
  const account = await accountsRepo.findWritableAccount(accountId);
  if (!account) throw notFound('Account not found or archived');
  if (account.kind === 'credit_card') {
    throw badRequest(
      'A credit card cannot be a business account — its balance is what you owe, not what the business holds.',
    );
  }
  const owner = await repo.businessAccountIds();
  const taken = owner.includes(accountId);
  if (taken && !exceptId) {
    throw conflict('That account already belongs to another business.');
  }
}

export async function create(body: TCreateBusinessBody): Promise<TBusiness> {
  if (await repo.nameTaken(body.name)) {
    throw conflict(`A business named ${body.name} already exists.`);
  }
  if (body.accountId) await assertAccount(body.accountId);
  const row = await repo.insertBusiness({
    name: body.name,
    note: body.note ?? null,
    accountId: body.accountId ?? null,
    startedOn: body.startedOn ?? null,
    closedAt: body.closedAt ?? null,
  });
  return getById(row.id);
}

export async function update(
  id: string,
  body: TUpdateBusinessBody,
): Promise<TBusiness> {
  const existing = await repo.findBusinessById(id);
  if (!existing) throw notFound('Business not found');

  if (body.name && (await repo.nameTaken(body.name, id))) {
    throw conflict(`A business named ${body.name} already exists.`);
  }
  // The account CAN be changed. Only capital and drawings block it: those are
  // transfers into or out of one specific account, so re-pointing the business
  // would leave them describing a movement that no longer relates to it.
  // Revenue and costs are safe — they record where money actually moved, and
  // that stays true wherever the business is filed.
  if (body.accountId !== undefined && body.accountId !== existing.accountId) {
    const flows = await repo.flowsByBusiness();
    const f = flows.get(id);
    if (f && f.capital + f.drawing > 0) {
      throw conflict(
        'This business has capital or drawings recorded against its current account, so that account cannot be changed. Remove those entries first.',
      );
    }
    if (body.accountId !== null) await assertAccount(body.accountId, id);
  }

  await repo.updateBusiness(id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.note !== undefined ? { note: body.note ?? null } : {}),
    ...(body.accountId !== undefined
      ? { accountId: body.accountId ?? null }
      : {}),
    ...(body.startedOn !== undefined
      ? { startedOn: body.startedOn ?? null }
      : {}),
    ...(body.closedAt !== undefined ? { closedAt: body.closedAt ?? null } : {}),
  });
  return getById(id);
}

export async function remove(
  id: string,
): Promise<{ keptTransactionCount: number }> {
  const existing = await repo.findBusinessById(id);
  if (!existing) throw notFound('Business not found');
  return repo.deleteBusiness(id);
}

/**
 * Revenue and costs must sit on the business's OWN account. That constraint is
 * what keeps `expected === actual` meaningful: allow a cost to be paid from a
 * personal wallet and the reconciliation check stops being able to prove
 * anything. Paying personally is still recordable — as capital in, then a cost.
 */
export async function addEntry(
  id: string,
  body: TEntryBody,
): Promise<TBusiness> {
  const business = await repo.findBusinessById(id);
  if (!business) throw notFound('Business not found');

  const category = await categoriesRepo.findWritableCategory(body.categoryId);
  if (!category) throw notFound('Category not found or archived');

  const wantedKind = body.kind === 'revenue' ? 'income' : 'expense';
  if (category.kind !== wantedKind) {
    throw badRequest(
      `A ${body.kind} needs a ${wantedKind} category, but that one is ${category.kind}.`,
    );
  }
  if (category.scope !== 'business') {
    throw badRequest(
      'Business entries need a business category. Personal categories keep the two sets of books apart.',
    );
  }

  // With a dedicated account every entry belongs on it, which is what keeps
  // the reconciliation exact. Without one, the caller says which account paid.
  const accountId = business.accountId ?? body.accountId;
  if (!accountId) {
    throw badRequest('Pick the account this was paid from.');
  }
  if (business.accountId === null) {
    const paying = await accountsRepo.findWritableAccount(accountId);
    if (!paying) throw notFound('Account not found or archived');
  }

  await repo.insertEntry({
    businessId: id,
    type: wantedKind,
    amountCentavos: body.amountCentavos,
    txnDate: body.txnDate ?? todayInAppTz(),
    categoryId: body.categoryId,
    accountId,
    note: body.note ?? null,
  });
  return getById(id);
}

export async function addCapital(
  id: string,
  body: TCapitalBody,
): Promise<TBusiness> {
  const business = await repo.findBusinessById(id);
  if (!business) throw notFound('Business not found');

  const source = await accountsRepo.findWritableAccount(body.fromAccountId);
  if (!source) throw notFound('Source account not found or archived');

  // Funding the business from the very account it keeps its money in — or from
  // anywhere, when it has no account of its own — moves no money at all. It is
  // an earmark: "this much of what is already there is the business's". Real
  // money crossing an account boundary stays a transfer.
  const ownAccountId = business.accountId;

  if (ownAccountId === null || body.fromAccountId === ownAccountId) {
    await repo.insertEarmark({
      businessId: id,
      kind: 'capital',
      amountCentavos: body.amountCentavos,
      movedOn: body.txnDate ?? todayInAppTz(),
      note: body.note ?? null,
    });
  } else {
    await repo.insertMovement({
      businessId: id,
      fromAccountId: body.fromAccountId,
      toAccountId: ownAccountId,
      amountCentavos: body.amountCentavos,
      txnDate: body.txnDate ?? todayInAppTz(),
      note: body.note ?? null,
    });
  }
  return getById(id);
}

export async function addDrawing(
  id: string,
  body: TDrawingBody,
): Promise<TBusiness> {
  const business = await repo.findBusinessById(id);
  if (!business) throw notFound('Business not found');

  const destination = await accountsRepo.findWritableAccount(body.toAccountId);
  if (!destination) throw notFound('Destination account not found or archived');

  // Mirror of capital: taking money out to the same account it already sits in
  // moves nothing, so it is recorded rather than transferred.
  const ownAccountId = business.accountId;

  if (ownAccountId === null || body.toAccountId === ownAccountId) {
    await repo.insertEarmark({
      businessId: id,
      kind: 'drawing',
      amountCentavos: body.amountCentavos,
      movedOn: body.txnDate ?? todayInAppTz(),
      note: body.note ?? null,
    });
  } else {
    await repo.insertMovement({
      businessId: id,
      fromAccountId: ownAccountId,
      toAccountId: body.toAccountId,
      amountCentavos: body.amountCentavos,
      txnDate: body.txnDate ?? todayInAppTz(),
      note: body.note ?? null,
    });
  }
  return getById(id);
}

export async function removeEntry(
  id: string,
  entryId: string,
): Promise<TBusiness> {
  const business = await repo.findBusinessById(id);
  if (!business) throw notFound('Business not found');
  // An entry is either a ledger row or an earmark, and the id alone does not
  // say which. Try the ledger first, then the earmarks.
  const deleted =
    (await repo.deleteEntry(id, entryId)) ||
    (await repo.deleteEarmark(id, entryId));
  if (!deleted) throw notFound('Entry not found for this business');
  return getById(id);
}

export type TBusinessesSummary = {
  activeCount: number;
  /** How many keep their money in an account of their own. */
  withOwnAccountCount: number;
  totalNetCashCentavos: number;
  totalCapitalCentavos: number;
  totalDrawingCentavos: number;
  /** Cash held across every active business's account. */
  totalHeldCentavos: number;
  /**
   * What the books say the businesses hold, whether or not it sits in an
   * account of its own. This is what the dashboard withholds from disposable
   * money — the business's share, not somebody's whole salary.
   */
  ownedCentavos: number;
  /** True when any business's books disagree with its account. */
  hasReconciliationGap: boolean;
};

export async function summary(): Promise<TBusinessesSummary> {
  const [{ rows }, flows, balances, earmarks] = await Promise.all([
    repo.listBusinesses(true, 500, 0),
    repo.flowsByBusiness(),
    balanceMap(),
    repo.earmarksByBusiness(),
  ]);

  let activeCount = 0;
  let withOwnAccountCount = 0;
  let netCash = 0;
  let capital = 0;
  let drawing = 0;
  let held = 0;
  let owned = 0;
  let hasGap = false;

  for (const row of rows) {
    if (row.closedAt !== null) continue;
    const dto = buildDto(row, flows, balances, earmarks);
    activeCount += 1;
    if (dto.hasOwnAccount) withOwnAccountCount += 1;
    netCash += dto.netCashCentavos;
    capital += dto.capitalCentavos;
    drawing += dto.drawingCentavos;
    held += dto.actualBalanceCentavos ?? 0;
    owned += dto.expectedBalanceCentavos;
    if (
      dto.reconciliationDiffCentavos !== null &&
      dto.reconciliationDiffCentavos !== 0
    ) {
      hasGap = true;
    }
  }

  return {
    activeCount,
    withOwnAccountCount,
    totalNetCashCentavos: netCash,
    totalCapitalCentavos: capital,
    totalDrawingCentavos: drawing,
    totalHeldCentavos: held,
    ownedCentavos: owned,
    hasReconciliationGap: hasGap,
  };
}

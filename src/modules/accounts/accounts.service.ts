import { conflict, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginatedResult } from '../../common/types.js';
import * as repo from './accounts.repository.js';
import type {
  TCreateAccountBody,
  TListAccountsQuery,
  TUpdateAccountBody,
  TAccountHistoryQuery,
} from './accounts.schema.js';
import type { TAccount, TDeleteAccountResult } from './accounts.types.js';

function toDto(row: repo.TAccountRow, movement = 0): TAccount {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    icon: row.icon,
    color: row.color,
    openingBalanceCentavos: row.openingBalanceCentavos,
    openingBalanceDate: row.openingBalanceDate,
    creditLimitCentavos: row.creditLimitCentavos,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    isArchived: row.archivedAt !== null,
    currentBalanceCentavos: row.openingBalanceCentavos + movement,
  };
}

export async function list(
  query: TListAccountsQuery,
): Promise<TPaginatedResult<TAccount>> {
  const { page, size, limit, offset } = resolvePagination(
    query.pageNumber,
    query.pageSize,
  );

  const [{ rows, total }, movement] = await Promise.all([
    repo.listAccounts({
      kind: query.kind,
      search: query.search,
      includeArchived: query.includeArchived ?? false,
      limit,
      offset,
    }),
    repo.sumMovementByAccount(),
  ]);

  return {
    data: rows.map((r) => toDto(r, movement.get(r.id) ?? 0)),
    meta: buildPaginationMeta(total, page, size),
  };
}

/** Every active account with its balance, unpaged — for the dashboard. */
export async function balances(): Promise<TAccount[]> {
  const [{ rows }, movement] = await Promise.all([
    repo.listAccounts({ includeArchived: false, limit: 200, offset: 0 }),
    repo.sumMovementByAccount(),
  ]);
  return rows.map((r) => toDto(r, movement.get(r.id) ?? 0));
}

export async function getById(id: string): Promise<TAccount> {
  const row = await repo.findAccountById(id);
  if (!row) throw notFound('Account not found');
  const movement = await repo.sumMovementByAccount();
  return toDto(row, movement.get(row.id) ?? 0);
}

export async function create(body: TCreateAccountBody): Promise<TAccount> {
  if (await repo.nameTaken(body.name)) {
    throw conflict(`An account named "${body.name}" already exists.`);
  }
  const row = await repo.insertAccount({
    name: body.name,
    kind: body.kind,
    icon: body.icon ?? null,
    color: body.color ?? null,
    openingBalanceCentavos: body.openingBalanceCentavos ?? 0,
    openingBalanceDate: body.openingBalanceDate ?? null,
    creditLimitCentavos: body.creditLimitCentavos ?? null,
    isDefault: body.isDefault ?? false,
    sortOrder: body.sortOrder ?? 0,
  });
  return toDto(row);
}

export async function update(
  id: string,
  body: TUpdateAccountBody,
): Promise<TAccount> {
  const existing = await repo.findAccountById(id);
  if (!existing) throw notFound('Account not found');
  if (body.name && (await repo.nameTaken(body.name, id))) {
    throw conflict(`An account named "${body.name}" already exists.`);
  }

  const row = await repo.updateAccount(id, body);
  if (!row) throw notFound('Account not found');
  const movement = await repo.sumMovementByAccount();
  return toDto(row, movement.get(row.id) ?? 0);
}

/**
 * Never used -> hard delete. Referenced -> archive, so historical rows keep
 * rendering their account name.
 */
export async function remove(id: string): Promise<TDeleteAccountResult> {
  const existing = await repo.findAccountById(id);
  if (!existing) throw notFound('Account not found');

  const referenceCount = await repo.countAccountReferences(id);
  if (referenceCount === 0) {
    await repo.deleteAccount(id);
    return { deleted: true };
  }

  await repo.archiveAccount(id);
  return { archived: true, referenceCount };
}

export async function restore(id: string): Promise<TAccount> {
  const row = await repo.restoreAccount(id);
  if (!row) throw notFound('Account not found');
  return toDto(row);
}

/**
 * One account's ledger with a running balance.
 *
 * The opening balance is passed into the window so the first row reads as the
 * real balance at that point, not as "movement since zero".
 */
export async function history(
  id: string,
  query: TAccountHistoryQuery,
): Promise<TPaginatedResult<repo.TAccountHistoryRow>> {
  const account = await repo.findAccountById(id);
  if (!account) throw notFound('Account not found');

  const { page, size, limit, offset } = resolvePagination(
    query.pageNumber,
    query.pageSize,
  );
  const { rows, total } = await repo.historyForAccount(
    id,
    account.openingBalanceCentavos,
    limit,
    offset,
  );

  return { data: rows, meta: buildPaginationMeta(total, page, size) };
}

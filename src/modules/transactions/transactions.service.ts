import { badRequest, conflict, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginationMeta } from '../../common/types.js';
import * as accountsRepo from '../accounts/accounts.repository.js';
import * as categoriesRepo from '../categories/categories.repository.js';
import * as repo from './transactions.repository.js';
import type {
  TCreateTransactionBody,
  TListTransactionsQuery,
  TUpdateTransactionBody,
} from './transactions.schema.js';
import type {
  TTransaction,
  TTransactionSummary,
} from './transactions.types.js';

export function toDto(row: repo.TTransactionJoinedRow): TTransaction {
  return {
    id: row.id,
    type: row.type,
    amountCentavos: row.amountCentavos,
    txnDate: row.txnDate,
    note: row.note,
    source: row.source,
    installmentPaymentId: row.installmentPaymentId,
    creditLoanId: row.creditLoanId,
    investmentId: row.investmentId,
    recurringRuleId: row.recurringRuleId,
    isEdited: row.editedAt !== null,
    // A transfer has no category. Rather than making every render site handle
    // null, the DTO supplies a display-only stand-in — the DB row stays null.
    category:
      row.categoryId === null
        ? {
            id: '',
            name: 'Transfer',
            icon: 'arrow-left-right',
            color: null,
          }
        : {
            id: row.categoryId,
            name: row.categoryName ?? '',
            icon: row.categoryIcon,
            color: row.categoryColor,
          },
    transferAccount:
      row.transferAccountId === null
        ? null
        : {
            id: row.transferAccountId,
            name: row.transferAccountName ?? '',
            icon: null,
            color: null,
          },
    account: {
      id: row.accountId,
      name: row.accountName,
      icon: row.accountIcon,
      color: row.accountColor,
    },
  };
}

/**
 * A transaction's category must exist, be unarchived, and match its type. The
 * type/kind rule can't be a cross-table CHECK without a trigger, so it lives
 * here — meaning raw SQL could still violate it.
 */
async function assertWritableRefs(
  type: 'income' | 'expense',
  categoryId: string,
  accountId: string,
): Promise<void> {
  const [category, account] = await Promise.all([
    categoriesRepo.findWritableCategory(categoryId),
    accountsRepo.findWritableAccount(accountId),
  ]);

  if (!category) {
    throw badRequest('Category not found or archived.');
  }
  if (category.kind !== type) {
    throw badRequest(
      `Category "${category.name}" is an ${category.kind} category, but this is an ${type}.`,
    );
  }
  if (!account) {
    throw badRequest('Account not found or archived.');
  }
}

export async function list(query: TListTransactionsQuery): Promise<{
  data: TTransaction[];
  meta: TPaginationMeta;
  summary: TTransactionSummary;
}> {
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    throw badRequest('dateFrom must not be after dateTo.');
  }

  const { page, size, limit, offset } = resolvePagination(
    query.pageNumber,
    query.pageSize,
  );
  const { rows, total, summary } = await repo.listTransactions(
    query,
    limit,
    offset,
  );

  return {
    data: rows.map(toDto),
    meta: buildPaginationMeta(total, page, size),
    summary,
  };
}

export async function getById(id: string): Promise<TTransaction> {
  const row = await repo.findJoinedById(id);
  if (!row) throw notFound('Transaction not found');
  return toDto(row);
}

/** Both ends of a transfer must exist, be unarchived, and be different. */
async function assertTransferRefs(
  fromAccountId: string,
  toAccountId: string | null,
): Promise<void> {
  if (!toAccountId) throw badRequest('Destination account is required.');
  if (fromAccountId === toAccountId) {
    throw badRequest('Choose two different accounts.');
  }
  const [from, to] = await Promise.all([
    accountsRepo.findWritableAccount(fromAccountId),
    accountsRepo.findWritableAccount(toAccountId),
  ]);
  if (!from) throw badRequest('Source account not found or archived.');
  if (!to) throw badRequest('Destination account not found or archived.');
}

export async function create(
  body: TCreateTransactionBody,
): Promise<TTransaction> {
  if (body.type === 'transfer') {
    await assertTransferRefs(body.accountId, body.transferAccountId);
  } else {
    await assertWritableRefs(body.type, body.categoryId, body.accountId);
  }

  const inserted = await repo.insertTransaction({
    type: body.type,
    amountCentavos: body.amountCentavos,
    txnDate: body.txnDate,
    // The table's CHECKs enforce this pairing too; sending the wrong shape
    // here would be a constraint violation rather than silent bad data.
    categoryId: body.type === 'transfer' ? null : body.categoryId,
    transferAccountId: body.type === 'transfer' ? body.transferAccountId : null,
    accountId: body.accountId,
    note: body.note ?? null,
    source: 'manual',
  });

  return getById(inserted.id);
}

export async function update(
  id: string,
  body: TUpdateTransactionBody,
): Promise<TTransaction> {
  const existing = await repo.findById(id);
  if (!existing) throw notFound('Transaction not found');

  // A repayment belongs to its loan — editing the amount here would silently
  // move the loan's outstanding balance from a screen that shows no loan.
  if (existing.creditLoanId) {
    throw conflict(
      'This expense belongs to a credit loan. Edit it from the Credit Loans module.',
    );
  }

  if (existing.investmentId) {
    throw conflict(
      'This entry belongs to an investment. Edit it from the Investments module.',
    );
  }

  const nextAccountId = body.accountId ?? existing.accountId;

  if (existing.type === 'transfer') {
    await assertTransferRefs(
      nextAccountId,
      body.transferAccountId ?? existing.transferAccountId,
    );
  } else {
    const nextType = body.type ?? existing.type;
    const nextCategoryId = body.categoryId ?? existing.categoryId;
    if (!nextCategoryId) throw badRequest('Category is required.');
    await assertWritableRefs(nextType, nextCategoryId, nextAccountId);
  }

  // Mark generated rows as hand-edited so a bulk rule update skips them.
  const isGenerated = existing.source !== 'manual';

  await repo.updateTransaction(id, {
    ...body,
    note: body.note === undefined ? undefined : (body.note ?? null),
    ...(isGenerated ? { editedAt: new Date() } : {}),
  });

  return getById(id);
}

export async function remove(id: string): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw notFound('Transaction not found');

  // Otherwise the installment payment stays marked paid pointing at nothing,
  // breaking the "paid <=> exactly one transaction" invariant.
  if (existing.installmentPaymentId) {
    throw conflict(
      'This expense is linked to an installment payment. Unmark the payment as paid instead.',
    );
  }

  if (existing.creditLoanId) {
    throw conflict(
      'This expense is a credit-loan repayment. Remove it from the Credit Loans module instead.',
    );
  }

  if (existing.investmentId) {
    throw conflict(
      'This entry belongs to an investment. Remove it from the Investments module instead.',
    );
  }

  await repo.deleteTransaction(id);
}

import { todayInAppTz } from '../../common/date.js';
import { badRequest, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginatedResult } from '../../common/types.js';
import * as accountsRepo from '../accounts/accounts.repository.js';
import * as categoriesRepo from '../categories/categories.repository.js';
import {
  materializeDue,
  specOf,
  type TMaterializeResult,
} from './recurring.materializer.js';
import {
  nextOccurrenceAfter,
  occurrencesBetween,
} from './recurring.occurrences.js';
import * as repo from './recurring.repository.js';
import type {
  TCreateRuleBody,
  TDeleteRuleQuery,
  TListRulesQuery,
  TUpdateRuleBody,
  TUpdateRuleQuery,
} from './recurring.schema.js';

export type TRecurringRule = {
  id: string;
  name: string;
  type: 'income' | 'expense';
  amountCentavos: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
  interval: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  startDate: string;
  endDate: string | null;
  categoryId: string;
  accountId: string;
  note: string | null;
  isActive: boolean;
  nextOccurrence: string | null;
};

function toDto(row: repo.TRuleRow, today: string): TRecurringRule {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    amountCentavos: row.amountCentavos,
    frequency: row.frequency,
    interval: row.interval,
    dayOfWeek: row.dayOfWeek,
    dayOfMonth: row.dayOfMonth,
    monthOfYear: row.monthOfYear,
    startDate: row.startDate,
    endDate: row.endDate,
    categoryId: row.categoryId,
    accountId: row.accountId,
    note: row.note,
    isActive: row.isActive,
    nextOccurrence: row.isActive
      ? nextOccurrenceAfter(specOf(row), today)
      : null,
  };
}

async function assertRefs(
  type: 'income' | 'expense',
  categoryId: string,
  accountId: string,
): Promise<void> {
  const [category, account] = await Promise.all([
    categoriesRepo.findWritableCategory(categoryId),
    accountsRepo.findWritableAccount(accountId),
  ]);
  if (!category) throw badRequest('Category not found or archived.');
  if (category.kind !== type) {
    throw badRequest(
      `Category "${category.name}" is an ${category.kind} category, but this rule is an ${type}.`,
    );
  }
  if (!account) throw badRequest('Account not found or archived.');
}

export async function list(
  query: TListRulesQuery,
): Promise<TPaginatedResult<TRecurringRule>> {
  const today = todayInAppTz();
  const { page, size, limit, offset } = resolvePagination(
    query.pageNumber,
    query.pageSize,
  );
  const { rows, total } = await repo.listRules(
    { isActive: query.isActive, type: query.type },
    limit,
    offset,
  );
  return {
    data: rows.map((r) => toDto(r, today)),
    meta: buildPaginationMeta(total, page, size),
  };
}

export async function getById(
  id: string,
): Promise<TRecurringRule & { nextOccurrences: string[] }> {
  const today = todayInAppTz();
  const row = await repo.findRuleById(id);
  if (!row) throw notFound('Recurring rule not found');

  // Next six, for the form's preview.
  const horizonEnd = `${Number(today.slice(0, 4)) + 3}${today.slice(4)}`;
  const upcoming = occurrencesBetween(specOf(row), today, horizonEnd, 6);

  return { ...toDto(row, today), nextOccurrences: upcoming };
}

export async function create(body: TCreateRuleBody): Promise<TRecurringRule> {
  await assertRefs(body.type, body.categoryId, body.accountId);

  const row = await repo.insertRule({
    name: body.name,
    type: body.type,
    amountCentavos: body.amountCentavos,
    frequency: body.frequency,
    interval: body.interval,
    dayOfWeek: 'dayOfWeek' in body ? body.dayOfWeek : null,
    dayOfMonth: 'dayOfMonth' in body ? body.dayOfMonth : null,
    monthOfYear: 'monthOfYear' in body ? body.monthOfYear : null,
    startDate: body.startDate,
    endDate: body.endDate ?? null,
    categoryId: body.categoryId,
    accountId: body.accountId,
    note: body.note ?? null,
  });

  // Back-dated rules should fill in immediately, not on the next read.
  await materializeDue({ force: true });
  return toDto(row, todayInAppTz());
}

export async function update(
  id: string,
  body: TUpdateRuleBody,
  query: TUpdateRuleQuery,
): Promise<{ rule: TRecurringRule; updatedTransactionCount: number }> {
  const today = todayInAppTz();
  const existing = await repo.findRuleById(id);
  if (!existing) throw notFound('Recurring rule not found');

  if (body.categoryId ?? body.accountId) {
    await assertRefs(
      existing.type,
      body.categoryId ?? existing.categoryId,
      body.accountId ?? existing.accountId,
    );
  }

  // Re-check the frequency shape after merging, mirroring the DB CHECK.
  const merged = { ...existing, ...body };
  const needs = {
    weekly: ['dayOfWeek'],
    biweekly: ['dayOfWeek'],
    monthly: ['dayOfMonth'],
    yearly: ['dayOfMonth', 'monthOfYear'],
  }[merged.frequency];
  for (const field of needs) {
    if (merged[field as 'dayOfWeek'] == null) {
      throw badRequest(`A ${merged.frequency} rule requires ${field}.`);
    }
  }

  const row = await repo.updateRule(id, body);
  if (!row) throw notFound('Recurring rule not found');

  let updatedTransactionCount = 0;
  const propagate = {
    ...(body.amountCentavos !== undefined
      ? { amountCentavos: body.amountCentavos }
      : {}),
    ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
    ...(body.accountId !== undefined ? { accountId: body.accountId } : {}),
    ...(body.note !== undefined ? { note: body.note ?? null } : {}),
  };

  if (query.applyTo === 'all' && Object.keys(propagate).length > 0) {
    updatedTransactionCount = await repo.applyRuleToExisting(id, propagate);
  }

  return { rule: toDto(row, today), updatedTransactionCount };
}

export async function remove(
  id: string,
  query: TDeleteRuleQuery,
): Promise<{ deletedRuleId: string; deletedTransactionCount: number }> {
  const existing = await repo.findRuleById(id);
  if (!existing) throw notFound('Recurring rule not found');

  let deletedTransactionCount = 0;
  if (query.deleteGenerated === 'all') {
    deletedTransactionCount = await repo.deleteGenerated(id);
  } else if (query.deleteGenerated === 'future') {
    deletedTransactionCount = await repo.deleteGenerated(id, todayInAppTz());
  }

  // Soft delete: generated transactions keep their provenance.
  await repo.softDeleteRule(id);
  return { deletedRuleId: id, deletedTransactionCount };
}

export async function setActive(
  id: string,
  isActive: boolean,
): Promise<TRecurringRule> {
  const row = await repo.updateRule(id, { isActive });
  if (!row) throw notFound('Recurring rule not found');
  if (isActive) await materializeDue({ force: true });
  return toDto(row, todayInAppTz());
}

export async function materialize(): Promise<TMaterializeResult> {
  return materializeDue({ force: true });
}

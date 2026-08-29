import { badRequest, conflict, notFound } from '../../common/errors.js';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination.js';
import type { TPaginatedResult } from '../../common/types.js';
import * as repo from './categories.repository.js';
import type {
  TCreateCategoryBody,
  TListCategoriesQuery,
  TUpdateCategoryBody,
} from './categories.schema.js';
import type { TCategory, TDeleteCategoryResult } from './categories.types.js';

function toDto(row: repo.TCategoryRow, transactionCount = 0): TCategory {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    icon: row.icon,
    color: row.color,
    monthlyBudgetCentavos: row.monthlyBudgetCentavos,
    sortOrder: row.sortOrder,
    isArchived: row.archivedAt !== null,
    transactionCount,
  };
}

export async function list(
  query: TListCategoriesQuery,
): Promise<TPaginatedResult<TCategory>> {
  const { page, size, limit, offset } = resolvePagination(
    query.pageNumber,
    query.pageSize,
  );

  const [{ rows, total }, counts] = await Promise.all([
    repo.listCategories({
      kind: query.kind,
      search: query.search,
      includeArchived: query.includeArchived ?? false,
      limit,
      offset,
    }),
    repo.countTransactionsByCategory(),
  ]);

  return {
    data: rows.map((r) => toDto(r, counts.get(r.id) ?? 0)),
    meta: buildPaginationMeta(total, page, size),
  };
}

export async function getById(id: string): Promise<TCategory> {
  const row = await repo.findCategoryById(id);
  if (!row) throw notFound('Category not found');
  const counts = await repo.countTransactionsByCategory();
  return toDto(row, counts.get(row.id) ?? 0);
}

export async function create(body: TCreateCategoryBody): Promise<TCategory> {
  if (body.kind === 'income' && body.monthlyBudgetCentavos != null) {
    throw badRequest('Only expense categories can have a monthly budget.');
  }
  if (await repo.nameTaken(body.kind, body.name)) {
    throw conflict(
      `A ${body.kind} category named "${body.name}" already exists.`,
    );
  }

  const row = await repo.insertCategory({
    name: body.name,
    kind: body.kind,
    icon: body.icon ?? null,
    color: body.color ?? null,
    monthlyBudgetCentavos: body.monthlyBudgetCentavos ?? null,
    sortOrder: body.sortOrder ?? 0,
  });
  return toDto(row);
}

export async function update(
  id: string,
  body: TUpdateCategoryBody,
): Promise<TCategory> {
  const existing = await repo.findCategoryById(id);
  if (!existing) throw notFound('Category not found');

  if (existing.kind === 'income' && body.monthlyBudgetCentavos != null) {
    throw badRequest('Only expense categories can have a monthly budget.');
  }
  if (body.name && (await repo.nameTaken(existing.kind, body.name, id))) {
    throw conflict(
      `A ${existing.kind} category named "${body.name}" already exists.`,
    );
  }

  const row = await repo.updateCategory(id, body);
  if (!row) throw notFound('Category not found');
  const counts = await repo.countTransactionsByCategory();
  return toDto(row, counts.get(row.id) ?? 0);
}

/**
 * Never used → hard delete (a category that never happened should just vanish).
 * Referenced → archive, so historical rows keep rendering their category name.
 */
export async function remove(id: string): Promise<TDeleteCategoryResult> {
  const existing = await repo.findCategoryById(id);
  if (!existing) throw notFound('Category not found');

  const referenceCount = await repo.countCategoryReferences(id);
  if (referenceCount === 0) {
    await repo.deleteCategory(id);
    return { deleted: true };
  }

  await repo.archiveCategory(id);
  return { archived: true, referenceCount };
}

export async function restore(id: string): Promise<TCategory> {
  const row = await repo.restoreCategory(id);
  if (!row) throw notFound('Category not found');
  return toDto(row);
}

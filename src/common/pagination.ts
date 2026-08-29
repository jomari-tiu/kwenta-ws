import type { TPaginationMeta } from './types.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Build pagination metadata for a list response. */
export function buildPaginationMeta(
  total: number,
  pageNumber: number,
  pageSize: number,
): TPaginationMeta {
  return {
    total,
    page: pageNumber,
    pageSize,
    hasNext: pageNumber * pageSize < total,
    hasPrevious: pageNumber > 1,
  };
}

/** Clamp raw paging input into a safe limit/offset pair. */
export function resolvePagination(pageNumber?: number, pageSize?: number) {
  const page = Math.max(1, Math.trunc(pageNumber ?? 1));
  const size = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  return { page, size, limit: size, offset: (page - 1) * size };
}

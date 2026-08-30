import { and, asc, count, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  categories,
  installmentPlans,
  recurringRules,
  transactions,
} from '../../db/schema/index.js';
import type { TCategoryKind, TCategoryScope } from '../../db/schema/index.js';

export type TCategoryRow = typeof categories.$inferSelect;
export type TCategoryInsert = typeof categories.$inferInsert;

export type TListCategoriesArgs = {
  kind?: TCategoryKind;
  scope?: TCategoryScope;
  search?: string;
  includeArchived: boolean;
  limit: number;
  offset: number;
};

function listWhere({
  kind,
  scope,
  search,
  includeArchived,
}: TListCategoriesArgs) {
  return and(
    includeArchived ? undefined : isNull(categories.archivedAt),
    kind ? eq(categories.kind, kind) : undefined,
    scope ? eq(categories.scope, scope) : undefined,
    search ? ilike(categories.name, `%${search}%`) : undefined,
  );
}

export async function listCategories(
  args: TListCategoriesArgs,
): Promise<{ rows: TCategoryRow[]; total: number }> {
  const where = listWhere(args);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(where)
      .orderBy(
        asc(categories.kind),
        asc(categories.sortOrder),
        asc(categories.name),
      )
      .limit(args.limit)
      .offset(args.offset),
    db.select({ value: count() }).from(categories).where(where),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

export async function findCategoryById(
  id: string,
): Promise<TCategoryRow | undefined> {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  return rows[0];
}

export async function insertCategory(
  values: TCategoryInsert,
): Promise<TCategoryRow> {
  const rows = await db.insert(categories).values(values).returning();
  return rows[0]!;
}

export async function updateCategory(
  id: string,
  values: Partial<TCategoryInsert>,
): Promise<TCategoryRow | undefined> {
  const rows = await db
    .update(categories)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();
  return rows[0];
}

/**
 * How many rows across the app point at this category. Drives the
 * archive-vs-hard-delete decision. `budget_overrides` is excluded on purpose —
 * it has no meaning independent of the category and cascades.
 */
export async function countCategoryReferences(id: string): Promise<number> {
  const [txns, rules, plans] = await Promise.all([
    db
      .select({ value: count() })
      .from(transactions)
      .where(eq(transactions.categoryId, id)),
    db
      .select({ value: count() })
      .from(recurringRules)
      .where(eq(recurringRules.categoryId, id)),
    db
      .select({ value: count() })
      .from(installmentPlans)
      .where(eq(installmentPlans.categoryId, id)),
  ]);
  return (
    (txns[0]?.value ?? 0) + (rules[0]?.value ?? 0) + (plans[0]?.value ?? 0)
  );
}

export async function archiveCategory(id: string): Promise<void> {
  await db
    .update(categories)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(categories.id, id));
}

export async function restoreCategory(
  id: string,
): Promise<TCategoryRow | undefined> {
  const rows = await db
    .update(categories)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();
  return rows[0];
}

export async function deleteCategory(id: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
}

/** Transaction counts per category, for the management screen. */
export async function countTransactionsByCategory(): Promise<
  Map<string, number>
> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      value: count(),
    })
    .from(transactions)
    // Transfers carry no category; excluding them keeps the key type honest
    // rather than papering over a null.
    .where(sql`${transactions.categoryId} is not null`)
    .groupBy(transactions.categoryId);
  return new Map(
    rows
      .filter(
        (r): r is { categoryId: string; value: number } =>
          r.categoryId !== null,
      )
      .map((r) => [r.categoryId, r.value]),
  );
}

/**
 * Resolve a category for writing: it must exist, not be archived, and match the
 * transaction type. Returns undefined when missing so the service can 404.
 */
export async function findWritableCategory(
  id: string,
): Promise<TCategoryRow | undefined> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.archivedAt)))
    .limit(1);
  return rows[0];
}

/**
 * Name collision check that mirrors the partial unique index — which is keyed
 * on (scope, kind, lower(name)). Leave scope out and a business "Rent" is
 * wrongly rejected because a personal one exists.
 */
export async function nameTaken(
  scope: TCategoryScope,
  kind: TCategoryKind,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.scope, scope),
        eq(categories.kind, kind),
        sql`lower(${categories.name}) = lower(${name})`,
        isNull(categories.archivedAt),
        exceptId ? or(sql`${categories.id} <> ${exceptId}`) : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

import { and, asc, count, eq, ilike, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { toCentavos } from '../../common/money.js';
import {
  accounts,
  installmentPlans,
  recurringRules,
  transactions,
} from '../../db/schema/index.js';
import type { TAccountKind } from '../../db/schema/index.js';

export type TAccountRow = typeof accounts.$inferSelect;
export type TAccountInsert = typeof accounts.$inferInsert;

export type TListAccountsArgs = {
  kind?: TAccountKind;
  search?: string;
  includeArchived: boolean;
  limit: number;
  offset: number;
};

function listWhere({ kind, search, includeArchived }: TListAccountsArgs) {
  return and(
    includeArchived ? undefined : isNull(accounts.archivedAt),
    kind ? eq(accounts.kind, kind) : undefined,
    search ? ilike(accounts.name, `%${search}%`) : undefined,
  );
}

export async function listAccounts(
  args: TListAccountsArgs,
): Promise<{ rows: TAccountRow[]; total: number }> {
  const where = listWhere(args);
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(where)
      .orderBy(asc(accounts.sortOrder), asc(accounts.name))
      .limit(args.limit)
      .offset(args.offset),
    db.select({ value: count() }).from(accounts).where(where),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

/**
 * Derived balance per account: opening + income − expense.
 *
 * Grouped over transactions only, so accounts with no activity are absent from
 * the map and the service falls back to the opening balance. Transfers are
 * excluded because the type is reserved but unimplemented — when it lands, it
 * must be added here with both legs.
 */
export async function sumMovementByAccount(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountId: transactions.accountId,
      net: sql<string>`
        coalesce(sum(${transactions.amountCentavos})
          filter (where ${transactions.type} = 'income'), 0)
        - coalesce(sum(${transactions.amountCentavos})
          filter (where ${transactions.type} = 'expense'), 0)
      `,
    })
    .from(transactions)
    .groupBy(transactions.accountId);

  return new Map(rows.map((r) => [r.accountId, toCentavos(r.net)]));
}

export async function findAccountById(
  id: string,
): Promise<TAccountRow | undefined> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  return rows[0];
}

export async function findWritableAccount(
  id: string,
): Promise<TAccountRow | undefined> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), isNull(accounts.archivedAt)))
    .limit(1);
  return rows[0];
}

export async function insertAccount(
  values: TAccountInsert,
): Promise<TAccountRow> {
  return db.transaction(async (tx) => {
    if (values.isDefault) {
      await tx.update(accounts).set({ isDefault: false });
    }
    const rows = await tx.insert(accounts).values(values).returning();
    return rows[0]!;
  });
}

export async function updateAccount(
  id: string,
  values: Partial<TAccountInsert>,
): Promise<TAccountRow | undefined> {
  return db.transaction(async (tx) => {
    // The DB enforces at-most-one default; clear the old one first so the
    // unique index never sees two.
    if (values.isDefault) {
      await tx.update(accounts).set({ isDefault: false });
    }
    const rows = await tx
      .update(accounts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(accounts.id, id))
      .returning();
    return rows[0];
  });
}

export async function countAccountReferences(id: string): Promise<number> {
  const [txns, rules, plans] = await Promise.all([
    db
      .select({ value: count() })
      .from(transactions)
      .where(eq(transactions.accountId, id)),
    db
      .select({ value: count() })
      .from(recurringRules)
      .where(eq(recurringRules.accountId, id)),
    db
      .select({ value: count() })
      .from(installmentPlans)
      .where(eq(installmentPlans.accountId, id)),
  ]);
  return (
    (txns[0]?.value ?? 0) + (rules[0]?.value ?? 0) + (plans[0]?.value ?? 0)
  );
}

export async function archiveAccount(id: string): Promise<void> {
  await db
    .update(accounts)
    .set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() })
    .where(eq(accounts.id, id));
}

export async function restoreAccount(
  id: string,
): Promise<TAccountRow | undefined> {
  const rows = await db
    .update(accounts)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(accounts.id, id))
    .returning();
  return rows[0];
}

export async function deleteAccount(id: string): Promise<void> {
  await db.delete(accounts).where(eq(accounts.id, id));
}

export async function nameTaken(
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        sql`lower(${accounts.name}) = lower(${name})`,
        isNull(accounts.archivedAt),
        exceptId ? sql`${accounts.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export type TAccountHistoryRow = {
  id: string;
  type: 'income' | 'expense';
  amountCentavos: number;
  txnDate: string;
  note: string | null;
  source: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  /** Balance AFTER this transaction, opening balance included. */
  runningBalanceCentavos: number;
};

/**
 * One account's ledger, newest first, each row carrying the balance as of that
 * transaction.
 *
 * The running total is a WINDOW FUNCTION rather than a JS reduce, because the
 * result is paginated: summing a single page in the client would restart from
 * zero on page 2 and quietly print wrong balances. The window runs oldest-first
 * over the whole account, then the outer query flips the order for display.
 */
export async function historyForAccount(
  accountId: string,
  openingBalanceCentavos: number,
  limit: number,
  offset: number,
): Promise<{ rows: TAccountHistoryRow[]; total: number }> {
  const rows = await db.execute(sql`
    with ordered as (
      select
        t.id,
        t.type,
        t.amount_centavos,
        t.txn_date,
        t.note,
        t.source,
        t.created_at,
        c.name  as category_name,
        c.icon  as category_icon,
        c.color as category_color,
        ${openingBalanceCentavos}::bigint + sum(
          case when t.type = 'income' then t.amount_centavos
               else -t.amount_centavos end
        ) over (
          order by t.txn_date asc, t.created_at asc, t.id asc
          rows between unbounded preceding and current row
        ) as running_balance
      from transactions t
      join categories c on c.id = t.category_id
      where t.account_id = ${accountId}
        and t.type <> 'transfer'
    )
    select * from ordered
    order by txn_date desc, created_at desc, id desc
    limit ${limit} offset ${offset}
  `);

  const totals = await db
    .select({ value: count() })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        sql`${transactions.type} <> 'transfer'`,
      ),
    );

  // Raw SQL, so the driver returns snake_case with no type information at all.
  // Naming the shape once keeps the mapping below honest.
  type TRaw = {
    id: string;
    type: 'income' | 'expense';
    amount_centavos: string | number;
    txn_date: string;
    note: string | null;
    source: string;
    category_name: string;
    category_icon: string | null;
    category_color: string | null;
    running_balance: string | number;
  };

  const list = rows as unknown as TRaw[];
  return {
    rows: list.map((r) => ({
      id: r.id,
      type: r.type,
      amountCentavos: toCentavos(r.amount_centavos),
      txnDate: r.txn_date,
      note: r.note,
      source: r.source,
      categoryName: r.category_name,
      categoryIcon: r.category_icon,
      categoryColor: r.category_color,
      // sum() over a bigint returns numeric, which postgres.js hands back as a
      // STRING — toCentavos is what stops "1200" + "800" becoming "1200800".
      runningBalanceCentavos: toCentavos(r.running_balance),
    })),
    total: totals[0]?.value ?? 0,
  };
}

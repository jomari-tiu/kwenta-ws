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
 * Derived balance per account: opening + income − expense − transfers out
 * + transfers in.
 *
 * Accounts with no activity are absent from the map and the service falls back
 * to the opening balance.
 */
export async function sumMovementByAccount(): Promise<Map<string, number>> {
  // A transfer has TWO legs and both must move, or money is created or
  // destroyed. The source leg is grouped by account_id and subtracted; the
  // destination leg is a second pass grouped by transfer_account_id and added.
  // The outer sum folds an account's two contributions together.
  const rows = await db.execute(sql`
    select acct as account_id, sum(net)::text as net
    from (
      select account_id as acct,
        coalesce(sum(amount_centavos) filter (where type = 'income'), 0)
        - coalesce(sum(amount_centavos) filter (where type = 'expense'), 0)
        - coalesce(sum(amount_centavos) filter (where type = 'transfer'), 0)
        as net
      from transactions
      group by account_id

      union all

      select transfer_account_id as acct,
        coalesce(sum(amount_centavos), 0) as net
      from transactions
      where type = 'transfer' and transfer_account_id is not null
      group by transfer_account_id
    ) legs
    group by acct
  `);

  const list = rows as unknown as { account_id: string; net: string }[];
  return new Map(list.map((r) => [r.account_id, toCentavos(r.net)]));
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
  type: 'income' | 'expense' | 'transfer';
  /** For a transfer: true when money came INTO this account. */
  isIncoming: boolean;
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
        (t.type = 'transfer' and t.transfer_account_id = ${accountId}) as is_incoming,
        ${openingBalanceCentavos}::bigint + sum(
          -- A transfer counts + or − depending on WHICH SIDE this account is
          -- on. Signing by type alone would make every incoming transfer look
          -- like money leaving.
          case
            when t.type = 'income' then t.amount_centavos
            when t.type = 'transfer' and t.transfer_account_id = ${accountId}
              then t.amount_centavos
            else -t.amount_centavos
          end
        ) over (
          order by t.txn_date asc, t.created_at asc, t.id asc
          rows between unbounded preceding and current row
        ) as running_balance
      from transactions t
      left join categories c on c.id = t.category_id
      where (t.account_id = ${accountId}
             or (t.type = 'transfer' and t.transfer_account_id = ${accountId}))
    )
    select * from ordered
    order by txn_date desc, created_at desc, id desc
    limit ${limit} offset ${offset}
  `);

  const totals = await db
    .select({ value: count() })
    .from(transactions)
    .where(
      sql`(${transactions.accountId} = ${accountId}
           or (${transactions.type} = 'transfer'
               and ${transactions.transferAccountId} = ${accountId}))`,
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
    category_name: string | null;
    is_incoming: boolean;
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
      // Transfers carry no category; label the direction instead of leaving
      // an empty cell the reader has to interpret.
      categoryName:
        r.category_name ?? (r.is_incoming ? 'Transfer in' : 'Transfer out'),
      isIncoming: r.is_incoming,
      categoryIcon: r.category_icon,
      categoryColor: r.category_color,
      // sum() over a bigint returns numeric, which postgres.js hands back as a
      // STRING — toCentavos is what stops "1200" + "800" becoming "1200800".
      runningBalanceCentavos: toCentavos(r.running_balance),
    })),
    total: totals[0]?.value ?? 0,
  };
}

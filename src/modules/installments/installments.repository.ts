import { and, asc, count, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { TPlainDate } from '../../common/date.js';
import { toCentavos } from '../../common/money.js';
import {
  installmentPayments,
  installmentPlans,
  transactions,
} from '../../db/schema/index.js';
import type { TScheduledPayment } from './installments.split.js';

export type TPlanRow = typeof installmentPlans.$inferSelect;
export type TPlanInsert = typeof installmentPlans.$inferInsert;
export type TPaymentRow = typeof installmentPayments.$inferSelect;

export type TPlanProgress = {
  planId: string;
  termCount: number;
  paidCount: number;
  paidCentavos: number;
  nextDueDate: string | null;
  overdueCount: number;
};

/**
 * Five metrics in one grouped pass using FILTER, rather than five queries.
 * `today` comes from the app timezone, never Postgres current_date — the DB may
 * be running in UTC.
 */
export async function progressByPlan(
  today: TPlainDate,
): Promise<Map<string, TPlanProgress>> {
  const rows = await db
    .select({
      planId: installmentPayments.planId,
      termCount: sql<number>`count(*)::int`,
      paidCount: sql<number>`count(*) filter (where ${installmentPayments.status} = 'paid')::int`,
      paidCentavos: sql<string>`coalesce(sum(${installmentPayments.amountCentavos}) filter (where ${installmentPayments.status} = 'paid'), 0)`,
      nextDueDate: sql<
        string | null
      >`min(${installmentPayments.dueDate}) filter (where ${installmentPayments.status} = 'pending')`,
      overdueCount: sql<number>`count(*) filter (where ${installmentPayments.status} = 'pending' and ${installmentPayments.dueDate} < ${today})::int`,
    })
    .from(installmentPayments)
    .groupBy(installmentPayments.planId);

  return new Map(
    rows.map((r) => [
      r.planId,
      {
        planId: r.planId,
        termCount: r.termCount,
        paidCount: r.paidCount,
        paidCentavos: toCentavos(r.paidCentavos),
        nextDueDate: r.nextDueDate,
        overdueCount: r.overdueCount,
      },
    ]),
  );
}

export async function listPlans(
  limit: number,
  offset: number,
): Promise<{ rows: TPlanRow[]; total: number }> {
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(installmentPlans)
      .orderBy(asc(installmentPlans.startDate))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(installmentPlans),
  ]);
  return { rows, total: totals[0]?.value ?? 0 };
}

export async function findPlanById(id: string): Promise<TPlanRow | undefined> {
  const rows = await db
    .select()
    .from(installmentPlans)
    .where(eq(installmentPlans.id, id))
    .limit(1);
  return rows[0];
}

export async function listPaymentsForPlan(
  planId: string,
): Promise<TPaymentRow[]> {
  return db
    .select()
    .from(installmentPayments)
    .where(eq(installmentPayments.planId, planId))
    .orderBy(asc(installmentPayments.sequenceNo));
}

/** Plan + its whole schedule, in one transaction. */
export async function insertPlanWithSchedule(
  plan: TPlanInsert,
  schedule: TScheduledPayment[],
): Promise<{ plan: TPlanRow; payments: TPaymentRow[] }> {
  return db.transaction(async (tx) => {
    const planRows = await tx.insert(installmentPlans).values(plan).returning();
    const created = planRows[0]!;

    const payments = await tx
      .insert(installmentPayments)
      .values(
        schedule.map((s) => ({
          planId: created.id,
          sequenceNo: s.sequenceNo,
          dueDate: s.dueDate,
          amountCentavos: s.amountCentavos,
        })),
      )
      .returning();

    return { plan: created, payments };
  });
}

export async function updatePlanMetadata(
  id: string,
  values: Partial<TPlanInsert>,
): Promise<TPlanRow | undefined> {
  const rows = await db
    .update(installmentPlans)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(installmentPlans.id, id))
    .returning();
  return rows[0];
}

/** Regenerate the schedule. Only legal while nothing is paid. */
export async function replaceSchedule(
  planId: string,
  values: Partial<TPlanInsert>,
  schedule: TScheduledPayment[],
): Promise<TPlanRow | undefined> {
  return db.transaction(async (tx) => {
    await tx
      .delete(installmentPayments)
      .where(eq(installmentPayments.planId, planId));
    await tx.insert(installmentPayments).values(
      schedule.map((s) => ({
        planId,
        sequenceNo: s.sequenceNo,
        dueDate: s.dueDate,
        amountCentavos: s.amountCentavos,
      })),
    );
    const rows = await tx
      .update(installmentPlans)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(installmentPlans.id, planId))
      .returning();
    return rows[0];
  });
}

export async function countPaid(planId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(installmentPayments)
    .where(
      and(
        eq(installmentPayments.planId, planId),
        eq(installmentPayments.status, 'paid'),
      ),
    );
  return rows[0]?.value ?? 0;
}

/**
 * Mark a payment paid and create its expense, atomically.
 *
 * The `FOR UPDATE` row lock is the real double-click fix — a bare
 * `if (status === 'paid') throw` races. The unique index on
 * transactions.installment_payment_id is the belt-and-braces backstop.
 */
export async function payPayment(args: {
  paymentId: string;
  plan: TPlanRow;
  paidDate: TPlainDate;
  amountCentavos: number;
  accountId: string;
  note: string;
}): Promise<{ payment: TPaymentRow; transactionId: string } | 'already_paid'> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(installmentPayments)
      .where(eq(installmentPayments.id, args.paymentId))
      .for('update')
      .limit(1);

    const payment = locked[0];
    if (!payment) throw new Error('payment_not_found');
    if (payment.status === 'paid') return 'already_paid' as const;

    const txnRows = await tx
      .insert(transactions)
      .values({
        type: 'expense',
        amountCentavos: args.amountCentavos,
        txnDate: args.paidDate,
        categoryId: args.plan.categoryId,
        accountId: args.accountId,
        note: args.note,
        source: 'installment',
        installmentPaymentId: args.paymentId,
      })
      .returning({ id: transactions.id });

    const updated = await tx
      .update(installmentPayments)
      .set({
        status: 'paid',
        paidDate: args.paidDate,
        updatedAt: new Date(),
      })
      .where(eq(installmentPayments.id, args.paymentId))
      .returning();

    return { payment: updated[0]!, transactionId: txnRows[0]!.id };
  });
}

export async function unpayPayment(paymentId: string): Promise<
  | {
      payment: TPaymentRow;
      deleted: { id: string; amountCentavos: number; txnDate: string } | null;
    }
  | 'not_paid'
> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(installmentPayments)
      .where(eq(installmentPayments.id, paymentId))
      .for('update')
      .limit(1);

    const payment = locked[0];
    if (!payment) throw new Error('payment_not_found');
    if (payment.status !== 'paid') return 'not_paid' as const;

    // The generated expense is derived; keeping it would double-count.
    const removed = await tx
      .delete(transactions)
      .where(eq(transactions.installmentPaymentId, paymentId))
      .returning({
        id: transactions.id,
        amountCentavos: transactions.amountCentavos,
        txnDate: transactions.txnDate,
      });

    const updated = await tx
      .update(installmentPayments)
      .set({ status: 'pending', paidDate: null, updatedAt: new Date() })
      .where(eq(installmentPayments.id, paymentId))
      .returning();

    return { payment: updated[0]!, deleted: removed[0] ?? null };
  });
}

export async function findPaymentById(
  id: string,
): Promise<TPaymentRow | undefined> {
  const rows = await db
    .select()
    .from(installmentPayments)
    .where(eq(installmentPayments.id, id))
    .limit(1);
  return rows[0];
}

/**
 * Delete a plan. Payments cascade. The generated expenses SURVIVE with a null
 * FK — that was real money leaving the account, and deleting it would corrupt
 * past totals and the account balance.
 */
export async function deletePlan(
  id: string,
  deleteGeneratedTransactions: boolean,
): Promise<{ deletedPaymentCount: number; deletedTransactionCount: number }> {
  return db.transaction(async (tx) => {
    const payments = await tx
      .select({ id: installmentPayments.id })
      .from(installmentPayments)
      .where(eq(installmentPayments.planId, id));

    let deletedTransactionCount = 0;
    if (deleteGeneratedTransactions && payments.length > 0) {
      const removed = await tx
        .delete(transactions)
        .where(
          inArray(
            transactions.installmentPaymentId,
            payments.map((p) => p.id),
          ),
        )
        .returning({ id: transactions.id });
      deletedTransactionCount = removed.length;
    }

    await tx.delete(installmentPlans).where(eq(installmentPlans.id, id));
    return { deletedPaymentCount: payments.length, deletedTransactionCount };
  });
}

export type TInstallmentSummary = {
  activePlanCount: number;
  pendingCount: number;
  overdueCount: number;
  dueSoonCount: number;
  totalRemainingCentavos: number;
  nextDueDate: string | null;
};

export async function summary(
  today: TPlainDate,
  dueSoonCutoff: TPlainDate,
): Promise<TInstallmentSummary> {
  const rows = await db
    .select({
      pendingCount: sql<number>`count(*) filter (where ${installmentPayments.status} = 'pending')::int`,
      overdueCount: sql<number>`count(*) filter (where ${installmentPayments.status} = 'pending' and ${installmentPayments.dueDate} < ${today})::int`,
      dueSoonCount: sql<number>`count(*) filter (where ${installmentPayments.status} = 'pending' and ${installmentPayments.dueDate} >= ${today} and ${installmentPayments.dueDate} <= ${dueSoonCutoff})::int`,
      remaining: sql<string>`coalesce(sum(${installmentPayments.amountCentavos}) filter (where ${installmentPayments.status} = 'pending'), 0)`,
      nextDueDate: sql<
        string | null
      >`min(${installmentPayments.dueDate}) filter (where ${installmentPayments.status} = 'pending')`,
    })
    .from(installmentPayments);

  const activePlans = await db
    .select({ value: count(sql`distinct ${installmentPayments.planId}`) })
    .from(installmentPayments)
    .where(eq(installmentPayments.status, 'pending'));

  const r = rows[0];
  return {
    activePlanCount: activePlans[0]?.value ?? 0,
    pendingCount: r?.pendingCount ?? 0,
    overdueCount: r?.overdueCount ?? 0,
    dueSoonCount: r?.dueSoonCount ?? 0,
    totalRemainingCentavos: toCentavos(r?.remaining),
    nextDueDate: r?.nextDueDate ?? null,
  };
}

/** Dues in a date range, joined to their plan — for the calendar. */
export type TDueRow = {
  id: string;
  planId: string;
  planName: string;
  sequenceNo: number;
  termMonths: number;
  dueDate: string;
  amountCentavos: number;
  status: 'pending' | 'paid';
  paidDate: string | null;
  transactionId: string | null;
  categoryId: string;
  accountId: string;
};

export async function listDuesBetween(
  from: TPlainDate,
  to: TPlainDate,
): Promise<TDueRow[]> {
  const rows = await db
    .select({
      id: installmentPayments.id,
      planId: installmentPayments.planId,
      planName: installmentPlans.name,
      sequenceNo: installmentPayments.sequenceNo,
      termMonths: installmentPlans.termMonths,
      dueDate: installmentPayments.dueDate,
      amountCentavos: installmentPayments.amountCentavos,
      status: installmentPayments.status,
      paidDate: installmentPayments.paidDate,
      transactionId: transactions.id,
      categoryId: installmentPlans.categoryId,
      accountId: installmentPlans.accountId,
    })
    .from(installmentPayments)
    .innerJoin(
      installmentPlans,
      eq(installmentPayments.planId, installmentPlans.id),
    )
    .leftJoin(
      transactions,
      eq(transactions.installmentPaymentId, installmentPayments.id),
    )
    .where(
      and(
        sql`${installmentPayments.dueDate} >= ${from}`,
        sql`${installmentPayments.dueDate} <= ${to}`,
      ),
    )
    .orderBy(asc(installmentPayments.dueDate));
  return rows;
}

/** Unused today, kept because the dashboard's overdue tile will want it. */
export async function countOverdue(today: TPlainDate): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(installmentPayments)
    .where(
      and(
        eq(installmentPayments.status, 'pending'),
        lt(installmentPayments.dueDate, today),
        isNull(installmentPayments.paidDate),
      ),
    );
  return rows[0]?.value ?? 0;
}

import {
  addMonths,
  partsOf,
  plainDateForDayOfMonth,
  type TPlainDate,
} from '../../common/date.js';
import { splitCentavos, type TCentavos } from '../../common/money.js';

export type TScheduledPayment = {
  sequenceNo: number;
  dueDate: TPlainDate;
  amountCentavos: TCentavos;
};

export type TGenerateScheduleArgs = {
  totalCentavos: TCentavos;
  termMonths: number;
  startDate: TPlainDate;
  dayOfMonth: number;
};

/**
 * Generate an installment schedule. Pure — no DB, no clock.
 *
 * Two invariants this function exists to hold:
 *
 * 1. `sum(amountCentavos) === totalCentavos`, exactly, for every input. The
 *    remainder lands on the LAST payment, matching how PH lenders amortize.
 *
 * 2. Due dates are generated INDEPENDENTLY from (startMonth + i), never by
 *    iterating from the previous date. `addMonths(Jan 31, 1)` is Feb 28, and
 *    stepping again from *that* gives Mar 28 — the day-of-month silently drifts
 *    for the rest of the plan. Generating each date from the anchor means
 *    day 31 clamps to Feb 28 and then returns to Mar 31.
 */
export function generateSchedule({
  totalCentavos,
  termMonths,
  startDate,
  dayOfMonth,
}: TGenerateScheduleArgs): TScheduledPayment[] {
  const amounts = splitCentavos(totalCentavos, termMonths);
  const start = partsOf(startDate);

  return amounts.map((amountCentavos, i) => {
    const { year, month } = addMonths(start.year, start.month, i);
    return {
      sequenceNo: i + 1,
      // Clamped per month, from the original dayOfMonth every time.
      dueDate: plainDateForDayOfMonth(year, month, dayOfMonth),
      amountCentavos,
    };
  });
}

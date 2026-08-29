import {
  addDays,
  addMonths,
  isoDayOfWeek,
  partsOf,
  plainDateForDayOfMonth,
  type TPlainDate,
} from '../../common/date.js';
import type { TRecurringFrequency } from '../../db/schema/index.js';

export type TRecurrenceSpec = {
  frequency: TRecurringFrequency;
  interval: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  startDate: TPlainDate;
  endDate: TPlainDate | null;
};

/**
 * Backstop against a typo'd startDate (e.g. 1990 on a weekly rule) trying
 * thousands of inserts.
 */
export const OCCURRENCE_CAP = 500;

/**
 * Every occurrence of `spec` within [fromDate, toDate], inclusive both ends.
 *
 * Pure and idempotent: same inputs always produce the same list, and there is
 * no `new Date()` inside — callers pass the window explicitly.
 *
 * Semantics worth stating, because each is a bug someone ships:
 *  - `biweekly` means every 14 days from startDate, NOT "twice a month".
 *  - monthly with dayOfMonth 31 clamps to the month's last day and does NOT
 *    roll into the next month; the anchor stays 31, so March returns to the
 *    31st rather than sticking at 28.
 *  - yearly on Feb 29 clamps to Feb 28 in non-leap years.
 *  - `endDate` is inclusive.
 */
export function occurrencesBetween(
  spec: TRecurrenceSpec,
  fromDate: TPlainDate,
  toDate: TPlainDate,
  cap: number = OCCURRENCE_CAP,
): TPlainDate[] {
  const hardEnd = spec.endDate && spec.endDate < toDate ? spec.endDate : toDate;
  if (hardEnd < spec.startDate) return [];
  if (hardEnd < fromDate) return [];

  const out: TPlainDate[] = [];
  const step = Math.max(1, spec.interval);

  const push = (d: TPlainDate): boolean => {
    if (d > hardEnd) return false;
    if (d >= fromDate && d >= spec.startDate) out.push(d);
    return out.length < cap;
  };

  switch (spec.frequency) {
    case 'weekly':
    case 'biweekly': {
      const strideDays = (spec.frequency === 'biweekly' ? 14 : 7) * step;
      // Align the anchor to the rule's weekday without moving it backwards
      // past startDate.
      const target = spec.dayOfWeek ?? isoDayOfWeek(spec.startDate);
      const startDow = isoDayOfWeek(spec.startDate);
      const offset = (target - startDow + 7) % 7;
      let cursor = addDays(spec.startDate, offset);

      while (cursor <= hardEnd) {
        if (!push(cursor)) break;
        cursor = addDays(cursor, strideDays);
      }
      break;
    }

    case 'monthly': {
      const dom = spec.dayOfMonth ?? partsOf(spec.startDate).day;
      const start = partsOf(spec.startDate);
      for (let i = 0; ; i += 1) {
        const { year, month } = addMonths(start.year, start.month, i * step);
        const d = plainDateForDayOfMonth(year, month, dom);
        if (d > hardEnd) break;
        if (!push(d)) break;
        if (i > cap * 2) break;
      }
      break;
    }

    case 'yearly': {
      const dom = spec.dayOfMonth ?? partsOf(spec.startDate).day;
      const moy = spec.monthOfYear ?? partsOf(spec.startDate).month;
      const startYear = partsOf(spec.startDate).year;
      for (let i = 0; ; i += 1) {
        const year = startYear + i * step;
        const d = plainDateForDayOfMonth(year, moy, dom);
        if (d > hardEnd) break;
        if (!push(d)) break;
        if (i > cap) break;
      }
      break;
    }
  }

  return out;
}

/** The next occurrence strictly after `after`, or null past endDate. */
export function nextOccurrenceAfter(
  spec: TRecurrenceSpec,
  after: TPlainDate,
  horizonDays = 800,
): TPlainDate | null {
  const from = addDays(after, 1);
  const to = addDays(after, horizonDays);
  const list = occurrencesBetween(spec, from, to, 1);
  return list[0] ?? null;
}

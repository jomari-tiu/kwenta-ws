import {
  addDays,
  addMonths,
  firstDayOfMonth,
  lastDayOfMonth,
  mondayOf,
  monthKeyOf,
  partsOf,
  plainDateForDayOfMonth,
  type TPlainDate,
} from '../../common/date.js';
import type { TGranularity, TSeriesRow } from './dashboard.repository.js';

export type TPeriod = 'week' | 'month' | 'year';

export type TPeriodWindow = {
  from: TPlainDate;
  to: TPlainDate;
  granularity: TGranularity;
  label: string;
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `period` selects range AND granularity:
 *   week  -> 7 daily buckets (Mon..Sun of the anchor's week)
 *   month -> one daily bucket per day of the month
 *   year  -> 12 monthly buckets
 */
export function windowFor(period: TPeriod, anchor: TPlainDate): TPeriodWindow {
  const { year, month } = partsOf(anchor);

  if (period === 'week') {
    const from = mondayOf(anchor);
    return {
      from,
      to: addDays(from, 6),
      granularity: 'daily',
      label: `Week of ${from}`,
    };
  }

  if (period === 'month') {
    const key = monthKeyOf(anchor);
    return {
      from: firstDayOfMonth(key),
      to: lastDayOfMonth(key),
      granularity: 'daily',
      label: `${MONTHS[month - 1]} ${year}`,
    };
  }

  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    granularity: 'monthly',
    label: String(year),
  };
}

/** Every bucket start in [from, to] for the granularity, inclusive. */
export function bucketStarts(
  from: TPlainDate,
  to: TPlainDate,
  granularity: TGranularity,
): TPlainDate[] {
  const out: TPlainDate[] = [];

  if (granularity === 'daily') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }

  if (granularity === 'weekly') {
    for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) out.push(d);
    return out;
  }

  const start = partsOf(from);
  for (let i = 0; ; i += 1) {
    const { year, month } = addMonths(start.year, start.month, i);
    const d = plainDateForDayOfMonth(year, month, 1);
    if (d > to) break;
    out.push(d);
  }
  return out;
}

export type TSeriesPoint = TSeriesRow & { label: string; netCentavos: number };

function labelFor(bucket: TPlainDate, granularity: TGranularity): string {
  const { month, day } = partsOf(bucket);
  if (granularity === 'monthly') return MONTHS[month - 1]!.slice(0, 3);
  if (granularity === 'weekly')
    return `${MONTHS[month - 1]!.slice(0, 3)} ${day}`;
  return String(day);
}

/**
 * Fill gaps in JS rather than with a generate_series LEFT JOIN. The series is
 * at most 53 points, and a pure function is far easier to test.
 */
export function fillBuckets(
  rows: TSeriesRow[],
  from: TPlainDate,
  to: TPlainDate,
  granularity: TGranularity,
): TSeriesPoint[] {
  const byBucket = new Map(rows.map((r) => [r.bucket, r]));

  return bucketStarts(from, to, granularity).map((bucket) => {
    const hit = byBucket.get(bucket);
    const incomeCentavos = hit?.incomeCentavos ?? 0;
    const expenseCentavos = hit?.expenseCentavos ?? 0;
    return {
      bucket,
      label: labelFor(bucket, granularity),
      incomeCentavos,
      expenseCentavos,
      netCentavos: incomeCentavos - expenseCentavos,
      transactionCount: hit?.transactionCount ?? 0,
    };
  });
}

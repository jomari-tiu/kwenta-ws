import { env } from '../config/env.js';

/** 'YYYY-MM-DD' — a calendar day with no time and no zone. */
export type TPlainDate = string;
/** 'YYYY-MM' */
export type TMonthKey = string;

// 'en-CA' formats as YYYY-MM-DD, which is exactly the shape we want.
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.APP_TIMEZONE,
});

/**
 * Today, in the app's timezone.
 *
 * Never `new Date().toISOString().slice(0, 10)` — that is UTC, and it is wrong
 * for the first 8 hours of every Manila day. Every "is this overdue?" decision
 * goes through here so the server and the client agree.
 */
export function todayInAppTz(now: Date = new Date()): TPlainDate {
  return dayFormatter.format(now);
}

/** Chronological comparison. Zero-padded ISO strings compare lexicographically. */
export function isBeforeDate(a: TPlainDate, b: TPlainDate): boolean {
  return a < b;
}

export function monthKeyOf(d: TPlainDate): TMonthKey {
  return d.slice(0, 7);
}

/** Days in a given 1-indexed month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * A plain date for the given day-of-month, clamped to the month's last day.
 *
 * Clamping must NOT move the anchor: a plan on day 31 falls on Feb 28 and then
 * returns to Mar 31. Callers must therefore always pass the original
 * `dayOfMonth`, never the clamped result of the previous month.
 */
export function plainDateForDayOfMonth(
  year: number,
  month: number,
  dayOfMonth: number,
): TPlainDate {
  const clamped = Math.min(dayOfMonth, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

/** Split 'YYYY-MM-DD' into numeric parts without constructing a Date. */
export function partsOf(d: TPlainDate): {
  year: number;
  month: number;
  day: number;
} {
  const year = Number(d.slice(0, 4));
  const month = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return { year, month, day };
}

/** Advance a (year, month) pair by n months. `month` is 1-indexed. */
export function addMonths(
  year: number,
  month: number,
  n: number,
): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + n;
  return {
    year: Math.floor(zeroBased / 12),
    month: (zeroBased % 12) + 1,
  };
}

/** Add whole days to a plain date. Uses UTC arithmetic so no zone can shift it. */
export function addDays(d: TPlainDate, n: number): TPlainDate {
  const { year, month, day } = partsOf(d);
  const t = Date.UTC(year, month - 1, day) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO day of week: Monday = 1 … Sunday = 7. */
export function isoDayOfWeek(d: TPlainDate): number {
  const { year, month, day } = partsOf(d);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** The Monday of the week containing `d`. */
export function mondayOf(d: TPlainDate): TPlainDate {
  return addDays(d, -(isoDayOfWeek(d) - 1));
}

export function firstDayOfMonth(k: TMonthKey): TPlainDate {
  return `${k}-01`;
}

export function lastDayOfMonth(k: TMonthKey): TPlainDate {
  const year = Number(k.slice(0, 4));
  const month = Number(k.slice(5, 7));
  return plainDateForDayOfMonth(year, month, 31);
}

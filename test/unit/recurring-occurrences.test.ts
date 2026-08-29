import { describe, expect, it } from 'vitest';
import {
  occurrencesBetween,
  type TRecurrenceSpec,
} from '../../src/modules/recurring/recurring.occurrences.js';

const base: TRecurrenceSpec = {
  frequency: 'monthly',
  interval: 1,
  dayOfWeek: null,
  dayOfMonth: 15,
  monthOfYear: null,
  startDate: '2026-01-15',
  endDate: null,
};

describe('occurrencesBetween — monthly', () => {
  it('emits the 15th of each month', () => {
    expect(occurrencesBetween(base, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('clamps day 31 per month and RETURNS to 31 (anchor never moves)', () => {
    const spec = { ...base, dayOfMonth: 31, startDate: '2026-01-31' };
    expect(occurrencesBetween(spec, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('is a katapusan rule when dayOfMonth is 31', () => {
    // Kinsenas/katapusan is two monthly rules: day 15 and day 31.
    const spec = { ...base, dayOfMonth: 31, startDate: '2028-01-31' };
    const got = occurrencesBetween(spec, '2028-02-01', '2028-02-29');
    expect(got).toEqual(['2028-02-29']); // leap year
  });

  it('honours interval > 1', () => {
    const spec = { ...base, interval: 3 };
    expect(occurrencesBetween(spec, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
    ]);
  });

  it('treats endDate as INCLUSIVE', () => {
    const spec = { ...base, endDate: '2026-03-15' };
    expect(occurrencesBetween(spec, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('never emits before startDate', () => {
    const spec = { ...base, startDate: '2026-03-15' };
    expect(occurrencesBetween(spec, '2026-01-01', '2026-04-30')).toEqual([
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('returns empty when the window precedes startDate', () => {
    expect(occurrencesBetween(base, '2025-01-01', '2025-12-31')).toEqual([]);
  });
});

describe('occurrencesBetween — weekly and biweekly', () => {
  it('weekly emits every 7 days on the target weekday', () => {
    // 2026-01-05 is a Monday.
    const spec: TRecurrenceSpec = {
      ...base,
      frequency: 'weekly',
      dayOfWeek: 1,
      dayOfMonth: null,
      startDate: '2026-01-05',
    };
    expect(occurrencesBetween(spec, '2026-01-01', '2026-02-02')).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
      '2026-02-02',
    ]);
  });

  it('biweekly means every 14 days, NOT twice a month', () => {
    const spec: TRecurrenceSpec = {
      ...base,
      frequency: 'biweekly',
      dayOfWeek: 1,
      dayOfMonth: null,
      startDate: '2026-01-05',
    };
    const got = occurrencesBetween(spec, '2026-01-01', '2026-03-02');
    expect(got).toEqual([
      '2026-01-05',
      '2026-01-19',
      '2026-02-02',
      '2026-02-16',
      '2026-03-02',
    ]);
    // Every gap is exactly 14 days.
    for (let i = 1; i < got.length; i += 1) {
      const a = Date.parse(`${got[i - 1]!}T00:00:00Z`);
      const b = Date.parse(`${got[i]!}T00:00:00Z`);
      expect((b - a) / 86_400_000).toBe(14);
    }
  });

  it('advances the anchor forward to the target weekday, never backward', () => {
    // startDate is a Wednesday (2026-01-07); rule targets Friday (5).
    const spec: TRecurrenceSpec = {
      ...base,
      frequency: 'weekly',
      dayOfWeek: 5,
      dayOfMonth: null,
      startDate: '2026-01-07',
    };
    const got = occurrencesBetween(spec, '2026-01-01', '2026-01-31');
    expect(got[0]).toBe('2026-01-09');
    expect(got.every((d) => d >= '2026-01-07')).toBe(true);
  });
});

describe('occurrencesBetween — yearly', () => {
  it('emits one per year on the given month/day', () => {
    const spec: TRecurrenceSpec = {
      ...base,
      frequency: 'yearly',
      dayOfMonth: 15,
      monthOfYear: 8,
      startDate: '2026-08-15',
    };
    expect(occurrencesBetween(spec, '2026-01-01', '2029-12-31')).toEqual([
      '2026-08-15',
      '2027-08-15',
      '2028-08-15',
      '2029-08-15',
    ]);
  });

  it('clamps Feb 29 to Feb 28 in non-leap years', () => {
    const spec: TRecurrenceSpec = {
      ...base,
      frequency: 'yearly',
      dayOfMonth: 29,
      monthOfYear: 2,
      startDate: '2028-02-29',
    };
    expect(occurrencesBetween(spec, '2028-01-01', '2030-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
    ]);
  });
});

describe('occurrencesBetween — determinism and safety', () => {
  it('is idempotent: identical inputs give identical output', () => {
    const a = occurrencesBetween(base, '2026-01-01', '2026-12-31');
    const b = occurrencesBetween(base, '2026-01-01', '2026-12-31');
    expect(a).toEqual(b);
  });

  it('respects the occurrence cap', () => {
    const spec: TRecurrenceSpec = {
      ...base,
      frequency: 'weekly',
      dayOfWeek: 1,
      dayOfMonth: null,
      startDate: '1990-01-01',
    };
    // A typo'd startDate must not try thousands of inserts.
    expect(
      occurrencesBetween(spec, '1990-01-01', '2026-12-31', 50),
    ).toHaveLength(50);
  });
});

import { describe, expect, it } from 'vitest';
import { splitCentavos } from '../../src/common/money.js';
import { generateSchedule } from '../../src/modules/installments/installments.split.js';

describe('splitCentavos', () => {
  it('sums to exactly the total across a wide sweep of inputs', () => {
    for (let total = 1; total <= 20_000; total += 37) {
      for (let parts = 1; parts <= 24; parts += 1) {
        if (total < parts) continue;
        const split = splitCentavos(total, parts);
        const label = `total=${total} parts=${parts}`;

        expect(
          split.reduce((a, b) => a + b, 0),
          label,
        ).toBe(total);
        expect(split, label).toHaveLength(parts);
        expect(Math.min(...split), label).toBeGreaterThan(0);

        // The contract is "remainder on the LAST payment", so:
        //   - every payment except the last is identical, and
        //   - the last carries the remainder, which is (total % parts)
        //     centavos more than the others — up to parts-1, NOT 1.
        // (Capping the spread at 1 centavo would be the other convention:
        // distributing the remainder across the earliest payments. We
        // deliberately don't, because lenders bill the residual last.)
        const head = split.slice(0, -1);
        const last = split[split.length - 1]!;
        if (head.length > 0) {
          expect(new Set(head).size, label).toBe(1);
          expect(last - head[0]!, label).toBe(total % parts);
          expect(last - head[0]!, label).toBeLessThanOrEqual(parts - 1);
        }
      }
    }
  });

  it('puts the remainder on the LAST payment', () => {
    // PHP 10,000 over 3 => 3333.33, 3333.33, 3333.34
    expect(splitCentavos(1_000_000, 3)).toEqual([333_333, 333_333, 333_334]);
  });

  it('divides evenly when it can', () => {
    expect(splitCentavos(3_000_000, 12)).toEqual(Array(12).fill(250_000));
  });

  it('handles a single payment', () => {
    expect(splitCentavos(123_456, 1)).toEqual([123_456]);
  });

  it('rejects a total smaller than one centavo per part', () => {
    expect(() => splitCentavos(5, 12)).toThrow(/at least 1 centavo/);
  });

  it('rejects non-positive or non-integer input', () => {
    expect(() => splitCentavos(0, 3)).toThrow();
    expect(() => splitCentavos(-100, 3)).toThrow();
    expect(() => splitCentavos(100.5, 3)).toThrow();
    expect(() => splitCentavos(100, 0)).toThrow();
  });
});

describe('generateSchedule', () => {
  it('generates the PHP 30,000 / 12-month / day-15 plan exactly', () => {
    const schedule = generateSchedule({
      totalCentavos: 3_000_000,
      termMonths: 12,
      startDate: '2026-08-15',
      dayOfMonth: 15,
    });

    expect(schedule).toHaveLength(12);
    expect(schedule.reduce((a, p) => a + p.amountCentavos, 0)).toBe(3_000_000);
    expect(schedule[0]).toEqual({
      sequenceNo: 1,
      dueDate: '2026-08-15',
      amountCentavos: 250_000,
    });
    expect(schedule[11]!.dueDate).toBe('2027-07-15');
  });

  it('clamps day 31 to February AND RETURNS to 31 in March (no drift)', () => {
    // This is the specific bug the function exists to not have: iterating from
    // the previous date would give Feb 28 -> Mar 28 and stay wrong forever.
    const schedule = generateSchedule({
      totalCentavos: 400_000,
      termMonths: 4,
      startDate: '2026-01-31',
      dayOfMonth: 31,
    });

    expect(schedule.map((p) => p.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('clamps to Feb 29 in a leap year', () => {
    const schedule = generateSchedule({
      totalCentavos: 200_000,
      termMonths: 2,
      startDate: '2028-01-31',
      dayOfMonth: 31,
    });
    expect(schedule[1]!.dueDate).toBe('2028-02-29');
  });

  it('crosses a year boundary over 24 months', () => {
    const schedule = generateSchedule({
      totalCentavos: 2_400_000,
      termMonths: 24,
      startDate: '2026-11-05',
      dayOfMonth: 5,
    });
    expect(schedule).toHaveLength(24);
    expect(schedule[0]!.dueDate).toBe('2026-11-05');
    expect(schedule[13]!.dueDate).toBe('2027-12-05');
    expect(schedule[23]!.dueDate).toBe('2028-10-05');
    expect(schedule.reduce((a, p) => a + p.amountCentavos, 0)).toBe(2_400_000);
  });

  it('sums exactly even when the total does not divide by the term', () => {
    const schedule = generateSchedule({
      totalCentavos: 999_999,
      termMonths: 7,
      startDate: '2026-03-10',
      dayOfMonth: 10,
    });
    expect(schedule.reduce((a, p) => a + p.amountCentavos, 0)).toBe(999_999);
  });

  it('numbers sequences from 1', () => {
    const schedule = generateSchedule({
      totalCentavos: 300_000,
      termMonths: 3,
      startDate: '2026-06-01',
      dayOfMonth: 1,
    });
    expect(schedule.map((p) => p.sequenceNo)).toEqual([1, 2, 3]);
  });
});

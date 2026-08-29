import { env } from '../../config/env.js';
import { addDays, todayInAppTz, type TPlainDate } from '../../common/date.js';
import { logger } from '../../middleware/request-logger.js';
import * as repo from './recurring.repository.js';
import {
  OCCURRENCE_CAP,
  occurrencesBetween,
  type TRecurrenceSpec,
} from './recurring.occurrences.js';

/**
 * Lazy catch-up materialization.
 *
 * Why on read rather than a cron: a scheduler needs a process that is reliably
 * awake, and this app is not guaranteed to have one. Triggering from the very
 * request that needs the data means the work always happens exactly when it
 * matters.
 *
 * This does make those GETs side-effecting, which is a real REST violation. It
 * is accepted consciously and confined to this file plus one middleware:
 * the pass is idempotent (unique index + ON CONFLICT DO NOTHING), throttled
 * in-process, and guarded by a Postgres advisory lock.
 *
 * Only past-and-today occurrences are written. Future ones are projected at
 * query time so `netBalance` stays truth rather than forecast.
 */

let lastRunAtMs = 0;

export function specOf(rule: repo.TRuleRow): TRecurrenceSpec {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    dayOfWeek: rule.dayOfWeek,
    dayOfMonth: rule.dayOfMonth,
    monthOfYear: rule.monthOfYear,
    startDate: rule.startDate,
    endDate: rule.endDate,
  };
}

export type TMaterializeResult = {
  createdCount: number;
  byRule: { ruleId: string; name: string; created: number }[];
  skipped: 'throttled' | 'locked' | 'disabled' | null;
};

export async function materializeDue(
  options: { force?: boolean; now?: number } = {},
): Promise<TMaterializeResult> {
  const empty: TMaterializeResult = {
    createdCount: 0,
    byRule: [],
    skipped: null,
  };

  if (!env.RECURRING_CATCHUP_ENABLED && !options.force) {
    return { ...empty, skipped: 'disabled' };
  }

  const now = options.now ?? Date.now();
  const minGapMs = env.RECURRING_CATCHUP_MIN_INTERVAL_SEC * 1000;
  if (!options.force && now - lastRunAtMs < minGapMs) {
    return { ...empty, skipped: 'throttled' };
  }

  // In-memory guard first (cheap), advisory lock second (correct).
  const gotLock = await repo.tryAdvisoryLock();
  if (!gotLock) return { ...empty, skipped: 'locked' };

  try {
    lastRunAtMs = now;
    const today = todayInAppTz(new Date(now));
    const rules = await repo.listMaterializable();

    const byRule: TMaterializeResult['byRule'] = [];
    let createdCount = 0;

    for (const rule of rules) {
      // The cursor only avoids recomputing from startDate on every request. If
      // it is stale we do extra work; we never create duplicates, because the
      // unique index is what enforces that.
      const from = rule.lastMaterializedDate
        ? addDays(rule.lastMaterializedDate, 1)
        : rule.startDate;

      if (from > today) continue;

      const dates = occurrencesBetween(
        specOf(rule),
        from,
        today,
        OCCURRENCE_CAP,
      );

      const created = await repo.insertOccurrences(rule, dates);
      if (created > 0) {
        byRule.push({ ruleId: rule.id, name: rule.name, created });
        createdCount += created;
      }
      await repo.setLastMaterialized(rule.id, today);
    }

    if (createdCount > 0) {
      logger.info(
        { createdCount, byRule },
        'Materialized recurring occurrences',
      );
    }
    return { createdCount, byRule, skipped: null };
  } finally {
    await repo.releaseAdvisoryLock();
  }
}

/**
 * Future occurrences for display only — never written. Returned with a flag so
 * the calendar can render them distinctly from real rows.
 */
export function projectFuture(
  rules: repo.TRuleRow[],
  from: TPlainDate,
  to: TPlainDate,
  today: TPlainDate,
): { rule: repo.TRuleRow; date: TPlainDate }[] {
  const start = from > today ? from : addDays(today, 1);
  if (start > to) return [];

  const out: { rule: repo.TRuleRow; date: TPlainDate }[] = [];
  for (const rule of rules) {
    for (const date of occurrencesBetween(specOf(rule), start, to)) {
      out.push({ rule, date });
    }
  }
  return out;
}

/** Test seam — the module-level throttle would otherwise leak between cases. */
export function resetThrottle(): void {
  lastRunAtMs = 0;
}

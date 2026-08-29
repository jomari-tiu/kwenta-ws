import type { NextFunction, Request, Response } from 'express';
import { materializeDue } from '../modules/recurring/recurring.materializer.js';
import { logger } from './request-logger.js';

/**
 * Runs the lazy recurring catch-up before reads that need materialized rows.
 *
 * This deliberately makes those GETs side-effecting — a real REST violation,
 * accepted because a cron needs a reliably-awake process and this app has no
 * guarantee of one. It is confined to this middleware, mounted only on
 * /calendar, /transactions, /dashboard and /budgets, idempotent (unique index +
 * ON CONFLICT DO NOTHING), throttled in-process, and advisory-locked.
 *
 * A failure here must NOT fail the read: stale projections beat a 500.
 */
export function recurringCatchup(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  materializeDue()
    .then(() => next())
    .catch((err: unknown) => {
      logger.error({ err }, 'Recurring catch-up failed; serving read anyway');
      next();
    });
}

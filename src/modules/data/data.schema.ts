import { z } from 'zod';

/**
 * Bumped whenever the shape of an exported table changes incompatibly. Import
 * refuses a version it does not know rather than half-loading a file and
 * leaving the owner to work out what went wrong.
 */
export const EXPORT_FORMAT_VERSION = 1;

const tableRows = z.array(z.record(z.string(), z.unknown()));

/**
 * The ENVELOPE is validated strictly; the rows are not.
 *
 * Deliberate: the file is produced by this app's own export, and the real
 * guarantees on row shape are the table's NOT NULLs, CHECKs and foreign keys,
 * which run inside the import transaction and roll the whole thing back. A
 * second hand-written column-by-column schema here would be a copy of the
 * schema that silently drifts from it.
 */
export const importPayloadSchema = z.object({
  formatVersion: z.number().int(),
  exportedAt: z.string().optional(),
  appTimezone: z.string().optional(),
  data: z.object({
    categories: tableRows.default([]),
    accounts: tableRows.default([]),
    recurringRules: tableRows.default([]),
    installmentPlans: tableRows.default([]),
    installmentPayments: tableRows.default([]),
    creditLoans: tableRows.default([]),
    investments: tableRows.default([]),
    transactions: tableRows.default([]),
    budgetOverrides: tableRows.default([]),
  }),
});

export const importQuerySchema = z.object({
  /**
   * `empty` (default) refuses unless the target has no data — the safe path for
   * migrating into a fresh production database. `replace` wipes first and is
   * the only way to overwrite, so it can never happen by accident.
   */
  mode: z.enum(['empty', 'replace']).default('empty'),
});

export type TImportPayload = z.infer<typeof importPayloadSchema>;
export type TImportQuery = z.infer<typeof importQuerySchema>;

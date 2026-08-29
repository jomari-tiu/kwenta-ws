import { z } from 'zod';

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const shared = {
  name: z.string().trim().min(1, 'Name is required').max(80),
  type: z.enum(['income', 'expense']),
  amountCentavos: z.number().int().positive('Amount must be greater than zero'),
  interval: z.number().int().min(1).max(12).default(1),
  startDate: plainDate,
  endDate: plainDate.nullable().optional(),
  categoryId: z.uuid('Category is required'),
  accountId: z.uuid('Account is required'),
  note: z.string().trim().max(200).nullable().optional(),
};

/**
 * A discriminated union on frequency, so weekly requires dayOfWeek and yearly
 * requires dayOfMonth + monthOfYear. The DB mirrors this with a CHECK, so a bad
 * row cannot exist even via db:studio.
 */
export const createRuleSchema = z.discriminatedUnion('frequency', [
  z.object({
    ...shared,
    frequency: z.literal('weekly'),
    dayOfWeek: z.number().int().min(1).max(7),
  }),
  z.object({
    ...shared,
    frequency: z.literal('biweekly'),
    dayOfWeek: z.number().int().min(1).max(7),
  }),
  z.object({
    ...shared,
    frequency: z.literal('monthly'),
    dayOfMonth: z.number().int().min(1).max(31),
  }),
  z.object({
    ...shared,
    frequency: z.literal('yearly'),
    dayOfMonth: z.number().int().min(1).max(31),
    monthOfYear: z.number().int().min(1).max(12),
  }),
]);

/** Partial update: the shape CHECK is re-validated server-side after merging. */
export const updateRuleSchema = z.object({
  name: shared.name.optional(),
  amountCentavos: shared.amountCentavos.optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']).optional(),
  interval: z.number().int().min(1).max(12).optional(),
  dayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  monthOfYear: z.number().int().min(1).max(12).nullable().optional(),
  startDate: plainDate.optional(),
  endDate: plainDate.nullable().optional(),
  categoryId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

export const updateRuleQuerySchema = z.object({
  /**
   * `future` (default) leaves already-materialized rows alone — a salary raise
   * should not rewrite last year's payslips. `all` also updates them, but skips
   * any row that was hand-edited.
   */
  applyTo: z.enum(['future', 'all']).default('future'),
});

export const deleteRuleQuerySchema = z.object({
  /** `none` (default) keeps every generated transaction: deleting a rule must
   *  not silently rewrite history. */
  deleteGenerated: z.enum(['none', 'future', 'all']).default('none'),
});

export const listRulesQuerySchema = z.object({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  type: z.enum(['income', 'expense']).optional(),
  pageNumber: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });

export type TCreateRuleBody = z.infer<typeof createRuleSchema>;
export type TUpdateRuleBody = z.infer<typeof updateRuleSchema>;
export type TUpdateRuleQuery = z.infer<typeof updateRuleQuerySchema>;
export type TDeleteRuleQuery = z.infer<typeof deleteRuleQuerySchema>;
export type TListRulesQuery = z.infer<typeof listRulesQuerySchema>;

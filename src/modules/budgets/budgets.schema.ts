import { z } from 'zod';

const monthKey = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');

export const budgetsQuerySchema = z.object({ month: monthKey.optional() });

export const setDefaultCapSchema = z.object({
  capCentavos: z.number().int().nonnegative().nullable(),
});

export const setOverrideSchema = z.object({
  categoryId: z.uuid('Category is required'),
  month: monthKey,
  capCentavos: z.number().int().nonnegative(),
});

export const clearOverrideQuerySchema = z.object({
  categoryId: z.uuid('Category is required'),
  month: monthKey,
});

export const categoryIdParamSchema = z.object({
  categoryId: z.uuid('Invalid category id'),
});

export type TBudgetsQuery = z.infer<typeof budgetsQuerySchema>;
export type TSetDefaultCapBody = z.infer<typeof setDefaultCapSchema>;
export type TSetOverrideBody = z.infer<typeof setOverrideSchema>;
export type TClearOverrideQuery = z.infer<typeof clearOverrideQuerySchema>;

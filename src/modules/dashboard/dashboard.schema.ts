import { z } from 'zod';

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const summaryQuerySchema = z.object({
  period: z.enum(['week', 'month', 'year']).default('month'),
  anchor: plainDate.optional(),
});

export const byCategoryQuerySchema = z.object({
  dateFrom: plainDate,
  dateTo: plainDate,
  type: z.enum(['income', 'expense']).default('expense'),
});

export type TSummaryQuery = z.infer<typeof summaryQuerySchema>;
export type TByCategoryQuery = z.infer<typeof byCategoryQuerySchema>;

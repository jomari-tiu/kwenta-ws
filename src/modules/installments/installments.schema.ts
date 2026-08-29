import { z } from 'zod';

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const previewScheduleSchema = z.object({
  totalCentavos: z.number().int().positive('Total must be greater than zero'),
  termMonths: z.number().int().min(1).max(120),
  startDate: plainDate,
  dayOfMonth: z.number().int().min(1).max(31),
});

export const createPlanSchema = previewScheduleSchema.extend({
  name: z.string().trim().min(1, 'Name is required').max(80),
  merchant: z.string().trim().max(80).nullable().optional(),
  categoryId: z.uuid('Category is required'),
  accountId: z.uuid('Account is required'),
  note: z.string().trim().max(200).nullable().optional(),
});

export const updatePlanSchema = createPlanSchema.partial();

export const payPaymentSchema = z.object({
  paidDate: plainDate.optional(),
  amountCentavos: z.number().int().positive().optional(),
  accountId: z.uuid().optional(),
});

export const listPlansQuerySchema = z.object({
  status: z.enum(['active', 'completed', 'all']).default('active'),
  pageNumber: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const deletePlanQuerySchema = z.object({
  deleteGeneratedTransactions: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
});

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });
export const planPaymentParamsSchema = z.object({
  id: z.uuid('Invalid plan id'),
  paymentId: z.uuid('Invalid payment id'),
});

export type TPreviewScheduleBody = z.infer<typeof previewScheduleSchema>;
export type TCreatePlanBody = z.infer<typeof createPlanSchema>;
export type TUpdatePlanBody = z.infer<typeof updatePlanSchema>;
export type TPayPaymentBody = z.infer<typeof payPaymentSchema>;
export type TListPlansQuery = z.infer<typeof listPlansQuerySchema>;
export type TDeletePlanQuery = z.infer<typeof deletePlanQuerySchema>;

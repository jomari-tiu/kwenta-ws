import { z } from 'zod';
import { INVESTMENT_KINDS } from '../../db/schema/investments.js';

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const createInvestmentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  provider: z.string().trim().max(80).nullable().optional(),
  kind: z.enum(INVESTMENT_KINDS).default('fund'),
  /**
   * All three are OPTIONAL and explicitly nullable. A fund with no goal, no
   * goal date and no valuation is the ordinary case, not a validation failure.
   */
  targetCentavos: z
    .number()
    .int('Amount must be whole centavos')
    .positive('A target must be greater than zero')
    .nullable()
    .optional(),
  targetDate: plainDate.nullable().optional(),
  currentValueCentavos: z
    .number()
    .int('Amount must be whole centavos')
    .min(0, 'A value cannot be negative')
    .nullable()
    .optional(),
  valueAsOf: plainDate.nullable().optional(),
  categoryId: z.uuid('Category is required'),
  accountId: z.uuid('Account is required'),
  note: z.string().trim().max(200).nullable().optional(),
});

export const updateInvestmentSchema = createInvestmentSchema.partial();

/** Put money in. Creates a linked EXPENSE. */
export const contributeSchema = z.object({
  amountCentavos: z.number().int().positive('Amount must be above zero'),
  paidDate: plainDate.optional(),
  accountId: z.uuid().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

/**
 * Take money out. Creates a linked INCOME, which is why it needs its own
 * category: an income transaction must reference an income category, and the
 * fund's contribution category is an expense one.
 */
export const withdrawSchema = z.object({
  amountCentavos: z.number().int().positive('Amount must be above zero'),
  categoryId: z.uuid('Pick where this money lands'),
  paidDate: plainDate.optional(),
  accountId: z.uuid().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

export const listInvestmentsQuerySchema = z.object({
  status: z.enum(['active', 'closed', 'all']).default('active'),
  pageNumber: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });

export const flowParamsSchema = z.object({
  id: z.uuid('Invalid id'),
  transactionId: z.uuid('Invalid transaction id'),
});

export type TCreateInvestmentBody = z.infer<typeof createInvestmentSchema>;
export type TUpdateInvestmentBody = z.infer<typeof updateInvestmentSchema>;
export type TContributeBody = z.infer<typeof contributeSchema>;
export type TWithdrawBody = z.infer<typeof withdrawSchema>;
export type TListInvestmentsQuery = z.infer<typeof listInvestmentsQuerySchema>;

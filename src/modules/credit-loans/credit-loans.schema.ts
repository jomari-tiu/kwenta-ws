import { z } from 'zod';

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const createCreditLoanSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  lender: z.string().trim().max(80).nullable().optional(),
  principalCentavos: z
    .number()
    .int('Amount must be whole centavos')
    .positive('Amount must be greater than zero'),
  /**
   * OPTIONAL, and explicitly nullable — a loan with no agreed date is the
   * normal case, not a validation failure.
   */
  dueDate: plainDate.nullable().optional(),
  categoryId: z.uuid('Category is required'),
  accountId: z.uuid('Account is required'),
  note: z.string().trim().max(200).nullable().optional(),
});

export const updateCreditLoanSchema = createCreditLoanSchema.partial();

/** Record a repayment. Creates a linked expense. */
export const repayCreditLoanSchema = z.object({
  amountCentavos: z.number().int().positive('Amount must be above zero'),
  paidDate: plainDate.optional(),
  accountId: z.uuid().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

export const listCreditLoansQuerySchema = z.object({
  status: z.enum(['open', 'settled', 'all']).default('open'),
  pageNumber: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });

export type TCreateCreditLoanBody = z.infer<typeof createCreditLoanSchema>;
export type TUpdateCreditLoanBody = z.infer<typeof updateCreditLoanSchema>;
export type TRepayCreditLoanBody = z.infer<typeof repayCreditLoanSchema>;
export type TListCreditLoansQuery = z.infer<typeof listCreditLoansQuerySchema>;

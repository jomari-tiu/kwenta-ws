import { z } from 'zod';

export const LEDGER_TYPES = ['income', 'expense'] as const;

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

/** Comma-separated uuid list, e.g. ?categoryId=a,b,c */
const uuidList = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.uuid('Invalid id in list')).min(1));

export const createTransactionSchema = z.object({
  type: z.enum(LEDGER_TYPES),
  amountCentavos: z
    .number()
    .int('Amount must be whole centavos')
    .positive('Amount must be greater than zero'),
  txnDate: plainDate,
  categoryId: z.uuid('Category is required'),
  accountId: z.uuid('Account is required'),
  note: z.string().trim().max(200).nullable().optional(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export const listTransactionsQuerySchema = z.object({
  dateFrom: plainDate.optional(),
  dateTo: plainDate.optional(),
  type: z.enum(LEDGER_TYPES).optional(),
  categoryId: uuidList.optional(),
  accountId: uuidList.optional(),
  amountMinCentavos: z.coerce.number().int().nonnegative().optional(),
  amountMaxCentavos: z.coerce.number().int().nonnegative().optional(),
  search: z.string().trim().optional(),
  source: z.enum(['manual', 'recurring', 'installment']).optional(),
  sortBy: z.enum(['date', 'amount', 'created']).default('date'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  pageNumber: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });

export type TCreateTransactionBody = z.infer<typeof createTransactionSchema>;
export type TUpdateTransactionBody = z.infer<typeof updateTransactionSchema>;
export type TListTransactionsQuery = z.infer<
  typeof listTransactionsQuerySchema
>;

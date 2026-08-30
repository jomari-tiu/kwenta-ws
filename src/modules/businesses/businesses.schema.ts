import { z } from 'zod';

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const createBusinessSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  note: z.string().trim().max(200).nullable().optional(),
  /**
   * OPTIONAL. With a dedicated account, capital and drawings are real transfers
   * and the books can be checked against a real balance. Without one — a shop
   * genuinely run out of a personal wallet — only revenue and costs are
   * tracked, and capital/drawings are not offered, because moving money from a
   * pocket to itself is not a movement.
   */
  accountId: z.uuid().nullable().optional(),
  startedOn: plainDate.nullable().optional(),
  closedAt: plainDate.nullable().optional(),
});

export const updateBusinessSchema = createBusinessSchema.partial();

/** Revenue (income) or a cost (expense). */
export const entrySchema = z.object({
  kind: z.enum(['revenue', 'cost']),
  amountCentavos: z.number().int().positive('Amount must be above zero'),
  categoryId: z.uuid('Category is required'),
  /** Required only when the business has no account of its own. */
  accountId: z.uuid().optional(),
  txnDate: plainDate.optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

/** Money I put IN. A transfer from a personal account into the business one. */
export const capitalSchema = z.object({
  amountCentavos: z.number().int().positive('Amount must be above zero'),
  fromAccountId: z.uuid('Pick where the money comes from'),
  txnDate: plainDate.optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

/** Money I take OUT for personal use. The same transfer, reversed. */
export const drawingSchema = z.object({
  amountCentavos: z.number().int().positive('Amount must be above zero'),
  toAccountId: z.uuid('Pick where the money goes'),
  txnDate: plainDate.optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

export const listBusinessesQuerySchema = z.object({
  status: z.enum(['active', 'closed', 'all']).default('active'),
  pageNumber: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });

export const entryParamsSchema = z.object({
  id: z.uuid('Invalid id'),
  transactionId: z.uuid('Invalid transaction id'),
});

export type TCreateBusinessBody = z.infer<typeof createBusinessSchema>;
export type TUpdateBusinessBody = z.infer<typeof updateBusinessSchema>;
export type TEntryBody = z.infer<typeof entrySchema>;
export type TCapitalBody = z.infer<typeof capitalSchema>;
export type TDrawingBody = z.infer<typeof drawingSchema>;
export type TListBusinessesQuery = z.infer<typeof listBusinessesQuerySchema>;

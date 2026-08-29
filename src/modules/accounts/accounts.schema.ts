import { z } from 'zod';
import { ACCOUNT_KINDS } from '../../db/schema/index.js';

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #RRGGBB hex value');
const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  kind: z.enum(ACCOUNT_KINDS).default('other'),
  icon: z.string().trim().max(40).optional(),
  color: hexColor.optional(),
  openingBalanceCentavos: z.number().int().optional(),
  openingBalanceDate: plainDate.nullable().optional(),
  creditLimitCentavos: z.number().int().nonnegative().nullable().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const updateAccountSchema = createAccountSchema.partial();

export const listAccountsQuerySchema = z.object({
  kind: z.enum(ACCOUNT_KINDS).optional(),
  search: z.string().trim().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  pageNumber: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });

export type TCreateAccountBody = z.infer<typeof createAccountSchema>;
export type TUpdateAccountBody = z.infer<typeof updateAccountSchema>;
export type TListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

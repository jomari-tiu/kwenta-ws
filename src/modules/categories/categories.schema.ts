import { z } from 'zod';
import { CATEGORY_KINDS } from '../../db/schema/index.js';

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #RRGGBB hex value');

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  kind: z.enum(CATEGORY_KINDS),
  icon: z.string().trim().max(40).optional(),
  color: hexColor.optional(),
  monthlyBudgetCentavos: z.number().int().nonnegative().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

// `kind` is intentionally absent — flipping it would reclassify every
// referencing transaction.
export const updateCategorySchema = createCategorySchema
  .omit({ kind: true })
  .partial();

export const listCategoriesQuerySchema = z.object({
  kind: z.enum(CATEGORY_KINDS).optional(),
  search: z.string().trim().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  pageNumber: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });

export type TCreateCategoryBody = z.infer<typeof createCategorySchema>;
export type TUpdateCategoryBody = z.infer<typeof updateCategorySchema>;
export type TListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

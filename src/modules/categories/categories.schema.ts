import { z } from 'zod';
import { CATEGORY_KINDS, CATEGORY_SCOPES } from '../../db/schema/index.js';

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #RRGGBB hex value');

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  kind: z.enum(CATEGORY_KINDS),
  /** Defaults to personal, so every existing caller keeps working. */
  scope: z.enum(CATEGORY_SCOPES).optional(),
  icon: z.string().trim().max(40).optional(),
  color: hexColor.optional(),
  monthlyBudgetCentavos: z.number().int().nonnegative().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

// `kind` and `scope` are intentionally absent — flipping either would
// reclassify every referencing transaction, `scope` by moving it between the
// personal and business books.
export const updateCategorySchema = createCategorySchema
  .omit({ kind: true, scope: true })
  .partial();

export const listCategoriesQuerySchema = z.object({
  kind: z.enum(CATEGORY_KINDS).optional(),
  scope: z.enum(CATEGORY_SCOPES).optional(),
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

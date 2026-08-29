import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import * as controller from './categories.controller.js';
import {
  createCategorySchema,
  idParamSchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './categories.schema.js';

export const categoriesRoutes = Router();

categoriesRoutes.get(
  '/',
  validateQuery(listCategoriesQuerySchema),
  asyncHandler(controller.getCategories),
);
categoriesRoutes.post(
  '/',
  validateBody(createCategorySchema),
  asyncHandler(controller.postCategory),
);
categoriesRoutes.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.getCategory),
);
categoriesRoutes.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateCategorySchema),
  asyncHandler(controller.patchCategory),
);
categoriesRoutes.delete(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.deleteCategory),
);
categoriesRoutes.post(
  '/:id/restore',
  validateParams(idParamSchema),
  asyncHandler(controller.postRestoreCategory),
);

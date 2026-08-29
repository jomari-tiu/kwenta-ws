import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import { recurringCatchup } from '../../middleware/recurring-catchup.js';
import * as controller from './budgets.controller.js';
import {
  budgetsQuerySchema,
  categoryIdParamSchema,
  clearOverrideQuerySchema,
  setDefaultCapSchema,
  setOverrideSchema,
} from './budgets.schema.js';

export const budgetsRoutes = Router();

budgetsRoutes.get(
  '/',
  recurringCatchup,
  validateQuery(budgetsQuerySchema),
  asyncHandler(controller.getBudgets),
);
budgetsRoutes.put(
  '/default/:categoryId',
  validateParams(categoryIdParamSchema),
  validateBody(setDefaultCapSchema),
  asyncHandler(controller.putDefaultCap),
);
budgetsRoutes.put(
  '/override',
  validateBody(setOverrideSchema),
  asyncHandler(controller.putOverride),
);
budgetsRoutes.delete(
  '/override',
  validateQuery(clearOverrideQuerySchema),
  asyncHandler(controller.deleteOverride),
);

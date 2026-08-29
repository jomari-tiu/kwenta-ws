import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import { validateQuery } from '../../common/validate.js';
import { recurringCatchup } from '../../middleware/recurring-catchup.js';
import * as controller from './dashboard.controller.js';
import {
  byCategoryQuerySchema,
  summaryQuerySchema,
} from './dashboard.schema.js';

export const dashboardRoutes = Router();

dashboardRoutes.get(
  '/summary',
  recurringCatchup,
  validateQuery(summaryQuerySchema),
  asyncHandler(controller.getSummary),
);
dashboardRoutes.get(
  '/by-category',
  recurringCatchup,
  validateQuery(byCategoryQuerySchema),
  asyncHandler(controller.getByCategory),
);

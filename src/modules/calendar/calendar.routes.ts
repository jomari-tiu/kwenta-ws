import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import { validateQuery } from '../../common/validate.js';
import { recurringCatchup } from '../../middleware/recurring-catchup.js';
import * as controller from './calendar.controller.js';
import { dayQuerySchema, monthQuerySchema } from './calendar.schema.js';

export const calendarRoutes = Router();

// Materialization runs here: this read needs past occurrences to exist.
calendarRoutes.get(
  '/',
  recurringCatchup,
  validateQuery(monthQuerySchema),
  asyncHandler(controller.getCalendarMonth),
);
calendarRoutes.get(
  '/day',
  recurringCatchup,
  validateQuery(dayQuerySchema),
  asyncHandler(controller.getCalendarDay),
);

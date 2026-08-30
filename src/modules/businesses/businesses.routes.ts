import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import * as controller from './businesses.controller.js';
import {
  capitalSchema,
  createBusinessSchema,
  drawingSchema,
  entryParamsSchema,
  entrySchema,
  idParamSchema,
  listBusinessesQuerySchema,
  updateBusinessSchema,
} from './businesses.schema.js';

export const businessesRoutes = Router();

// Static segment before /:id, or Express matches it as a uuid param.
businessesRoutes.get('/summary', asyncHandler(controller.getSummary));

businessesRoutes.get(
  '/',
  validateQuery(listBusinessesQuerySchema),
  asyncHandler(controller.getBusinesses),
);
businessesRoutes.post(
  '/',
  validateBody(createBusinessSchema),
  asyncHandler(controller.postBusiness),
);
businessesRoutes.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.getBusiness),
);
businessesRoutes.get(
  '/:id/entries',
  validateParams(idParamSchema),
  asyncHandler(controller.getEntries),
);
businessesRoutes.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateBusinessSchema),
  asyncHandler(controller.patchBusiness),
);
businessesRoutes.delete(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.deleteBusiness),
);
businessesRoutes.post(
  '/:id/entries',
  validateParams(idParamSchema),
  validateBody(entrySchema),
  asyncHandler(controller.postEntry),
);
businessesRoutes.post(
  '/:id/capital',
  validateParams(idParamSchema),
  validateBody(capitalSchema),
  asyncHandler(controller.postCapital),
);
businessesRoutes.post(
  '/:id/drawing',
  validateParams(idParamSchema),
  validateBody(drawingSchema),
  asyncHandler(controller.postDrawing),
);
businessesRoutes.delete(
  '/:id/entries/:transactionId',
  validateParams(entryParamsSchema),
  asyncHandler(controller.deleteEntry),
);

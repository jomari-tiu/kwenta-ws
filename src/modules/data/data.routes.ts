import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import { validateBody, validateQuery } from '../../common/validate.js';
import * as controller from './data.controller.js';
import { importPayloadSchema, importQuerySchema } from './data.schema.js';

export const dataRoutes = Router();

dataRoutes.get('/export', asyncHandler(controller.getExport));
dataRoutes.post(
  '/import',
  validateQuery(importQuerySchema),
  validateBody(importPayloadSchema),
  asyncHandler(controller.postImport),
);

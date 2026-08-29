import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import * as controller from './recurring.controller.js';
import {
  createRuleSchema,
  deleteRuleQuerySchema,
  idParamSchema,
  listRulesQuerySchema,
  updateRuleQuerySchema,
  updateRuleSchema,
} from './recurring.schema.js';

export const recurringRoutes = Router();

// Static segment before /:id.
recurringRoutes.post('/materialize', asyncHandler(controller.postMaterialize));

recurringRoutes.get(
  '/',
  validateQuery(listRulesQuerySchema),
  asyncHandler(controller.getRules),
);
recurringRoutes.post(
  '/',
  validateBody(createRuleSchema),
  asyncHandler(controller.postRule),
);
recurringRoutes.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.getRule),
);
recurringRoutes.patch(
  '/:id',
  validateParams(idParamSchema),
  validateQuery(updateRuleQuerySchema),
  validateBody(updateRuleSchema),
  asyncHandler(controller.patchRule),
);
recurringRoutes.delete(
  '/:id',
  validateParams(idParamSchema),
  validateQuery(deleteRuleQuerySchema),
  asyncHandler(controller.deleteRule),
);
recurringRoutes.post(
  '/:id/pause',
  validateParams(idParamSchema),
  asyncHandler(controller.postPause),
);
recurringRoutes.post(
  '/:id/resume',
  validateParams(idParamSchema),
  asyncHandler(controller.postResume),
);

import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import * as controller from './investments.controller.js';
import {
  contributeSchema,
  deleteInvestmentQuerySchema,
  flowParamsSchema,
  createInvestmentSchema,
  idParamSchema,
  listInvestmentsQuerySchema,
  updateInvestmentSchema,
  withdrawSchema,
} from './investments.schema.js';

export const investmentsRoutes = Router();

// Static segment before /:id, or Express matches it as a uuid param.
investmentsRoutes.get('/summary', asyncHandler(controller.getSummary));

investmentsRoutes.get(
  '/',
  validateQuery(listInvestmentsQuerySchema),
  asyncHandler(controller.getInvestments),
);
investmentsRoutes.post(
  '/',
  validateBody(createInvestmentSchema),
  asyncHandler(controller.postInvestment),
);
investmentsRoutes.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.getInvestment),
);
investmentsRoutes.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateInvestmentSchema),
  asyncHandler(controller.patchInvestment),
);
investmentsRoutes.delete(
  '/:id',
  validateParams(idParamSchema),
  validateQuery(deleteInvestmentQuerySchema),
  asyncHandler(controller.deleteInvestment),
);
investmentsRoutes.delete(
  '/:id/flows/:transactionId',
  validateParams(flowParamsSchema),
  asyncHandler(controller.deleteFlow),
);
investmentsRoutes.post(
  '/:id/contribute',
  validateParams(idParamSchema),
  validateBody(contributeSchema),
  asyncHandler(controller.postContribute),
);
investmentsRoutes.post(
  '/:id/withdraw',
  validateParams(idParamSchema),
  validateBody(withdrawSchema),
  asyncHandler(controller.postWithdraw),
);
